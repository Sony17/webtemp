// ONDC BAP persistence — Postgres backend.
//
// This is the database counterpart of store.ts's JSON implementation. It
// exports the EXACT same save* / get* function signatures so the dispatcher in
// store.ts can pick a backend per process based on whether DATABASE_URL is set.
//
// Mapping from the conceptual store to the 4 tables in prisma/schema.prisma:
//   * Catalogs                  → ondc_search_result rows (one per slice).
//   * Quotes / Supports / Ratings → ondc_event rows, distinguished by `kind`.
//     These three live in the flex bucket because they're each "last response
//     from a BPP about (txn, bpp) on a single topic", and a row with a kind
//     discriminator is exactly that — without growing the schema for every
//     new callback kind ONDC introduces.
//   * Orders                    → ondc_order rows (one per (txn, bpp)),
//     progressively enriched across init / confirm / status / track / cancel /
//     update — same lifecycle vocabulary the JSON store uses.
//   * Every save also ensures the parent ondc_search row exists (it's the FK
//     target for the other three tables and the natural "discovery session"
//     record).
//
// Schema deliberately stores opaque ONDC payloads as Json columns so a wire
// schema change doesn't drag in a database migration. Joins are not the point
// here — access patterns are always "give me everything for this txn / order".
//
// Server-only (talks SQL).
import "server-only";
import type {
  CatalogRecord,
  OrderRecord,
  OrderStage,
  QuoteRecord,
  RatingRecord,
  SaveCancelInput,
  SaveCatalogInput,
  SaveConfirmOrderInput,
  SaveInitOrderInput,
  SaveQuoteInput,
  SaveRatingInput,
  SaveStatusUpdateInput,
  SaveSupportInput,
  SaveTrackingInput,
  SaveUpdateOrderInput,
  SupportRecord,
  IssueRecord,
  IssueActionEntry,
  SaveIssueInput,
} from "@/lib/ondc/store-types";
import { OndcStoreError } from "@/lib/ondc/store-types";
import { getPrisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// Wrap every Prisma call so a SQL failure surfaces as the named error the
// route handlers already catch — symmetric with the JSON store's throw path.
async function run<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new OndcStoreError(`failed to ${label}`, { cause: err });
  }
}

