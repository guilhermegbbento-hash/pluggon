/**
 * Indicadores do MUNICÍPIO (IBGE + manual/cache/ABVE). Não têm escala de bairro
 * e são sempre rotulados como municipais. Nunca usam a contagem de concorrentes
 * do escopo como substituto.
 */

import { getCityEVDataAsync, type ManualCityEVInput } from "../abve-real-data";
import { getMunicipioIBGE, IbgeMunicipioError, type IbgeDb } from "../ibge-municipio";
import { HeatmapGenerationError } from "./generate";
import type { MunicipalIndicators } from "./types";

type SupabaseArg = Parameters<typeof getCityEVDataAsync>[5];
type FetchLike = (url: string) => Promise<Response>;

/**
 * População e PIB do município (base de municípios; IBGE ao vivo só para
 * município que não está nela). Falha vira erro e o mapa não é gerado: antes,
 * vinha vazio calado, e a estimativa de EVs (que usa população e PIB) saía
 * zerada no mapa como se fosse dado — mercado falsamente vazio.
 */
export async function loadMunicipalIndicators(
  city: string,
  state: string,
  opts: { manualData?: ManualCityEVInput | null; supabase?: SupabaseArg; fetchImpl?: FetchLike } = {}
): Promise<MunicipalIndicators> {
  let ibge;
  try {
    ibge = await getMunicipioIBGE(city, state, {
      db: (opts.supabase ?? null) as unknown as IbgeDb | null,
      fetchImpl: opts.fetchImpl,
    });
  } catch (e) {
    if (!(e instanceof IbgeMunicipioError)) throw e;
    throw new HeatmapGenerationError(
      `Dados do IBGE indisponíveis para ${city}/${state}. O mapa não foi gerado para não sair com indicadores municipais vazios.`,
      [e.message]
    );
  }
  const ev = await getCityEVDataAsync(
    city,
    state,
    ibge.population,
    ibge.gdpPerCapita,
    opts.manualData ?? null,
    opts.supabase ?? null
  );
  return {
    city,
    state,
    population: ibge.population,
    gdpPerCapita: ibge.gdpPerCapita,
    populationYear: ibge.populationYear,
    gdpYear: ibge.gdpYear,
    ibgeOrigem: ibge.origem,
    totalEVs: ev.totalEVs,
    bev: ev.bev,
    phev: ev.phev,
    bevPlusPHEV: ev.bevPlusPHEV,
    dcChargers: ev.dcChargers,
    acChargers: ev.acChargers,
    totalChargers: ev.totalChargers,
    ratioEVperDC: ev.ratioEVperDC,
    evsSource: ev.source,
    evsSourceTag: ev.evsSourceTag,
    chargersSource: ev.chargersSource,
    chargersSourceTag: ev.chargersSourceTag,
    cacheUpdatedAt: ev.cacheUpdatedAt ?? null,
  };
}
