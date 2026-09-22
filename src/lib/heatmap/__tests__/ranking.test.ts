import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKING_RULES, RENDA_RULES } from "../config";
import { corteDaFaixa, decidirAncora, faixaDeRenda, notaAncora, notaAvaliacoes } from "../ranking";

test("volume de avaliações entra em escala log: mil avaliações = nota 10", () => {
  assert.equal(notaAvaliacoes(0), 0);
  assert.equal(Math.round(notaAvaliacoes(999) * 10) / 10, 10);
  assert.equal(notaAvaliacoes(50000), 10, "teto em 10, não cresce para sempre");
  assert.ok(notaAvaliacoes(100) > notaAvaliacoes(10), "mais avaliações, nota maior");
  // Dobrar o volume vale menos quanto maior ele já é.
  assert.ok(notaAvaliacoes(20) - notaAvaliacoes(10) > notaAvaliacoes(2000) - notaAvaliacoes(1000));
});

test("nota do lugar: tipo e movimento pesam igual", () => {
  // Aeroporto sem avaliação nenhuma não passa na frente de posto movimentado.
  assert.ok(notaAncora("gas_station", 1000) > notaAncora("airport", 0));
  // Mesmo movimento, tipo melhor ganha.
  assert.ok(notaAncora("airport", 500) > notaAncora("gas_station", 500));
  // Tipo desconhecido não quebra nem ganha vantagem.
  assert.ok(notaAncora("tipo_novo", 100) < notaAncora("shopping_mall", 100));
});

test("os quatro que têm que ficar passam no corte normal e no de renda baixa", () => {
  const { corteNormal, corteRendaBaixa } = RANKING_RULES;
  for (const [tipo, avaliacoes] of [
    ["airport", 18004],
    ["bus_station", 2804],
    ["shopping_mall", 1000],
    ["hospital", 1000],
  ] as const) {
    const nota = notaAncora(tipo, avaliacoes);
    assert.ok(nota >= corteNormal, `${tipo} com ${avaliacoes} avaliações deveria passar no corte normal`);
    assert.ok(nota >= corteRendaBaixa, `${tipo} com ${avaliacoes} avaliações deveria passar mesmo em renda baixa`);
  }
});

test("faixa de renda usa o salário mínimo DO ANO DO DADO", () => {
  const sm = RENDA_RULES.salarioMinimoDoDado;
  assert.equal(faixaDeRenda(sm * 4), "alta");
  assert.equal(faixaDeRenda(sm * 3), "média-alta");
  assert.equal(faixaDeRenda(sm * 2), "média");
  assert.equal(faixaDeRenda(sm * 1.2), "baixa");
  assert.equal(faixaDeRenda(null), "sem dado");
  assert.equal(faixaDeRenda(undefined), "sem dado");
  assert.equal(faixaDeRenda(Number.NaN), "sem dado");
});

test("sem dado NÃO penaliza: usa o corte normal, igual a renda alta", () => {
  assert.equal(corteDaFaixa("sem dado"), RANKING_RULES.corteNormal);
  assert.equal(corteDaFaixa("alta"), RANKING_RULES.corteNormal);
  assert.equal(corteDaFaixa("média"), RANKING_RULES.corteNormal);
  assert.equal(corteDaFaixa("baixa"), RANKING_RULES.corteRendaBaixa);
  // Mercado Público e terminal caem em setor sem domicílio: não podem ser cortados por isso.
  assert.equal(decidirAncora("shopping_mall", 97099, "sem dado").aprovada, true);
  assert.equal(decidirAncora("bus_station", 2804, "sem dado").aprovada, true);
});

test("renda baixa exige mais: posto de passagem fica, posto fraco cai", () => {
  // Calibração de 22/09/2026: posto com 200+ avaliações em bairro de renda
  // baixa é de avenida de passagem e precisa ficar.
  const forte = decidirAncora("gas_station", 215, "baixa");
  assert.equal(forte.aprovada, true, `posto de 215 avaliações deveria ficar (nota ${forte.nota})`);
  const fraco = decidirAncora("gas_station", 16, "baixa");
  assert.equal(fraco.aprovada, false);
  assert.equal(fraco.motivo, "renda_baixa", "reprovado em renda baixa tem motivo próprio");
  // O mesmo posto fraco passaria em região de renda média.
  assert.equal(decidirAncora("gas_station", 16, "média").aprovada, true);
});

test("motivo distingue corte por renda de corte pela régua", () => {
  const regua = decidirAncora("gas_station", 2, "alta");
  assert.equal(regua.aprovada, false);
  assert.equal(regua.motivo, "regua");
  assert.equal(decidirAncora("airport", 24347, "baixa").motivo, null, "aprovada não tem motivo");
});
