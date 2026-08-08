// Logistics quote endpoint — serviceability + price for a pickup→drop pair.
//
//   POST /api/logistics/quote
//   {
//     "pickupLatitude": 28.6139, "pickupLongitude": 77.2090,
//     "dropLatitude":   28.5355, "dropLongitude":   77.3910,
//     "parcelSize": "MEDIUM", "weightKg": 2.5,
//     "cod": true, "codAmount": 800
//   }
//     → { serviceable, totalPrice, codFee, estimatedDistanceKm,
//         estimatedDurationMin, currency }
//
// Thin pass-through to Tocxi's POST /quote (which returns serviceability AND the
// price). Used at checkout to show the delivery fee and gate out-of-coverage
// drops before the buyer confirms. No persistence — a quote is ephemeral.
//
// Mirrors the app's route conventions: NextResponse, runtime = "nodejs", JSON
// body with a 400 guard, a clean 503 when Tocxi isn't configured (like the ONDC
// routes), and a 502 when the upstream call fails.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { isTocxiConfigured } from "@/lib/logistics/config";
import { quote, TocxiError } from "@/lib/logistics/client";
import type { ParcelSize, QuoteRequest } from "@/lib/logistics/types";

// client.ts is `import "server-only"` (reads the secret API key), so this handler
// must run on the Node runtime — the same choice as every other API route here.
export const runtime = "nodejs";

// A finite number in the given inclusive range, else undefined. Coordinates and
// amounts are validated through this so garbage never reaches Tocxi.
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isParcelSize(v: unknown): v is ParcelSize {
  return v === "SMALL" || v === "MEDIUM" || v === "LARGE";
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  if (!isTocxiConfigured()) {
    return NextResponse.json(
      { error: "Logistics (Tocxi) is not configured." },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const pickupLatitude = num(body.pickupLatitude);
  const pickupLongitude = num(body.pickupLongitude);
  const dropLatitude = num(body.dropLatitude);
  const dropLongitude = num(body.dropLongitude);
  if (
    pickupLatitude === undefined ||
    pickupLongitude === undefined ||
    dropLatitude === undefined ||
    dropLongitude === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "pickupLatitude, pickupLongitude, dropLatitude and dropLongitude are required numbers.",
      },
      { status: 400 }
    );
  }

  const parcelSize = isParcelSize(body.parcelSize) ? body.parcelSize : undefined;
  const cod = body.cod === true;
  const codAmount = num(body.codAmount);
  if (cod && (codAmount === undefined || codAmount < 0)) {
    return NextResponse.json(
      { error: "codAmount must be a non-negative number when cod is true." },
      { status: 400 }
    );
  }

  const input: QuoteRequest = {
    pickupLatitude,
    pickupLongitude,
    dropLatitude,
    dropLongitude,
    parcelSize,
    weightKg: num(body.weightKg),
    cod,
    codAmount: cod ? codAmount : undefined,
  };

  try {
    const result = await quote(input);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof TocxiError) {
      console.warn("logistics.quote upstream error", {
        httpStatus: err.httpStatus,
        code: err.code,
      });
      // Surface a 502 (bad upstream) with the machine code so the caller can
      // distinguish "Tocxi rejected/failed" from a bug in our route.
      return NextResponse.json(
        { error: "Tocxi quote failed", code: err.code },
        { status: 502 }
      );
    }
    console.error("logistics.quote fault", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }
}
