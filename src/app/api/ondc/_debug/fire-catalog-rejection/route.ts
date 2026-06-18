// Dev-only manual trigger for the outbound /catalog_rejection callback.
//
// `catalog_rejection` is normally fired by the /on_search handler when
// validateCatalog() flags the SNP's catalog. When the workbench dashboard
// expects step 3 to ACK but the inbound catalog happens to be well-formed
// (the validator passes), there is no production path that posts this
// envelope. This seed route exists so we can drive that step manually with
// the real transactionId/bppId/bppUri from the workbench log.
//
// Refuses to run unless explicitly enabled via ONDC_ENABLE_DEBUG_ROUTES=true.
// Never enable that flag in any non-dev environment.
import { NextResponse } from "next/server";
import { postCatalogRejection } from "@/lib/ondc/catalog-rejection-outbound";

export const runtime = "nodejs";

// Per RET 1.2.5 Catalog Rejection contract: 20003 (provider not found),
// 20004 (location not found), 20005 (item not found / invalid).
const REASON_CODES: ReadonlySet<string> = new Set(["20003", "20004", "20005"]);

type FireBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  city?: string;
  errorCode?: string;
  errorMessage?: string;
};

export async function POST(req: Request) {
  if (process.env.ONDC_ENABLE_DEBUG_ROUTES !== "true") {
    return NextResponse.json(
      { error: "debug routes disabled (set ONDC_ENABLE_DEBUG_ROUTES=true to enable)" },
      { status: 404 }
    );
  }

  let body: FireBody;
  try {
    body = (await req.json()) as FireBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { transactionId, bppId, bppUri, city, errorCode, errorMessage } = body;
  if (!transactionId || !bppId || !bppUri || !errorCode || !errorMessage) {
    return NextResponse.json(
      {
        error:
          "transactionId, bppId, bppUri, errorCode and errorMessage are required",
      },
      { status: 400 }
    );
  }

  if (!REASON_CODES.has(errorCode)) {
    return NextResponse.json(
      { error: `errorCode must be one of: ${Array.from(REASON_CODES).join(", ")}` },
      { status: 400 }
    );
  }

  await postCatalogRejection({
    bppId,
    bppUri,
    transactionId,
    city,
    error: {
      type: "DOMAIN-ERROR",
      code: errorCode,
      message: errorMessage,
    },
  });

  return NextResponse.json({ fired: true, transactionId, bppId, errorCode });
}
