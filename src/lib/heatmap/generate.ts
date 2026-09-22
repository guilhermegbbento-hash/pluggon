/**
 * Orquestração do gerador: escopo → buscas restritas → pipeline → QA gate.
 * Usado pela rota da API, pelo script de regressão e pelo teste ao vivo.
 */

import { APP_VERSION } from "../version";
import { PLACE_TYPE_SPECS } from "./config";
import { fetchOpenChargeMapInArea, mergeOpenChargeMap } from "./competitors";
import { searchComplementaryAroundAnchors, searchSpecInArea, type FetchFn } from "./places";
import { computeCounters, runPipeline } from "./pipeline";
import { assertQaGate } from "./qa-gate";
import { decidirAncora, faixaDeRenda } from "./ranking";
import { googleGeocoder, resolveScope, type GeocodeFn, type ScopeInput } from "./scope";
import type {
  AnchorOut,
  Candidate,
  Discard,
  HeatmapPayload,
  MunicipalIndicators,
  SearchSummary,
  SourceStatus,
  StudyScope,
} from "./types";

/** Renda do setor onde a âncora caiu. `rendaMediana` null = setor sem domicílio ou município não ingerido. */
export interface RendaDoPonto {
  rendaMediana: number | null;
}

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
  /**
   * Renda por âncora, vinda do banco (censo_setores). Sem esta dependência, a
   * renda simplesmente não entra no corte — nunca é inventada nem herdada.
   */
  loadRenda?: (anchors: AnchorOut[]) => Promise<Map<string, RendaDoPonto>>;
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
  /** Âncoras válidas que a régua ou a renda cortaram — entram nos descartes do relatório. */
  const discardsDoCorte: Discard[] = [];
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

  // 2. Âncoras validadas (sem duplicata, sem colisão com concorrente e já sem
  //    o que não tem porte). O piso de porte roda no pipeline; a régua e a
  //    renda cortam aqui.
  const validadas = runPipeline(scope, candidates).anchors;

  // 3. Renda do setor censitário de cada âncora. Sem município ingerido, vem
  //    "sem dado" — que NÃO penaliza, por decisão de produto.
  const renda = deps.loadRenda ? await deps.loadRenda(validadas) : new Map<string, RendaDoPonto>();
  if (deps.loadRenda) {
    const comDado = validadas.filter((a) => renda.get(a.placeId)?.rendaMediana != null).length;
    sources.push({
      name: "Renda por setor (Censo 2022)",
      status: comDado > 0 ? "ok" : "indisponivel",
      detail:
        comDado > 0
          ? `${comDado} de ${validadas.length} âncoras com renda do setor; o resto é setor sem domicílio ou município não ingerido (não penaliza)`
          : "nenhuma âncora com renda: rode a ingestão do município (npm run ingerir-renda) — sem ela a renda não entra no corte",
    });
  }

  // 4. Régua + corte. Renda não entra na nota: ela muda o corte exigido.
  const aprovadas: AnchorOut[] = [];
  for (const a of validadas) {
    const r = renda.get(a.placeId);
    const faixa = faixaDeRenda(r?.rendaMediana ?? null);
    const decisao = decidirAncora(a.type, a.userRatingCount, faixa);
    if (decisao.aprovada) {
      aprovadas.push({ ...a, rankScore: decisao.nota, rendaFaixa: faixa, rendaMediana: r?.rendaMediana ?? null });
      continue;
    }
    discardsDoCorte.push({
      layer: "anchor",
      typeKey: a.type,
      placeId: a.placeId,
      name: a.name,
      lat: a.lat,
      lng: a.lng,
      distanceToCenterM: a.distanceToCenterM,
      reason: decisao.motivo === "renda_baixa" ? "ancora_abaixo_do_corte_renda_baixa" : "ancora_abaixo_do_corte",
      detail: `nota ${decisao.nota} < ${decisao.corte} (${a.userRatingCount} avaliações, renda ${faixa})`,
    });
  }
  const aprovadasPorId = new Set(aprovadas.map((a) => a.placeId));
  const anchorsFound = validadas.length;

  // 5. Complementares em volta das âncoras APROVADAS: uma requisição por âncora.
  //    Cortar antes de buscar é o que segura o custo em escopo grande.
  const complementary = await searchComplementaryAroundAnchors(
    aprovadas.map((a) => ({ placeId: a.placeId, lat: a.lat, lng: a.lng, areaName: a.areaName })),
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

  // 6. Pipeline final com tudo. As âncoras reprovadas saem AQUI: sem esse
  //    filtro, o pipeline as recalcularia do zero e elas voltariam ao mapa.
  const bruto = runPipeline(scope, candidates);
  const anchors = bruto.anchors
    .filter((a) => aprovadasPorId.has(a.placeId))
    .map((a) => {
      const aprovada = aprovadas.find((x) => x.placeId === a.placeId)!;
      return { ...a, rankScore: aprovada.rankScore, rendaFaixa: aprovada.rendaFaixa, rendaMediana: aprovada.rendaMediana };
    })
    .sort((x, y) => y.rankScore - x.rankScore);
  const result = {
    anchors,
    complementary: bruto.complementary,
    competitors: bruto.competitors,
    counters: computeCounters(anchors, bruto.complementary, bruto.competitors, anchorsFound),
    discards: [...bruto.discards, ...discardsDoCorte],
  };
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
