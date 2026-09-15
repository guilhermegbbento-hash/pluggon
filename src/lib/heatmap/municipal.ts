/**
 * Indicadores do MUNICÍPIO (IBGE + manual/cache/ABVE). Não têm escala de bairro
 * e são sempre rotulados como municipais. Nunca usam a contagem de concorrentes
 * do escopo como substituto.
 */

import { getCityEVDataAsync, type ManualCityEVInput } from "../abve-real-data";
import type { MunicipalIndicators } from "./types";

type SupabaseArg = Parameters<typeof getCityEVDataAsync>[5];

async function fetchIBGECityData(
  city: string,
  state: string,
  fetchImpl: typeof fetch
): Promise<{ population: number | null; gdpPerCapita: number | null }> {
  const result = { population: null as number | null, gdpPerCapita: null as number | null };
  const latest = (data: unknown): string | null => {
    const serie = (data as { resultados?: { series?: { serie?: Record<string, string> }[] }[] }[])?.[0]
      ?.resultados?.[0]?.series?.[0]?.serie;
    if (!serie) return null;
    const key = Object.keys(serie).sort().pop();
    return key ? serie[key] : null;
  };
  try {
    const res = await fetchImpl(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`);
    if (!res.ok) return result;
    const municipalities = (await res.json()) as { id: number; nome: string }[];
    const found = municipalities.find((m) => m.nome.toLowerCase() === city.toLowerCase());
    if (!found) return result;

    try {
      const pop = await fetchImpl(
        `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`
      );
      const v = pop.ok ? latest(await pop.json()) : null;
      if (v) result.population = parseInt(v, 10);
    } catch {}

    try {
      const pib = await fetchImpl(
        `https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${found.id}]`
      );
      const v = pib.ok ? latest(await pib.json()) : null;
      if (v && result.population) {
        result.gdpPerCapita = Math.round((parseFloat(v) * 1000) / result.population);
      }
    } catch {}
  } catch {}
  return result;
}

export async function loadMunicipalIndicators(
  city: string,
  state: string,
  opts: { manualData?: ManualCityEVInput | null; supabase?: SupabaseArg; fetchImpl?: typeof fetch } = {}
): Promise<MunicipalIndicators> {
  const ibge = await fetchIBGECityData(city, state, opts.fetchImpl ?? fetch);
  const ev = await getCityEVDataAsync(
    city,
    state,
    ibge.population ?? 0,
    ibge.gdpPerCapita ?? 0,
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