// Ensure the discovery session row exists before any child row references it
// (search results / orders / events all FK to ondc_search.transactionId). Idem-
// potent: subsequent calls only bump lastEventAt. Domain/country/city default
// to the empty string for callbacks that arrive before we've issued a search
// for this transaction (in tests, or with an unsolicited callback); a later
// save with real values will not overwrite them — we use upsert with skipped
// update on those fields.
async function ensureSearchRow(input: {
  transactionId: string;
  domain?: string;
  countryCode?: string;
  cityCode?: string;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.ondcSearch.upsert({
    where: { transactionId: input.transactionId },
    create: {
      transactionId: input.transactionId,
      domain: input.domain ?? "",
      countryCode: input.countryCode ?? "",
      cityCode: input.cityCode ?? "",
    },
    update: { lastEventAt: new Date() },
  });
}

// Cast unknown ONDC payloads to Prisma's Json input shape. Prisma's `Json`
// type is `JsonValue` which is permissive at runtime but strict in TS — these
// `as any` casts are confined to this helper so the unsafety is localized.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJson(value: unknown): any {
  // null is a legal JSON value and a legal Prisma input.
  return value as unknown as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---------------------------------------------------------------------------
// Writes — catalogs.
// ---------------------------------------------------------------------------

// on_search → upsert one catalog slice into ondc_search_result. Same
// (txn, bpp, messageId) replaces (idempotent retry).
export async function saveCatalog(input: SaveCatalogInput): Promise<void> {
  await ensureSearchRow({ transactionId: input.transactionId });
  await run("save catalog", async () => {
    const prisma = getPrisma();
    await prisma.searchResult.upsert({
      where: {
        transactionId_bppId_messageId: {
          transactionId: input.transactionId,
          bppId: input.bppId,
          messageId: input.messageId,
        },
      },
      create: {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        catalog: asJson(input.catalog),
      },
      update: {
        bppUri: input.bppUri,
        catalog: asJson(input.catalog),
        receivedAt: new Date(),
      },
    });
  });
}

// on_select → write the quote as an ondc_event row with kind=on_select. The
// LATEST event for (txn, bpp, kind=on_select) is the current quote; a re-quote
// adds a new row (we don't update in place — events are append-only by design,
// and the read side picks the newest).
export async function saveQuote(input: SaveQuoteInput): Promise<void> {
  await ensureSearchRow({ transactionId: input.transactionId });
  await run("save quote", async () => {
    const prisma = getPrisma();
    await prisma.event.create({
      data: {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        kind: "on_select",
        payload: asJson({
          quote: input.quote,
          fulfillments: input.fulfillments,
        }),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Writes — orders. Each callback upserts the (txn, bpp) row, preserving any
// fields it doesn't restate. Mirrors the defensive merge logic of the JSON
// store so callbacks can arrive out of order without losing state.
// ---------------------------------------------------------------------------

// Shared upsert: pulls the existing row, layers the new fields on top, writes
// back. Prisma has no "partial update preserving non-mentioned fields"
// semantics for Json columns we want to KEEP (it would overwrite to null on
// undefined), so we read-modify-write — a transaction guards the race.
async function upsertOrder(args: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId?: string;
  stage: OrderStage;
  messageId: string;
  state?: unknown;
  order: unknown;
  // Use `undefined` to mean "preserve the existing value", `null` to clear it.
  quote?: unknown;
  payments?: unknown;
  fulfillments?: unknown;
  tracking?: unknown;
  cancellation?: unknown;
  appendStatusSnapshot?: { state: unknown; messageId: string };
}): Promise<void> {
  await ensureSearchRow({ transactionId: args.transactionId });
  await run(`save order (${args.stage})`, async () => {
    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: {
          transactionId_bppId: {
            transactionId: args.transactionId,
            bppId: args.bppId,
          },
        },
      });

      // statusHistory: append the new snapshot to the existing array. Stored
      // as JSON because access is always "give me this order's whole
      // history" — never queried.
      const prevHistory = (existing?.statusHistory as unknown[] | null) ?? [];
      const nextHistory = args.appendStatusSnapshot
        ? [
            ...prevHistory,
            {
              state: args.appendStatusSnapshot.state,
              messageId: args.appendStatusSnapshot.messageId,
              at: Date.now(),
            },
          ]
        : prevHistory;

      // Field-by-field merge: if the input field is undefined, preserve what's
      // in the row; if defined, overwrite (including with explicit null).
      const merge = <T,>(next: T | undefined, prev: T | null | undefined): T | null => {
        return next !== undefined ? (next as T) : ((prev ?? null) as T | null);
      };

      const data = {
        transactionId: args.transactionId,
        bppId: args.bppId,
        bppUri: args.bppUri,
        orderId: args.orderId ?? existing?.orderId ?? null,
        stage: args.stage,
        messageId: args.messageId,
        state: asJson(merge(args.state, existing?.state)),
        order: asJson(args.order),
        quote: asJson(merge(args.quote, existing?.quote)),
        payments: asJson(merge(args.payments, existing?.payments)),
        fulfillments: asJson(merge(args.fulfillments, existing?.fulfillments)),
        tracking: asJson(merge(args.tracking, existing?.tracking)),
        cancellation: asJson(merge(args.cancellation, existing?.cancellation)),
        statusHistory: asJson(nextHistory),
      };

      if (existing) {
        await tx.order.update({ where: { id: existing.id }, data });
      } else {
        await tx.order.create({ data });
      }
    });
  });
}

export async function saveInitOrder(input: SaveInitOrderInput): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    stage: "init",
    messageId: input.messageId,
    order: input.order,
    quote: input.quote,
    fulfillments: input.fulfillments,
  });
}

export async function saveConfirmOrder(
  input: SaveConfirmOrderInput
): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    orderId: input.orderId,
    stage: "confirm",
    messageId: input.messageId,
    state: input.state,
    order: input.order,
    // on_confirm may carry a final quote; when absent, the merge() in
    // upsertOrder preserves the init quote.
    quote: input.quote,
    fulfillments: input.fulfillments,
  });
}

