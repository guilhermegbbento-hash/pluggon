import type { ScopeInput } from "../../src/lib/heatmap/scope";

export interface RegressionCase {
  id: string;
  label: string;
  purpose: string;
  input: ScopeInput;
}

/** Os seis escopos da regressão. Nomes de lugar só existem aqui, nunca no gerador. */
export const REGRESSION_CASES: RegressionCase[] = [
  {
    id: "a",
    label: "Morumbi — São Paulo/SP",
    purpose: "caso original do relatório contaminado",
    input: { city: "São Paulo", state: "SP", regions: ["Morumbi"] },
  },
  {
    id: "b",
    label: "Itaim Bibi — São Paulo/SP",
    purpose: "bairro denso com concorrentes reais no raio",
    input: { city: "São Paulo", state: "SP", regions: ["Itaim Bibi"] },
  },
  {
    id: "c",
    label: "Batel — Curitiba/PR",
    purpose: "bairro de capital fora de SP",
    input: { city: "Curitiba", state: "PR", regions: ["Batel"] },
  },
  {
    id: "d",
    label: "Centro — Florianópolis/SC",
    purpose: "nome ambíguo (existe em várias cidades)",
    input: { city: "Florianópolis", state: "SC", regions: ["Centro"] },
  },
  {
    id: "e",
    label: "Jardim Ângela — São Paulo/SP",
    purpose: "periferia: zero concorrente tem que sair como resultado, sem ampliar busca",
    input: { city: "São Paulo", state: "SP", regions: ["Jardim Ângela"] },
  },
  {
    id: "f",
    label: "Curitiba/PR (cidade inteira)",
    purpose: "modo cidade continua funcionando",
    input: { city: "Curitiba", state: "PR", regions: [] },
  },
];

/** Escopos que TÊM que abortar (desambiguação). */
export const ABORT_CASES: RegressionCase[] = [
  {
    id: "x1",
    label: "Morumbi — Curitiba/PR",
    purpose: "bairro que só existe em outras cidades: aborta, não cai no centro do município",
    input: { city: "Curitiba", state: "PR", regions: ["Morumbi"] },
  },
  {
    id: "x2",
    label: "Bairro inexistente — Curitiba/PR",
    purpose: "geocoding devolve estabelecimento parcial: aborta",
    input: { city: "Curitiba", state: "PR", regions: ["Bairro Inexistente Xyzzy"] },
  },
];
