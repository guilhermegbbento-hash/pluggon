/**
 * Régua de qualidade das âncoras e corte por renda.
 *
 * Duas regras diferentes, de propósito:
 * - PORTE (config: facilitySignal por tipo) elimina o que não é o que diz ser —
 *   galeria chamada "shopping", posto sem nenhuma avaliação. Roda no pipeline,
 *   junto da validação de tipo, e vira descarte com motivo.
 * - RÉGUA (aqui) ordena o que sobrou e corta pela nota. A renda não entra na
 *   nota: ela muda o CORTE. Região de renda baixa exige nota maior, e só
 *   aeroporto, rodoviária, hospital e shopping grande alcançam.
 *
 * Setor sem renda (praça, terminal, parque — não tem domicílio, logo não tem
 * responsável) NÃO é penalizado, e nunca herda valor de vizinho.
 */

import { RANKING_RULES, RENDA_RULES, type RendaFaixa } from "./config";

/** Volume de avaliações numa escala log: mil avaliações = 10. */
export function notaAvaliacoes(avaliacoes: number): number {
  const n = Math.max(0, avaliacoes || 0);
  return Math.min(10, (Math.log10(1 + n) / RANKING_RULES.divisorLogAvaliacoes) * 10);
}

/** Nota do lugar em si, de 0 a 10. */
export function notaAncora(tipo: string, avaliacoes: number): number {
  const { tipoScore, tipoScorePadrao, pesoTipo, pesoAvaliacoes } = RANKING_RULES;
  const nota = (tipoScore[tipo] ?? tipoScorePadrao) * pesoTipo + notaAvaliacoes(avaliacoes) * pesoAvaliacoes;
  return nota / (pesoTipo + pesoAvaliacoes);
}

/** Faixa a partir da renda MEDIANA do responsável, em reais do ano do dado. */
export function faixaDeRenda(medianaEmReais: number | null | undefined): RendaFaixa {
  if (medianaEmReais === null || medianaEmReais === undefined || !Number.isFinite(medianaEmReais)) {
    return "sem dado";
  }
  const sm = medianaEmReais / RENDA_RULES.salarioMinimoDoDado;
  for (const faixa of RENDA_RULES.faixas) {
    if (sm >= faixa.minSM) return faixa.nome;
  }
  return "baixa";
}

/** Renda baixa exige nota maior; sem dado usa o corte normal (não penaliza). */
export function corteDaFaixa(faixa: RendaFaixa): number {
  return faixa === "baixa" ? RANKING_RULES.corteRendaBaixa : RANKING_RULES.corteNormal;
}

export interface DecisaoAncora {
  nota: number;
  corte: number;
  aprovada: boolean;
  /** Só quando reprovada: distingue corte por renda de corte pela régua. */
  motivo: "renda_baixa" | "regua" | null;
}

export function decidirAncora(tipo: string, avaliacoes: number, faixa: RendaFaixa): DecisaoAncora {
  const nota = notaAncora(tipo, avaliacoes);
  const corte = corteDaFaixa(faixa);
  const aprovada = nota >= corte;
  return {
    nota: Math.round(nota * 100) / 100,
    corte,
    aprovada,
    motivo: aprovada ? null : faixa === "baixa" ? "renda_baixa" : "regua",
  };
}
