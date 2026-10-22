import { getMunicipioIBGE, IbgeMunicipioError, type IbgeDb } from "@/lib/ibge-municipio";
import { ScoreDataError } from "./errors";

export interface IBGEData {
  population: number;
  /** Ano da estimativa de população do IBGE — exibido no relatório. */
  population_year: number;
  gdp_total: number;
  gdp_per_capita: number;
  /** Ano do PIB municipal do IBGE — exibido no relatório. */
  gdp_year: number;
}

type FetchLike = (url: string) => Promise<Response>;

/**
 * População e PIB entram no score: sem eles o Score não é gerado. Vêm da base
 * de municípios (src/lib/ibge-municipio.ts); o IBGE ao vivo só para município
 * que não está nela.
 */
export async function fetchIBGEData(
  city: string,
  state: string,
  opts: { db: IbgeDb | null; fetchImpl?: FetchLike }
): Promise<IBGEData> {
  try {
    const m = await getMunicipioIBGE(city, state, opts);
    return {
      population: m.population,
      population_year: m.populationYear,
      gdp_total: m.gdpTotal,
      gdp_per_capita: m.gdpPerCapita,
      gdp_year: m.gdpYear,
    };
  } catch (e) {
    if (e instanceof IbgeMunicipioError) throw new ScoreDataError("ibge", e.message);
    throw e;
  }
}
