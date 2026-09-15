/**
 * Resolve o escopo geográfico do estudo: município + (opcional) até 3 bairros.
 *
 * Regras:
 * - bairro é SEMPRE resolvido junto com cidade + UF e conferido contra o município;
 * - resultado parcial, de outro município, de tipo não aceito ou com nome
 *   divergente é rejeitado;
 * - se nenhum resultado passa, ABORTA com ScopeError. Nunca cai no centro do município.
 */

import { GEOCODE_RULES, MAX_AREAS, SCOPE_RULES } from "./config";
import { boundsHalfDiagonalM, nameSimilarity, normalizeText, rectCoverageByCircle, scopeBoundsFor } from "./geo";
import type { Bounds, LatLng, ScopeArea, ScopeMode, StudyScope } from "./types";

export interface GeocodeComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GeocodeBox {
  northeast: LatLng;
  southwest: LatLng;
}

export interface GeocodeResult {
  types: string[];
  partial_match?: boolean;
  formatted_address?: string;
  address_components: GeocodeComponent[];
  geometry: { location: LatLng; viewport?: GeocodeBox; bounds?: GeocodeBox };
}

export interface GeocodeResponse {
  status: string;
  results: GeocodeResult[];
  error_message?: string;
}

/** `state` vai como filtro `administrative_area` no geocoding. */
export type GeocodeFn = (address: string, state: string) => Promise<GeocodeResponse>;

export type ScopeErrorCode =
  | "entrada_invalida"
  | "municipio_nao_encontrado"
  | "bairro_nao_encontrado"
  | "geocoding_indisponivel";

export class ScopeError extends Error {
  constructor(
    public readonly code: ScopeErrorCode,
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "ScopeError";
  }
}

export function googleGeocoder(apiKey: string, fetchImpl: typeof fetch = fetch): GeocodeFn {
  return async (address, state) => {
    const params = new URLSearchParams({
      address,
      components: `country:BR|administrative_area:${state}`,
      language: "pt-BR",
      region: "br",
      key: apiKey,
    });
    let res: Response;
    try {
      res = await fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    } catch (err) {
      throw new ScopeError("geocoding_indisponivel", `Geocoding indisponível: ${String(err)}`);
    }
    if (!res.ok) {
      throw new ScopeError("geocoding_indisponivel", `Geocoding indisponível: HTTP ${res.status}`);
    }
    return (await res.json()) as GeocodeResponse;
  };
}

// ---------- Avaliação dos resultados ----------

function component(r: GeocodeResult, type: string): GeocodeComponent | undefined {
  return r.address_components.find((c) => c.types.includes(type));
}

function municipalityOf(r: GeocodeResult): { city: string; uf: string } {
  const city =
    component(r, "administrative_area_level_2")?.long_name ??
    component(r, "locality")?.long_name ??
    "?";
  const uf = component(r, "administrative_area_level_1")?.short_name ?? "?";
  return { city, uf };
}

function isInMunicipality(r: GeocodeResult, city: string, state: string): boolean {
  const m = municipalityOf(r);
  return normalizeText(m.city) === normalizeText(city) && m.uf.toUpperCase() === state;
}

function toBounds(box: GeocodeBox | undefined): Bounds | null {
  if (!box) return null;
  return {
    south: box.southwest.lat,
    west: box.southwest.lng,
    north: box.northeast.lat,
    east: box.northeast.lng,
  };
}

function contains(b: Bounds, p: LatLng): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

function describe(r: GeocodeResult): string {
  const m = municipalityOf(r);
  const tipo = r.types.filter((t) => t !== "political").join(",");
  const nome = r.address_components[0]?.long_name ?? r.formatted_address ?? "?";
  return `"${nome}" [${tipo}] em ${m.city}/${m.uf}${r.partial_match ? " (correspondência parcial)" : ""}`;
}

function checkStatus(resp: GeocodeResponse, what: string): void {
  if (resp.status === "OK" || resp.status === "ZERO_RESULTS") return;
  throw new ScopeError(
    "geocoding_indisponivel",
    `Geocoding falhou para ${what}: ${resp.status}${resp.error_message ? ` — ${resp.error_message}` : ""}`
  );
}

export interface ResolvedPlace {
  resolvedName: string;
  center: LatLng;
  bounds: Bounds | null;
  types: string[];
}

export function evaluateCityGeocode(resp: GeocodeResponse, city: string, state: string): ResolvedPlace {
  const label = `${city}/${state}`;
  checkStatus(resp, label);
  const rejections: string[] = [];
  for (const r of resp.results) {
    const reasons: string[] = [];
    if (r.partial_match) reasons.push("correspondência parcial");
    if (!r.types.some((t) => GEOCODE_RULES.cityResultTypes.includes(t))) reasons.push("não é município");
    if (!isInMunicipality(r, city, state)) reasons.push("município/UF divergente");
    if (reasons.length === 0) {
      return {
        resolvedName: municipalityOf(r).city,
        center: r.geometry.location,
        bounds: toBounds(r.geometry.bounds),
        types: r.types,
      };
    }
    rejections.push(`${describe(r)}: ${reasons.join(", ")}`);
  }
  throw new ScopeError(
    "municipio_nao_encontrado",
    `Município ${label} não encontrado no geocoding.`,
    rejections
  );
}