export async function saveStatusUpdate(
  input: SaveStatusUpdateInput
): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    orderId: input.orderId,
    stage: "status",
    messageId: input.messageId,
    state: input.state,
    order: input.order,
    fulfillments: input.fulfillments,
    appendStatusSnapshot: { state: input.state, messageId: input.messageId },
  });
}

export async function saveTrackingUpdate(
  input: SaveTrackingInput
): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    stage: "track",
    messageId: input.messageId,
    // on_track carries no order/state — the existing values are preserved.
    order: undefined as unknown,
    tracking: input.tracking,
  });
}

export async function saveCancelUpdate(
  input: SaveCancelInput
): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    orderId: input.orderId,
    stage: "cancel",
    messageId: input.messageId,
    state: input.state,
    order: input.order,
    cancellation: input.cancellation,
    fulfillments: input.fulfillments,
    appendStatusSnapshot: { state: input.state, messageId: input.messageId },
  });
}

export async function saveUpdateOrder(
  input: SaveUpdateOrderInput
): Promise<void> {
  await upsertOrder({
    transactionId: input.transactionId,
    bppId: input.bppId,
    bppUri: input.bppUri,
    orderId: input.orderId,
    stage: "update",
    messageId: input.messageId,
    state: input.state,
    order: input.order,
    // input.payments is optional — when absent, merge() preserves the prior
    // value (matches the JSON store's `input.payments ?? existing?.payments`).
    payments: input.payments,
    fulfillments: input.fulfillments,
    appendStatusSnapshot: { state: input.state, messageId: input.messageId },
  });
}

// ---------------------------------------------------------------------------
// Writes — support + rating (Event-backed).
// ---------------------------------------------------------------------------

export async function saveSupport(input: SaveSupportInput): Promise<void> {
  await ensureSearchRow({ transactionId: input.transactionId });
  await run("save support", async () => {
    const prisma = getPrisma();
    await prisma.event.create({
      data: {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        kind: "on_support",
        payload: asJson({
          phone: input.phone,
          email: input.email,
          uri: input.uri,
          refId: input.refId,
          support: input.support,
        }),
      },
    });
  });
}

export async function saveRating(input: SaveRatingInput): Promise<void> {
  await ensureSearchRow({ transactionId: input.transactionId });
  await run("save rating", async () => {
    const prisma = getPrisma();
    await prisma.event.create({
      data: {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        kind: "on_rating",
        payload: asJson({
          feedbackForm: input.feedbackForm,
          feedbackFormUrl: input.feedbackFormUrl,
          feedbackFormMimeType: input.feedbackFormMimeType,
          feedbackRequired: input.feedbackRequired,
          feedbackAck: input.feedbackAck,
          ratingAck: input.ratingAck,
          feedback: input.feedback,
        }),
      },
    });
  });
}

