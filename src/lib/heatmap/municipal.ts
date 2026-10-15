/**
 * Indicadores do MUNICÍPIO (IBGE + manual/cache/ABVE). Não têm escala de bairro
 * e são sempre rotulados como municipais. Nunca usam a contagem de concorrentes
 * do escopo como substituto.
 */

import { ibgeFetch } from "../ibge-fetch";
import { getCityEVDataAsync, type ManualCityEVInput } from "../abve-real-data";
import { HeatmapGenerationError } from "./generate";
import type { MunicipalIndicators } from "./types";

type SupabaseArg = Parameters<typeof getCityEVDataAsync>[5];
type FetchLike = (url: string) => Promise<Response>;

const IBGE = "https://servicodados.ibge.gov.br/api";

/**
 * População e PIB do município. Falha vira erro e o mapa não é gerado: antes,
 * vinha vazio calado, e a estimativa de EVs (que usa população e PIB) saía
 * zerada no mapa como se fosse dado — mercado falsamente vazio.
 */
async function fetchIBGECityData(
  city: string,
  state: string,
  fetchImpl: FetchLike
): Promise<{ population: number; gdpPerCapita: number }> {
  const fail = (detail: string) =>
    new HeatmapGenerationError(
      `IBGE indisponível para ${city}/${state}. O mapa não foi gerado para não sair com indicadores municipais vazios.`,
      [detail]
    );
  const getJson = async (url: string, what: string) => {
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      throw fail(`${what}: ${(e as Error).message}`);
    }
    if (!res.ok) throw fail(`${what}: HTTP ${res.status}`);
    return res.json();
  };
  const latest = (data: unknown): number | null => {
    const serie = (data as { resultados?: { series?: { serie?: Record<string, string> }[] }[] }[])?.[0]
      ?.resultados?.[0]?.series?.[0]?.serie;
    const key = serie ? Object.keys(serie).sort().pop() : undefined;
    const v = key ? parseFloat(serie![key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const municipalities = (await getJson(`${IBGE}/v1/localidades/estados/${state}/municipios`, "lista de municípios")) as {
    id: number;
    nome: string;
  }[];
  const found = municipalities.find((m) => m.nome.toLowerCase() === city.toLowerCase());
  if (!found) throw fail(`município "${city}" não está na lista do IBGE para ${state}`);

  const [popData, pibData] = await Promise.all([
    getJson(`${IBGE}/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`, "população"),
    getJson(`${IBGE}/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${found.id}]`, "PIB"),
  ]);
  const population = latest(popData);
  if (population === null) throw fail("série de população veio vazia");
  const pibEmMil = latest(pibData);
  if (pibEmMil === null) throw fail("série de PIB veio vazia");
  return { population: Math.round(population), gdpPerCapita: Math.round((pibEmMil * 1000) / population) };
}

export async function loadMunicipalIndicators(
  city: string,
  state: string,
  opts: { manualData?: ManualCityEVInput | null; supabase?: SupabaseArg; fetchImpl?: FetchLike } = {}
): Promise<MunicipalIndicators> {
  const ibge = await fetchIBGECityData(city, state, opts.fetchImpl ?? ibgeFetch);
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
