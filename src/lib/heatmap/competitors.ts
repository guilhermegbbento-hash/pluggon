/**
 * Concorrentes no MESMO escopo das outras camadas.
 *
 * Tipo de carregador vem de dado, nunca de nome:
 * 1. evChargeOptions.maxChargeRateKw da Places API (New);
 * 2. potência do OpenChargeMap num raio de CHARGER_RULES.ocmMatchDistanceM (reforço);
 * 3. sem dado → "unknown" ("não informado" no relatório), fora de qualquer contagem DC/AC.
 */

import { CHARGER_RULES } from "./config";
import { haversineM } from "./geo";
import type { FetchFn } from "./places";
import type { CandidatePlace, ChargerType, ScopeArea, SourceStatus } from "./types";

export function chargerTypeFor(kw: number | null): ChargerType {
  if (kw === null || kw <= 0) return "unknown";
  return kw >= CHARGER_RULES.dcMinKw ? "DC" : "AC";
}

interface OcmStation {
  ID?: number;
  AddressInfo?: {
    Title?: string;
    Latitude?: number;
    Longitude?: number;
    AddressLine1?: string;
    Town?: string;
  };
  Connections?: { PowerKW?: number | null }[];
}

export interface OcmResult {
  places: CandidatePlace[];
  status: SourceStatus;
}

export async function fetchOpenChargeMapInArea(
  area: ScopeArea,
  deps: { ocmApiKey?: string | null; fetchImpl?: FetchFn }
): Promise<OcmResult> {
  const name = `OpenChargeMap (${area.resolvedName})`;
  if (!deps.ocmApiKey) {
    return {
      places: [],
      status: {
        name,
        status: "indisponivel",
        detail: "OPENCHARGEMAP_API_KEY ausente — sem reforço de potência; tipo de carregador só via Google",
      },
    };
  }
  const params = new URLSearchParams({
    output: "json",
    countrycode: "BR",
    latitude: String(area.center.lat),
    longitude: String(area.center.lng),
    distance: String(area.radiusM / 1000),
    distanceunit: "KM",
    maxresults: "500",
    compact: "true",
    verbose: "false",
    key: deps.ocmApiKey,
  });
  try {
    const res = await (deps.fetchImpl ?? fetch)(`https://api.openchargemap.io/v3/poi/?${params}`, {
      headers: { "User-Agent": "PLUGGON-Heatmap/1.0" },
    });
    if (!res.ok) {
      return { places: [], status: { name, status: "erro", detail: `HTTP ${res.status}` } };
    }
    const data = (await res.json()) as OcmStation[];
    const places: CandidatePlace[] = [];
    for (const s of Array.isArray(data) ? data : []) {
      const lat = s.AddressInfo?.Latitude;
      const lng = s.AddressInfo?.Longitude;
      if (typeof lat !== "number" || typeof lng !== "number" || s.ID === undefined) continue;
      const kws = (s.Connections ?? []).map((c) => c.PowerKW ?? 0).filter((kw) => kw > 0);
      const kw = kws.length > 0 ? Math.max(...kws) : null;
      places.push({
        placeId: `ocm:${s.ID}`,
        name: s.AddressInfo?.Title ?? "",
        lat,
        lng,
        address: [s.AddressInfo?.AddressLine1, s.AddressInfo?.Town].filter(Boolean).join(", "),
        types: ["electric_vehicle_charging_station"],
        primaryType: "electric_vehicle_charging_station",
        businessStatus: null,
        userRatingCount: 0,
        hasWebsite: false,
        hasPhone: false,
        hasOpeningHours: false,
        chargerMaxKw: kw,
        chargerKwSource: kw !== null ? "openchargemap" : null,
        source: "openchargemap",
      });
    }
    return { places, status: { name, status: "ok", detail: `${places.length} estações no raio` } };
  } catch (err) {
    return { places: [], status: { name, status: "erro", detail: String(err) } };
  }
}

/**
 * Casa OpenChargeMap com Google: estação a menos de ocmMatchDistanceM de um
 * eletroposto do Google só empresta a potência (se o Google não tiver);
 * estação sem par entra como candidata própria e passa pelo mesmo pipeline.
 */
export function mergeOpenChargeMap(google: CandidatePlace[], ocm: CandidatePlace[]): CandidatePlace[] {
  const merged = google.map((p) => ({ ...p }));
  const extra: CandidatePlace[] = [];
  for (const o of ocm) {
    const match = merged.find((g) => haversineM(g, o) <= CHARGER_RULES.ocmMatchDistanceM);
    if (!match) {
      extra.push(o);
      continue;
    }
    if (match.chargerMaxKw === null && o.chargerMaxKw !== null) {
      match.chargerMaxKw = o.chargerMaxKw;
      match.chargerKwSource = "openchargemap";
    }
  }
  return [...merged, ...extra];
}
