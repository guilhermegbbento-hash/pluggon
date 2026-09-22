/**
 * Tipo de carregador do eletroposto, sempre a partir de dado — nunca do nome.
 *
 * Fonte única: evChargeOptions.maxChargeRateKw da Places API (New). Sem dado →
 * "unknown" ("não informado" no relatório), fora de qualquer contagem DC/AC.
 *
 * O OpenChargeMap saiu em 22/09/2026. Medido contra os cinco escopos da
 * regressão: rendia 1 eletroposto novo em 5 bairros (e era um 7 kW de garagem)
 * e preenchia a potência de 4 dos 97 concorrentes que estavam sem ela. Não
 * pagava a chave, nem a atribuição por fornecedor dentro do HTML do cliente,
 * nem o risco de banimento da política de uso justo deles. Se um dia voltar,
 * volta pelo dump aberto do GitHub (openchargemap/ocm-export), sem chave.
 */

import { CHARGER_RULES } from "./config";
import type { ChargerType } from "./types";

export function chargerTypeFor(kw: number | null): ChargerType {
  if (kw === null || kw <= 0) return "unknown";
  return kw >= CHARGER_RULES.dcMinKw ? "DC" : "AC";
}
