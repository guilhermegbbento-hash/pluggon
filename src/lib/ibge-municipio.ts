/**
 * População e PIB do município, para o Score do Ponto e o Mapa de Calor.
 *
 * Lê da tabela ibge_municipios, carregada uma vez por ano pelo comando
 * scripts/ibge/carga-municipios.ts. O IBGE ao vivo só é consultado para
 * município que não está na tabela: desde 22/10/2026 o IBGE não responde às
 * funções da Vercel (EUA), embora responda de dentro do Brasil — e população e
 * PIB mudam uma vez por ano, não há motivo para depender dele em cada geração.
 *
 * Nada aqui vira número inventado: dado que falta é erro, com o motivo.
 */

import { ibgeFetch } from "./ibge-fetch";

const IBGE = "https://servicodados.ibge.gov.br/api";
const TENTATIVAS = 2;
const TIMEOUT_MS = 8_000;

export interface MunicipioIBGE {
  codigo: number;
  population: number;
  populationYear: number;
  /** PIB total em R$. */
  gdpTotal: number;
  gdpPerCapita: number;
  gdpYear: number;
  origem: "banco" | "ibge_ao_vivo";
}

/** Falha de dado do IBGE. Cada produto converte no seu erro visível. */
export class IbgeMunicipioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IbgeMunicipioError";
  }
}

type FetchLike = (url: string) => Promise<Response>;

interface Linha {
  cd_mun: number;
  populacao: number;
  ano_populacao: number;
  pib_mil: number | string | null;
  ano_pib: number | null;
  carregado_em: string;
}

/** O mínimo do cliente do Supabase que a leitura usa. */
export interface IbgeDb {
  from(table: "ibge_municipios"): {
    select(cols: string): {
      eq(col: "uf", value: string): {
        eq(col: "nome_busca", value: string): PromiseLike<{ data: Linha[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/** Chave de busca do nome. A carga grava com esta mesma função. */
export function nomeBusca(nome: string): string {
  return nome.trim().toLowerCase();
}

export async function getMunicipioIBGE(
  city: string,
  state: string,
  opts: { db: IbgeDb | null; fetchImpl?: FetchLike }
): Promise<MunicipioIBGE> {
  const uf = state.trim().toUpperCase();
  const local = `${city}/${uf}`;

  let semBanco: string;
  if (!opts.db) {
    semBanco = "sem acesso à base de municípios";
  } else {
    let linhas: Linha[] | null = null;
    let erro: string | null = null;
    try {
      const r = await opts.db
        .from("ibge_municipios")
        .select("cd_mun, populacao, ano_populacao, pib_mil, ano_pib, carregado_em")
        .eq("uf", uf)
        .eq("nome_busca", nomeBusca(city));
      linhas = r.data;
      erro = r.error?.message ?? null;
    } catch (e) {
      erro = (e as Error).message;
    }
    if (!erro && linhas && linhas.length > 0) {
      console.log(`IBGE ${local}: base de municípios`);
      return daLinha(linhas[0], local);
    }
    semBanco = erro ? `não foi lido da base de municípios (${erro})` : "não está na base de municípios";
  }

  try {
    const m = await aoVivo(city, uf, opts.fetchImpl ?? ((url) => ibgeFetch(url, { timeoutMs: TIMEOUT_MS })));
    console.log(`IBGE ${local}: ao vivo (${semBanco})`);
    return m;
  } catch (e) {
    throw new IbgeMunicipioError(`${local} ${semBanco}, e o IBGE ao vivo falhou — ${(e as Error).message}`);
  }
}

function daLinha(l: Linha, local: string): MunicipioIBGE {
  const carga = new Date(l.carregado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const pibMil = l.pib_mil === null ? null : Number(l.pib_mil);
  if (pibMil === null || !(pibMil > 0) || l.ano_pib === null) {
    throw new IbgeMunicipioError(`o IBGE ainda não publicou o PIB de ${local} (base de municípios carregada em ${carga})`);
  }
  if (!(l.populacao > 0)) {
    throw new IbgeMunicipioError(`população de ${local} está vazia na base de municípios (carregada em ${carga})`);
  }
  const gdpTotal = pibMil * 1000;
  return {
    codigo: l.cd_mun,
    population: l.populacao,
    populationYear: l.ano_populacao,
    gdpTotal,
    gdpPerCapita: Math.round(gdpTotal / l.populacao),
    gdpYear: l.ano_pib,
    origem: "banco",
  };
}

async function aoVivo(city: string, uf: string, fetchImpl: FetchLike): Promise<MunicipioIBGE> {
  const lista = (await getJson(fetchImpl, `${IBGE}/v1/localidades/estados/${uf}/municipios`, "lista de municípios")) as {
    id: number;
    nome: string;
  }[];
  const found = lista.find((m) => nomeBusca(m.nome) === nomeBusca(city));
  if (!found) throw new Error(`município "${city}" não está na lista do IBGE para ${uf}`);

  const [pop, pib] = await Promise.all([
    getJson(fetchImpl, `${IBGE}/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${found.id}]`, "população"),
    getJson(fetchImpl, `${IBGE}/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${found.id}]`, "PIB"),
  ]);
  const population = ultimoValor(pop);
  if (!population) throw new Error("série de população veio vazia");
  const pibMil = ultimoValor(pib);
  if (!pibMil) throw new Error("série de PIB veio vazia");

  const gdpTotal = pibMil.valor * 1000;
  return {
    codigo: found.id,
    population: Math.round(population.valor),
    populationYear: population.ano,
    gdpTotal,
    gdpPerCapita: Math.round(gdpTotal / population.valor),
    gdpYear: pibMil.ano,
    origem: "ibge_ao_vivo",
  };
}

/** GET com nova tentativa em falha de rede, timeout ou 5xx. 4xx não repete: a resposta seria a mesma. */
async function getJson(fetchImpl: FetchLike, url: string, what: string): Promise<unknown> {
  let ultimo = "";
  let feitas = 0;
  while (feitas < TENTATIVAS) {
    feitas++;
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      ultimo = (e as Error).message;
      continue;
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new Error(`${what}: resposta do IBGE não é JSON`);
      }
    }
    ultimo = `HTTP ${res.status}`;
    if (res.status < 500) break;
  }
  throw new Error(`${what}: ${ultimo}${feitas > 1 ? ` (${feitas} tentativas)` : ""}`);
}

/** Último valor positivo da série de um agregado do IBGE, com o ano. */
export function ultimoValor(data: unknown): { valor: number; ano: number } | null {
  const serie = (data as { resultados?: { series?: { serie?: Record<string, string> }[] }[] }[])?.[0]?.resultados?.[0]
    ?.series?.[0]?.serie;
  const key = serie ? Object.keys(serie).sort().pop() : undefined;
  const valor = key ? parseFloat(serie![key]) : NaN;
  const ano = key ? parseInt(key, 10) : NaN;
  return Number.isFinite(valor) && valor > 0 && Number.isFinite(ano) ? { valor, ano } : null;
}