// IGM v2.0.0 issue — also Event-backed, but with a unique access pattern.
// One Event row per save (so the action history is the chronological set of
// rows where kind=issue + extra.issueId matches). Reads fold them into one
// IssueRecord. We piggyback on the existing Event table (no schema change)
// by serializing issueId into the payload alongside the lifecycle snapshot.
export async function saveIssue(input: SaveIssueInput): Promise<void> {
  await ensureSearchRow({ transactionId: input.transactionId });
  await run("save issue", async () => {
    const prisma = getPrisma();
    await prisma.event.create({
      data: {
        transactionId: input.transactionId,
        bppId: input.bppId,
        bppUri: input.bppUri,
        messageId: input.messageId,
        kind: "issue",
        payload: asJson({
          issueId: input.issueId,
          category: input.category,
          subCategory: input.subCategory,
          orderId: input.orderId,
          status: input.status,
          lastTouchedBy: input.lastTouchedBy,
          newActions: input.newActions,
          resolution: input.resolution,
          issue: input.issue,
        }),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

export async function getCatalogs(
  transactionId: string
): Promise<CatalogRecord[]> {
  return run("read catalogs", async () => {
    const prisma = getPrisma();
    const rows = await prisma.searchResult.findMany({
      where: { transactionId },
      orderBy: { receivedAt: "desc" },
    });
    return rows.map((r) => ({
      transactionId: r.transactionId,
      bppId: r.bppId,
      bppUri: r.bppUri,
      messageId: r.messageId,
      catalog: r.catalog,
      receivedAt: r.receivedAt.getTime(),
    }));
  });
}

// Quote, support, rating all live in ondc_event — "the latest row for
// (txn, bpp, kind)" gives the current value, mirroring the JSON store's
// last-write-wins semantics.
async function latestEvent(
  transactionId: string,
  bppId: string,
  kind: string
): Promise<{
  messageId: string;
  bppUri: string;
  payload: unknown;
  receivedAt: Date;
} | null> {
  const prisma = getPrisma();
  const row = await prisma.event.findFirst({
    where: { transactionId, bppId, kind },
    orderBy: { receivedAt: "desc" },
  });
  if (!row) return null;
  return {
    messageId: row.messageId,
    bppUri: row.bppUri ?? "",
    payload: row.payload,
    receivedAt: row.receivedAt,
  };
}

export async function getQuote(
  transactionId: string,
  bppId: string
): Promise<QuoteRecord | null> {
  return run("read quote", async () => {
    const row = await latestEvent(transactionId, bppId, "on_select");
    if (!row) return null;
    const payload = row.payload as { quote?: unknown; fulfillments?: unknown };
    return {
      transactionId,
      bppId,
      bppUri: row.bppUri,
      messageId: row.messageId,
      quote: payload.quote,
      fulfillments: payload.fulfillments,
      receivedAt: row.receivedAt.getTime(),
    };
  });
}

// Internal: map a Prisma Order row to the public OrderRecord shape.
function rowToOrder(r: {
  transactionId: string;
  bppId: string;
  bppUri: string;
  orderId: string | null;
  stage: OrderStage;
  messageId: string;
  state: unknown;
  order: unknown;
  quote: unknown;
  payments: unknown;
  fulfillments: unknown;
  tracking: unknown;
  cancellation: unknown;
  statusHistory: unknown;
  createdAt: Date;
  updatedAt: Date;
}): OrderRecord {
  return {
    transactionId: r.transactionId,
    bppId: r.bppId,
    bppUri: r.bppUri,
    orderId: r.orderId ?? undefined,
    state: r.state ?? undefined,
    order: r.order,
    quote: r.quote,
    payments: r.payments ?? undefined,
    fulfillments: r.fulfillments,
    tracking: r.tracking ?? undefined,
    cancellation: r.cancellation ?? undefined,
    stage: r.stage,
    messageId: r.messageId,
    statusHistory: (r.statusHistory as OrderRecord["statusHistory"]) ?? [],
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

export async function getOrder(
  transactionId: string,
  bppId: string
): Promise<OrderRecord | null> {
  return run("read order", async () => {
    const prisma = getPrisma();
    const row = await prisma.order.findUnique({
      where: { transactionId_bppId: { transactionId, bppId } },
    });
    return row ? rowToOrder(row) : null;
  });
}

export async function getOrderById(
  orderId: string
): Promise<OrderRecord | null> {
  return run("read order by id", async () => {
    const prisma = getPrisma();
    const row = await prisma.order.findUnique({ where: { orderId } });
    return row ? rowToOrder(row) : null;
  });
}

export async function getSupport(
  transactionId: string,
  bppId: string
): Promise<SupportRecord | null> {
  return run("read support", async () => {
    const row = await latestEvent(transactionId, bppId, "on_support");
    if (!row) return null;
    const p = row.payload as {
      phone?: string;
      email?: string;
      uri?: string;
      refId?: string;
      support?: unknown;
    };
    return {
      transactionId,
      bppId,
      bppUri: row.bppUri,
      messageId: row.messageId,
      phone: p.phone,
      email: p.email,
      uri: p.uri,
      refId: p.refId,
      support: p.support,
      receivedAt: row.receivedAt.getTime(),
    };
  });
}

export async function getRating(
  transactionId: string,
  bppId: string
): Promise<RatingRecord | null> {
  return run("read rating", async () => {
    const row = await latestEvent(transactionId, bppId, "on_rating");
    if (!row) return null;
    const p = row.payload as {
      feedbackForm?: unknown;
      feedbackFormUrl?: string;
      feedbackFormMimeType?: string;
      feedbackRequired?: boolean;
      feedbackAck?: boolean;
      ratingAck?: boolean;
      feedback?: unknown;
    };
    return {
      transactionId,
      bppId,
      bppUri: row.bppUri,
      messageId: row.messageId,
      feedbackForm: p.feedbackForm,
      feedbackFormUrl: p.feedbackFormUrl,
      feedbackFormMimeType: p.feedbackFormMimeType,
      feedbackRequired: p.feedbackRequired,
      feedbackAck: p.feedbackAck,
      ratingAck: p.ratingAck,
      feedback: p.feedback,
      receivedAt: row.receivedAt.getTime(),
    };
  });
}

// IGM payload shape we serialize into Event.payload on every saveIssue call.
type IssueEventPayload = {
  issueId: string;
  category?: string;
  subCategory?: string;
  orderId?: string;
  status: string;
  lastTouchedBy: "complainant" | "respondent";
  newActions: IssueActionEntry[];
  resolution?: unknown;
  issue: unknown;
};

// Fold every `kind=issue` event with this issueId into one IssueRecord. Because
// we append a new Event row per save, we accumulate `newActions` chronologically
// and let later fields overwrite earlier ones (status, resolution, issue).
function foldIssueEvents(
  rows: Array<{
    bppId: string | null;
    bppUri: string | null;
    messageId: string;
    payload: unknown;
    receivedAt: Date;
  }>,
  transactionId: string,
  issueId: string
): IssueRecord | null {
  const matching = rows
    .map((r) => ({ r, p: r.payload as IssueEventPayload }))
    .filter(({ p }) => p?.issueId === issueId);
  if (matching.length === 0) return null;
  const first = matching[matching.length - 1]; // oldest (rows ordered desc)
  const last = matching[0]; // newest
  const actions: IssueActionEntry[] = [];
  for (let i = matching.length - 1; i >= 0; i--) {
    const p = matching[i].p;
    if (Array.isArray(p.newActions)) actions.push(...p.newActions);
  }
  const pLast = last.p;
  return {
    transactionId,
    bppId: last.r.bppId ?? "",
    bppUri: last.r.bppUri ?? "",
    messageId: last.r.messageId,
    issueId,
    category: pLast.category,
    subCategory: pLast.subCategory,
    orderId: pLast.orderId,
    status: pLast.status,
    lastTouchedBy: pLast.lastTouchedBy,
    actions,
    resolution: pLast.resolution,
    issue: pLast.issue,
    createdAt: first.r.receivedAt.getTime(),
    updatedAt: last.r.receivedAt.getTime(),
  };
}

// One IGM issue, full lifecycle history folded from all `kind=issue` events.
// Returns null when the issueId hasn't been seen yet for this transaction.
export async function getIssue(
  transactionId: string,
  issueId: string
): Promise<IssueRecord | null> {
  return run("read issue", async () => {
    const prisma = getPrisma();
    const rows = await prisma.event.findMany({
      where: { transactionId, kind: "issue" },
      orderBy: { receivedAt: "desc" },
    });
    return foldIssueEvents(rows, transactionId, issueId);
  });
}

// All IGM issues opened against this transaction, newest update first.
export async function getIssuesByTransaction(
  transactionId: string
): Promise<IssueRecord[]> {
  return run("read issues by txn", async () => {
    const prisma = getPrisma();
    const rows = await prisma.event.findMany({
      where: { transactionId, kind: "issue" },
      orderBy: { receivedAt: "desc" },
    });
    const seen = new Set<string>();
    const out: IssueRecord[] = [];
    for (const r of rows) {
      const p = r.payload as IssueEventPayload;
      if (!p?.issueId || seen.has(p.issueId)) continue;
      seen.add(p.issueId);
      const rec = foldIssueEvents(rows, transactionId, p.issueId);
      if (rec) out.push(rec);
    }
    return out;
  });
}
