/**
 * Orquestração do gerador: escopo → buscas restritas → pipeline → QA gate.
 * Usado pela rota da API, pelo script de regressão e pelo teste ao vivo.
 */

import { APP_VERSION } from "../version";
import { PLACE_TYPE_SPECS } from "./config";
import { fetchOpenChargeMapInArea, mergeOpenChargeMap } from "./competitors";
import { searchComplementaryAroundAnchors, searchSpecInArea, type FetchFn } from "./places";
import { runPipeline } from "./pipeline";
import { assertQaGate } from "./qa-gate";
import { googleGeocoder, resolveScope, type GeocodeFn, type ScopeInput } from "./scope";
import type {
  Candidate,
  HeatmapPayload,
  MunicipalIndicators,
  SearchSummary,
  SourceStatus,
  StudyScope,
} from "./types";

export class HeatmapGenerationError extends Error {
  constructor(message: string, public readonly details: string[] = []) {
    super(message);
    this.name = "HeatmapGenerationError";
  }
}

export interface GenerateDeps {
  googleApiKey: string;
  ocmApiKey?: string | null;
  fetchImpl?: FetchFn;
  geocode?: GeocodeFn;
  loadMunicipal?: (scope: StudyScope) => Promise<MunicipalIndicators | null>;
  now?: () => Date;
}

export async function generateHeatmap(input: ScopeInput, deps: GenerateDeps): Promise<HeatmapPayload> {
  let geocodeCalls = 0;
  const baseGeocode = deps.geocode ?? googleGeocoder(deps.googleApiKey, deps.fetchImpl);
  const geocode: GeocodeFn = (address, state) => {
    geocodeCalls++;
    return baseGeocode(address, state);
  };

  const scope = await resolveScope(input, geocode);

  const candidates: Candidate[] = [];
  const searches: SearchSummary[] = [];
  const sources: SourceStatus[] = [];
  let placesRequests = 0;

  // 1. Âncoras e concorrentes são buscados no escopo inteiro, cada um até
  //    completar. Complementares NÃO: eles só valem perto de âncora, então são
  //    buscados depois, em volta das âncoras que sobreviverem à validação.
  const scopeSpecs = PLACE_TYPE_SPECS.filter((s) => s.layer !== "complementary");
  for (const area of scope.areas) {
    const [results, ocm] = await Promise.all([
      Promise.all(
        scopeSpecs.map(async (spec) => ({
          spec,
          result: await searchSpecInArea(spec, area, { apiKey: deps.googleApiKey, fetchImpl: deps.fetchImpl }),
        }))
      ),
      fetchOpenChargeMapInArea(area, { ocmApiKey: deps.ocmApiKey, fetchImpl: deps.fetchImpl }),
    ]);
    sources.push(ocm.status);

    let ocmMerged = false;
    for (const { spec, result } of results) {
      placesRequests += result.requests;
      searches.push(...result.summaries);
      let places = result.places;
      if (spec.layer === "competitor" && !ocmMerged) {
        places = mergeOpenChargeMap(places, ocm.places);
        ocmMerged = true;
      }
      for (const place of places) candidates.push({ layer: spec.layer, typeKey: spec.key, place });
    }
  }

  // Busca quebrada aborta ANTES de gastar com os complementares.
  const failedScope = searches.filter((s) => s.error !== null);
  if (failedScope.length > 0) {
    throw new HeatmapGenerationError(
      `Falha em ${failedScope.length} busca(s) do Google Places. O relatório não foi gerado para não sair com camada falsamente vazia.`,
      failedScope.map((s) => `${s.layer}/${s.typeKey} ${s.method} "${s.query}" em ${s.areaName}: ${s.error}`)
    );
  }

  // 2. Âncoras que realmente vão ao mapa (validadas, sem duplicata, sem colisão
  //    com concorrente) — são elas que definem onde procurar complementares.
  const anchorsForComplementary = runPipeline(scope, candidates).anchors;

  // 3. Complementares em volta de cada âncora: uma requisição por âncora.
  const complementary = await searchComplementaryAroundAnchors(
    anchorsForComplementary.map((a) => ({ placeId: a.placeId, lat: a.lat, lng: a.lng, areaName: a.areaName })),
    { apiKey: deps.googleApiKey, fetchImpl: deps.fetchImpl }
  );
  placesRequests += complementary.requests;
  searches.push(...complementary.summaries);
  for (const c of complementary.candidates) {
    candidates.push({ layer: "complementary", typeKey: c.typeKey, place: c.place });
  }

  const failed = searches.filter((s) => s.error !== null);
  const truncated = searches.filter((s) => s.truncated);
  sources.unshift({
    name: "Google Places (New)",
    status: failed.length > 0 ? "erro" : "ok",
    detail:
      `${placesRequests} requisições em ${searches.reduce((n, s) => n + s.cells, 0)} células` +
      (truncated.length > 0 ? `; ${truncated.length} busca(s) no teto da API` : ""),
  });
  if (failed.length > 0) {
    throw new HeatmapGenerationError(
      `Falha em ${failed.length} busca(s) do Google Places. O relatório não foi gerado para não sair com camada falsamente vazia.`,
      failed.map((s) => `${s.layer}/${s.typeKey} ${s.method} "${s.query}" em ${s.areaName}: ${s.error}`)
    );
  }

  const result = runPipeline(scope, candidates);
  const municipal = deps.loadMunicipal ? await deps.loadMunicipal(scope) : null;

  const draft: HeatmapPayload = {
    generatorVersion: APP_VERSION,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    scope,
    ...result,
    searches,
    sources,
    municipal,
    qa: null,
    googleQueries: geocodeCalls + placesRequests,
  };
  return { ...draft, qa: assertQaGate(draft) };
}
