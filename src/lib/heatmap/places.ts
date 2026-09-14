/**
 * Busca na Places API (New) SEMPRE restrita ao escopo:
 * - searchText com includedType + strictTypeFiltering + locationRestriction (retângulo);
 * - searchNearby com locationRestriction circular, quando a spec pede.
 *
 * Specs de completude obrigatória subdividem a área em quadrantes enquanto uma
 * célula voltar no teto da API (60 na searchText, 20 na searchNearby). Nunca
 * sai do círculo de estudo: células fora dele nem são buscadas, e o filtro duro
 * de distância acontece no pipeline.
 */

import { SEARCH_RULES, type PlaceTypeSpec } from "./config";
import { boundsCenter, boundsHalfDiagonalM, boundsIntersectCircle, circleBounds, splitBounds } from "./geo";
import type { Bounds, CandidatePlace, ScopeArea, SearchSummary } from "./types";

export type FetchFn = typeof fetch;

export interface GooglePlaceV1 {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: unknown;
  evChargeOptions?: {
    connectorCount?: number;
    connectorAggregation?: { type?: string; maxChargeRateKw?: number; count?: number }[];
  };
}

export function toCandidatePlace(p: GooglePlaceV1): CandidatePlace | null {
  if (!p.id || !p.location) return null;
  const kws = (p.evChargeOptions?.connectorAggregation ?? [])
    .map((c) => c.maxChargeRateKw ?? 0)
    .filter((kw) => kw > 0);
  const chargerMaxKw = kws.length > 0 ? Math.round(Math.max(...kws) * 10) / 10 : null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: p.formattedAddress ?? "",
    types: p.types ?? [],
    primaryType: p.primaryType ?? null,
    businessStatus: p.businessStatus ?? null,
    userRatingCount: p.userRatingCount ?? 0,
    hasWebsite: Boolean(p.websiteUri),
    hasPhone: Boolean(p.nationalPhoneNumber),
    hasOpeningHours: Boolean(p.regularOpeningHours),
    chargerMaxKw,
    chargerKwSource: chargerMaxKw !== null ? "google_ev_options" : null,
    source: "google_places",
  };
}

export interface SearchDeps {
  apiKey: string;
  fetchImpl?: FetchFn;
}

type PostResult =
  | { ok: true; data: { places?: GooglePlaceV1[]; nextPageToken?: string } }
  | { ok: false; error: string };

