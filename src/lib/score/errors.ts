/**
 * Erros que bloqueiam o Score do Ponto. No molde do QA gate do Mapa de Calor:
 * camada que falha vira erro visível, nunca resultado vazio — um zero por falha
 * não pode chegar ao cliente como se fosse um zero de verdade.
 */

export type ScoreLayer =
  | "localizacao"
  | "centro_da_cidade"
  | "ibge"
  | "concorrentes"
  | "dc_cidade"
  | "pontos_fortes"
  | "historico";

const LAYER_LABELS: Record<ScoreLayer, string> = {
  localizacao: "localização do ponto",
  centro_da_cidade: "centro da cidade",
  ibge: "dados do IBGE",
  concorrentes: "concorrentes",
  dc_cidade: "DC da cidade (ABVE)",
  pontos_fortes: "pontos fortes (Claude)",
  historico: "gravação no histórico",
};

export class ScoreDataError extends Error {
  constructor(
    public readonly layer: ScoreLayer,
    detail: string,
    /** 502 = fonte externa falhou; 500 = falha nossa (banco); 400 = falta dado que o usuário informa. */
    public readonly status: 400 | 500 | 502 = 502
  ) {
    super(`Score não gerado — falha em ${LAYER_LABELS[layer]}: ${detail}`);
    this.name = "ScoreDataError";
  }
}
