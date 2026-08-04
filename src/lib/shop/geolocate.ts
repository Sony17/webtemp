// Shared browser geolocation + reverse-geocoding for the buyer app.
//
// One source of truth for "where is the buyer": a GPS fix from the browser and a
// best-effort OpenStreetMap (Nominatim) reverse-geocode into area / city /
// pincode. Used by the Location picker (LocationSheet) and by Search, which
// auto-detects a delivery location when none is saved so sellers serving the
// buyer's area respond (RET10 serviceability is hyperlocal, keyed on GPS).

export type ReverseGeocodeResult = {
  areaCode?: string;
  locality?: string;
  city?: string;
  state?: string;
};

export type DetectedLocation = ReverseGeocodeResult & {
  // "lat,long" to 6 dp — the string ONDC intents carry in
  // fulfillment.end.location.gps.
  gps: string;
};

// Thrown when the browser has no geolocation API at all (vs. the user denying
// permission, which rejects with the native GeolocationPositionError).
export class GeolocationUnavailableError extends Error {
  constructor() {
    super("Geolocation is not available in this browser.");
    this.name = "GeolocationUnavailableError";
  }
}

const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 300_000, // a 5-min-old fix is fine for delivery scope
};

// Promisified navigator.geolocation.getCurrentPosition. Rejects with
// GeolocationUnavailableError when the API is missing, or the native
// GeolocationPositionError when the user denies / it times out.
export function getCurrentPosition(
  opts: PositionOptions = GEO_OPTS
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeolocationUnavailableError());
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}

type NominatimAddress = Record<string, string | undefined>;

// Best-effort reverse geocode via OpenStreetMap Nominatim. Returns the mapped
// address parts, or null on any failure (offline, rate-limited, no match) — the
// caller keeps the raw GPS and lets the buyer fill the pincode manually.
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { address?: NominatimAddress };
    const a = json.address ?? {};
    return {
      areaCode: a.postcode,
      locality:
        a.suburb ??
        a.neighbourhood ??
        a.residential ??
        a.village ??
        a.town,
      city: a.city ?? a.town ?? a.county ?? a.state_district,
      state: a.state,
    };
  } catch {
    return null;
  }
}

// Get a GPS fix and enrich it with a reverse geocode. Rejects only when the GPS
// fix itself fails (unavailable / denied / timeout); a failed geocode just omits
// the area/city/pincode fields.
export async function detectCurrentLocation(): Promise<DetectedLocation> {
  const pos = await getCurrentPosition();
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const gps = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const geo = await reverseGeocode(lat, lon);
  return { gps, ...(geo ?? {}) };
}