async function postPlaces(
  endpoint: "searchText" | "searchNearby",
  body: Record<string, unknown>,
  fieldMask: string,
  deps: SearchDeps,
  counter: { requests: number }
): Promise<PostResult> {
  const f = deps.fetchImpl ?? fetch;
  let lastError = "";
  // Uma nova tentativa só para erro transitório (429/5xx/rede).
  for (let attempt = 0; attempt < 2; attempt++) {
    counter.requests++;
    try {
      const res = await f(`https://places.googleapis.com/v1/places:${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": deps.apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      lastError = `HTTP ${res.status}: ${data?.error?.message ?? res.statusText}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = String(err);
    }
  }
  return { ok: false, error: lastError };
}

export interface SpecSearchResult {
  places: CandidatePlace[];
  summaries: SearchSummary[];
  requests: number;
}

type CellResult = { ok: true; pages: number; returned: number; capped: boolean } | { ok: false; error: string };

/** Todas as buscas de uma spec numa área. Registros idênticos (mesmo place_id) de buscas sobrepostas viram um. */
export async function searchSpecInArea(
  spec: PlaceTypeSpec,
  area: ScopeArea,
  deps: SearchDeps
): Promise<SpecSearchResult> {
  const counter = { requests: 0 };
  const byId = new Map<string, CandidatePlace>();
  const summaries: SearchSummary[] = [];
  const fields = [...SEARCH_RULES.baseFields, ...(spec.extraFields ?? [])];
  const subdivide = spec.completeness === "obrigatoria";
  const { maxDepth, minCellHalfDiagonalM } = SEARCH_RULES.subdivision;
  const root = circleBounds(area.center, area.radiusM);

  const collect = (places: GooglePlaceV1[] | undefined): number => {
    let n = 0;
    for (const raw of places ?? []) {
      const p = toCandidatePlace(raw);
      if (!p) continue;
      n++;
      if (!byId.has(p.placeId)) byId.set(p.placeId, p);
    }
    return n;
  };

  const newSummary = (method: SearchSummary["method"], query: string): SearchSummary => ({
    layer: spec.layer,
    typeKey: spec.key,
    areaName: area.resolvedName,
    method,
    query,
    pages: 0,
    returned: 0,
    truncated: false,
    error: null,
    cells: 0,
    maxDepth: 0,
    cappedCells: 0,
  });

  async function walk(
    summary: SearchSummary,
    cell: Bounds,
    depth: number,
    run: (cell: Bounds, depth: number) => Promise<CellResult>
  ): Promise<void> {
    summary.cells++;
    summary.maxDepth = Math.max(summary.maxDepth, depth);
    const r = await run(cell, depth);
    if (!r.ok) {
      summary.error = summary.error ?? r.error;
      return;
    }
    summary.pages += r.pages;
    summary.returned += r.returned;
    if (!r.capped) return;

    const children = splitBounds(cell).filter((c) => boundsIntersectCircle(c, area.center, area.radiusM));
    const canSplit =
      subdivide &&
      depth < maxDepth &&
      children.length > 0 &&
      boundsHalfDiagonalM(children[0]) >= minCellHalfDiagonalM;
    if (!canSplit) {
      summary.cappedCells++;
      return;
    }
    await Promise.all(children.map((child) => walk(summary, child, depth + 1, run)));
  }

  for (const query of spec.textQueries) {
    const summary = newSummary("searchText", query);
    await walk(summary, root, 0, async (cell) => {
      let pages = 0;
      let returned = 0;
      let pageToken: string | undefined;
      do {
        const body: Record<string, unknown> = {
          textQuery: query,
          includedType: spec.includedType,
          strictTypeFiltering: true,
          languageCode: SEARCH_RULES.languageCode,
          regionCode: SEARCH_RULES.regionCode,
          pageSize: SEARCH_RULES.pageSize,
          locationRestriction: {
            rectangle: {
              low: { latitude: cell.south, longitude: cell.west },
              high: { latitude: cell.north, longitude: cell.east },
            },
          },
        };
        if (pageToken) body.pageToken = pageToken;
        const r = await postPlaces("searchText", body, [...fields, "nextPageToken"].join(","), deps, counter);
        if (!r.ok) return { ok: false, error: r.error };
        pages++;
        returned += (r.data.places ?? []).length;
        collect(r.data.places);
        pageToken = r.data.nextPageToken;
      } while (pageToken && pages < SEARCH_RULES.maxPagesPerQuery);
      // A searchText para de dar token ao chegar a 60, mesmo havendo mais: resultado cheio = teto.
      const capped = Boolean(pageToken) || returned >= SEARCH_RULES.pageSize * SEARCH_RULES.maxPagesPerQuery;
      return { ok: true, pages, returned, capped };
    });
    summary.truncated = summary.cappedCells > 0 && summary.error === null;
    summaries.push(summary);
  }

  if (spec.useNearbySearch) {
    const summary = newSummary("searchNearby", spec.includedType);
    await walk(summary, root, 0, async (cell, depth) => {
      // Na raiz, o próprio círculo de estudo; nas células, o círculo que contém o quadrante.
      const center = depth === 0 ? area.center : boundsCenter(cell);
      const radius = depth === 0 ? area.radiusM : boundsHalfDiagonalM(cell);
      const r = await postPlaces(
        "searchNearby",
        {
          includedTypes: [spec.includedType],
          maxResultCount: SEARCH_RULES.nearbyMaxResults,
          rankPreference: "DISTANCE",
          languageCode: SEARCH_RULES.languageCode,
          regionCode: SEARCH_RULES.regionCode,
          locationRestriction: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: Math.min(radius, 50000),
            },
          },
        },
        fields.join(","),
        deps,
        counter
      );
      if (!r.ok) return { ok: false, error: r.error };
      const returned = (r.data.places ?? []).length;
      collect(r.data.places);
      return { ok: true, pages: 1, returned, capped: returned >= SEARCH_RULES.nearbyMaxResults };
    });
    summary.truncated = summary.cappedCells > 0 && summary.error === null;
    summaries.push(summary);
  }

  return { places: [...byId.values()], summaries, requests: counter.requests };
}
