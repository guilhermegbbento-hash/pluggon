import { ScoreDataError } from "./errors";

type FetchLike = (url: string) => Promise<Response>;

/** Sem cidade e UF, IBGE, ABVE e concorrentes da cidade vêm todos vazios. */
export function requireCityState(geo: { city: string; state: string }): void {
  if (!geo.city || !geo.state) {
    throw new ScoreDataError(
      "localizacao",
      `não foi possível identificar a cidade e a UF do ponto (cidade="${geo.city}", UF="${geo.state}")`
    );
  }
}

/**
 * Centro da cidade para a variável "distância ao centro". Antes, se falhava, o
 * centro virava o próprio ponto: distância 0 e nota máxima nessa variável.
 */
export async function geocodeCityCenter(
  city: string,
  state: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<{ lat: number; lng: number }> {
  if (!apiKey) throw new ScoreDataError("centro_da_cidade", "GOOGLE_MAPS_API_KEY ausente");
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${state}, Brasil`)}` +
    `&key=${apiKey}&language=pt-BR&region=br`;
  let data: { status?: string; error_message?: string; results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> };
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    throw new ScoreDataError("centro_da_cidade", `geocoding de ${city}/${state} falhou (${(e as Error).message})`);
  }
  const loc = data.results?.[0]?.geometry?.location;
  if (data.status !== "OK" || typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
    const why = [data.status, data.error_message].filter(Boolean).join(" — ") || "sem resultado";
    throw new ScoreDataError("centro_da_cidade", `geocoding de ${city}/${state} não devolveu o centro (${why})`);
  }
  return { lat: loc.lat, lng: loc.lng };
}