export function evaluateAreaGeocode(
  resp: GeocodeResponse,
  requested: string,
  city: string,
  state: string,
  cityBounds: Bounds | null
): ResolvedPlace {
  const label = `"${requested}" em ${city}/${state}`;
  checkStatus(resp, label);
  const rejections: string[] = [];
  for (const r of resp.results) {
    const reasons: string[] = [];
    const areaType = r.types.find((t) => GEOCODE_RULES.areaResultTypes.includes(t));
    const colloquialType = r.types.find((t) => GEOCODE_RULES.areaResultTypesRequiringBounds.includes(t));
    const areaComponent = r.address_components.find((c) =>
      c.types.some(
        (t) =>
          GEOCODE_RULES.areaResultTypes.includes(t) ||
          GEOCODE_RULES.areaResultTypesRequiringBounds.includes(t)
      )
    );

    if (r.partial_match) reasons.push("correspondência parcial");
    if (!areaType && !colloquialType) reasons.push("não é bairro");
    if (!areaType && colloquialType && !r.geometry.bounds) reasons.push("área coloquial sem limites definidos");
    if (!isInMunicipality(r, city, state)) {
      const m = municipalityOf(r);
      reasons.push(`fica em ${m.city}/${m.uf}`);
    }
    if (
      areaComponent &&
      normalizeText(areaComponent.long_name) !== normalizeText(requested) &&
      nameSimilarity(areaComponent.long_name, requested) < GEOCODE_RULES.minAreaNameSimilarity
    ) {
      reasons.push(`nome divergente ("${areaComponent.long_name}")`);
    }
    if (cityBounds && !contains(cityBounds, r.geometry.location)) {
      reasons.push("centro fora dos limites do município");
    }

    if (reasons.length === 0 && areaComponent) {
      return {
        resolvedName: areaComponent.long_name,
        center: r.geometry.location,
        bounds: toBounds(r.geometry.bounds),
        types: r.types,
      };
    }
    rejections.push(`${describe(r)}: ${reasons.join(", ") || "sem componente de bairro"}`);
  }
  throw new ScopeError(
    "bairro_nao_encontrado",
    `Bairro ${label} não encontrado no geocoding. A análise foi abortada — ` +
      `o sistema não usa o centro do município no lugar do bairro.`,
    rejections
  );
}

export function radiusFor(
  mode: ScopeMode,
  bounds: Bounds | null
): Pick<ScopeArea, "radiusM" | "rawRadiusM" | "radiusSource" | "radiusClamp"> {
  const rule = SCOPE_RULES[mode];
  if (!bounds) {
    return { radiusM: rule.fallbackRadiusM, rawRadiusM: null, radiusSource: "fallback", radiusClamp: null };
  }
  const raw = Math.round(boundsHalfDiagonalM(bounds));
  return {
    radiusM: Math.min(rule.maxRadiusM, Math.max(rule.minRadiusM, raw)),
    rawRadiusM: raw,
    radiusSource: "bounds",
    radiusClamp: raw > rule.maxRadiusM ? "teto" : raw < rule.minRadiusM ? "piso" : null,
  };
}

function areaFrom(mode: ScopeMode, requestedName: string, place: ResolvedPlace): ScopeArea {
  const radius = radiusFor(mode, place.bounds);
  return {
    requestedName,
    resolvedName: place.resolvedName,
    center: place.center,
    ...radius,
    boundsCoveragePct: place.bounds
      ? Math.round(rectCoverageByCircle(place.bounds, place.center, radius.radiusM) * 100)
      : null,
    geocodeTypes: place.types,
  };
}

// ---------- Entrada principal ----------

export interface ScopeInput {
  city: string;
  state: string;
  regions: string[];
}

export async function resolveScope(input: ScopeInput, geocode: GeocodeFn): Promise<StudyScope> {
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  const seen = new Set<string>();
  const regions = input.regions
    .map((r) => r.trim())
    .filter((r) => {
      const k = normalizeText(r);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (!city || !/^[A-Z]{2}$/.test(state)) {
    throw new ScopeError("entrada_invalida", "Cidade e UF (2 letras) são obrigatórias.");
  }
  if (regions.length > MAX_AREAS) {
    throw new ScopeError("entrada_invalida", `Máximo ${MAX_AREAS} regiões por análise.`);
  }

  const cityPlace = evaluateCityGeocode(await geocode(`${city} - ${state}, Brasil`, state), city, state);

  let mode: ScopeMode;
  let areas: ScopeArea[];

  if (regions.length === 0) {
    mode = "cidade";
    areas = [areaFrom(mode, city, cityPlace)];
  } else {
    mode = "bairro";
    const resolved = await Promise.all(
      regions.map(async (region) =>
        evaluateAreaGeocode(
          await geocode(`${region}, ${city} - ${state}, Brasil`, state),
          region,
          city,
          state,
          cityPlace.bounds
        )
      )
    );
    areas = resolved.map((place, i) => areaFrom("bairro", regions[i], place));
  }

  const label =
    mode === "cidade"
      ? `${city}/${state}`
      : `${areas.map((a) => a.resolvedName).join(", ")} · ${city}/${state}`;

  const key = [
    mode,
    normalizeText(city),
    state,
    areas.map((a) => normalizeText(a.resolvedName)).sort().join("+"),
  ].join("|");

  return { mode, city, state, label, areas, bounds: scopeBoundsFor(areas), key };
}
