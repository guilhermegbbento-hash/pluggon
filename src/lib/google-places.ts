const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

export interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  address: string;
  rating: number | null;
  reviews: number | null;
}

export async function searchPlaces(
  query: string,
  city: string,
  state: string,
  maxResults = 20
): Promise<PlaceResult[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
        },
        body: JSON.stringify({
          textQuery: `${query} em ${city}, ${state}, Brasil`,
          languageCode: "pt-BR",
          maxResultCount: maxResults,
        }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.places) return [];
    return data.places.map(
      (p: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        rating?: number;
        userRatingCount?: number;
      }) => ({
        name: p.displayName?.text || "",
        lat: p.location?.latitude || 0,
        lng: p.location?.longitude || 0,
        address: p.formattedAddress || "",
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? null,
      })
    );
  } catch {
    return [];
  }
}

/** Deduplicate places within ~50m */
export function deduplicatePlaces<T extends { lat: number; lng: number }>(
  lists: T[][]
): T[] {
  const merged: T[] = [];
  for (const list of lists) {
    for (const r of list) {
      if (r.lat === 0 && r.lng === 0) continue;
      const isDupe = merged.some(
        (m) =>
          Math.abs(m.lat - r.lat) < 0.0005 && Math.abs(m.lng - r.lng) < 0.0005
      );
      if (!isDupe) merged.push(r);
    }
  }
  return merged;
}
