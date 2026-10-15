import { ibgeFetch } from "@/lib/ibge-fetch";
import { ScoreDataError } from "./errors";

export interface IBGEData {
  population: number;
  gdp_total: number;
  gdp_per_capita: number;
  /** Só exibido no relatório, não entra no score: ausente não bloqueia. */
  idhm: number | null;
}

type FetchLike = (url: string) => Promise<Response>;

const IBGE = "https://servicodados.ibge.gov.br/api";

/** Último valor da série de um agregado do IBGE, ou null se a série não veio. */
async function latestSeriesValue(fetchImpl: FetchLike, url: string): Promise<number | null> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const data = await res.json();
  const series = data?.[0]?.resultados?.[0]?.series?.[0]?.serie as Record<string, string> | undefined;
  if (!series) return null;
  const latestKey = Object.keys(series).sort().pop();
  if (!latestKey) return null;
  const value = parseFloat(series[latestKey]);
  return Number.isFinite(value) ? value : null;
}

/**
 * População e PIB entram no score: sem eles o Score não é gerado. Antes, qualquer
 * falha aqui virava população 0 e PIB 0 e o score era calculado assim mesmo.
 */
export async function fetchIBGEData(
  city: string,
  state: string,
  fetchImpl: FetchLike = ibgeFetch
): Promise<IBGEData> {
  let municipalities: Array<{ id: number; nome: string }>;
  try {
    const res = await fetchImpl(`${IBGE}/v1/localidades/estados/${state}/municipios`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    municipalities = await res.json();
  } catch (e) {
    throw new ScoreDataError("ibge", `lista de municípios de ${state} indisponível (${(e as Error).message})`);
  }

  const found = municipalities.find((m) => m.nome.toLowerCase() === city.toLowerCase());
  if (!found) {
    throw new ScoreDataError("ibge", `município "${city}" não encontrado na lista do IBGE para ${state}`);
  }

  const read = async (label: string, url: string) => {
    try {
      return await latestSeriesValue(fetchImpl, url);
    } catch (e) {
      throw new ScoreDataError("ibge", `${label} de ${city}/${state} indisponível (${(e as Error).message})`);
    }
  };

  const [population, pibEmMil] = await Promise.all([
    read("população", `${IBGE}/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`),
    read("PIB", `${IBGE}/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${found.id}]`),
  ]);
  if (population === null || population <= 0) {
    throw new ScoreDataError("ibge", `população de ${city}/${state} veio vazia`);
  }
  if (pibEmMil === null || pibEmMil <= 0) {
    throw new ScoreDataError("ibge", `PIB de ${city}/${state} veio vazio`);
  }

  let idhm: number | null = null;
  try {
    idhm = await latestSeriesValue(
      fetchImpl,
      `${IBGE}/v3/agregados/1387/periodos/-1/variaveis/4359?localidades=N6[${found.id}]`
    );
  } catch {
    // IDHM é só exibido no relatório.
  }

  const gdpTotal = pibEmMil * 1000;
  return {
    population: Math.round(population),
    gdp_total: gdpTotal,
    gdp_per_capita: Math.round(gdpTotal / population),
    idhm,
  };
}
