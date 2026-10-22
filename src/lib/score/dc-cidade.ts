import { ScoreDataError } from "./errors";

/**
 * DC da cidade (ABVE) que o Score usa. Sem número cadastrado, o Score não sai:
 * a contagem do Google que ocupava esse lugar nascia cortada no teto da API e
 * ficava congelada no cadastro como se fosse dado do dono (22/10/2026).
 * 0 é dado — cidade sem carregador DC.
 */
export function exigirDcCidade(dc: number | null | undefined, city: string, state: string): number {
  if (typeof dc === "number" && Number.isFinite(dc) && dc >= 0) return dc;
  throw new ScoreDataError(
    "dc_cidade",
    `${city}/${state} ainda não tem o número de carregadores DC da ABVE cadastrado, e o Score não estima esse número. ` +
      `Para gerar: na busca por cidade, preencha "Carregadores DC" em Dados da cidade com o número do painel da ABVE ` +
      `(0 se a cidade não tem carregador DC) e gere o Score de novo.`,
    400
  );
}
