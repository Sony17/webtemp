import "server-only";

const ENDPOINT =
  process.env.ONDC_NO_ENDPOINT ??
  "https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs";
const TOKEN = process.env.ONDC_NO_TOKEN ?? "";

const IS_CONFIGURED = TOKEN.length > 0 && ENDPOINT.length > 0;

const MASK_STRING_FIELDS = new Set([
  "phone",
  "email",
  "door",
  "building",
  "street",
  "locality",
  "landmark",
]);

const KEEP_FIELDS = new Set([
  "transaction_id",
  "message_id",
  "timestamp",
  "created_at",
  "updated_at",
  "city",
  "state",
  "pincode",
  "code",
  "ttl",
  "ttl_seconds",
]);

function maskPii(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(maskPii);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (KEEP_FIELDS.has(key)) {
      result[key] = val;
    } else if (MASK_STRING_FIELDS.has(key) && typeof val === "string") {
      result[key] = "**REDACTED**";
    } else if (key === "name" && typeof val === "string") {
      result[key] = "**REDACTED**";
    } else {
      result[key] = maskPii(val);
    }
  }
  return result;
}

export function pushTxnLog(type: string, payload: unknown): void {
  if (!IS_CONFIGURED) return;

  void (async () => {
    try {
      const data = maskPii(payload);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ type, data }),
      });
      if (!res.ok) {
        console.warn(
          `[NO] ${type} HTTP ${res.status} ${res.statusText}`
        );
      }
    } catch (err) {
      console.warn(
        `[NO] ${type} push failed: `,
        err instanceof Error ? err.message : String(err)
      );
    }
  })();
}
