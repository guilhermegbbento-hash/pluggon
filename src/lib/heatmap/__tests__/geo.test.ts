import { test } from "node:test";
import assert from "node:assert/strict";
import { DEDUPE_RULES } from "../config";
import { circleBounds, haversineM, nameCore, nameSimilarity } from "../geo";
import { CENTER, offset } from "./helpers";

const T = DEDUPE_RULES.nameSimilarityThreshold;

test("calibração: dois shoppings distintos a ~93 m NÃO são duplicata", () => {
  const sim = nameSimilarity("Morumbi Open Center", "Shopping Portal do Morumbi");
  assert.ok(sim < T, `similaridade ${sim.toFixed(2)} deveria ficar abaixo de ${T}`);
});

test("calibração: os três registros do mesmo terminal são duplicata entre si", () => {
  const names = ["Terminal Rodoviário Tietê", "Rodoviaria Tiete", "Rodoviário Tietê", "Rodoviária do Tietê"];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const sim = nameSimilarity(names[i], names[j]);
      assert.ok(sim >= T, `"${names[i]}" x "${names[j]}" = ${sim.toFixed(2)}, esperado >= ${T}`);
    }
  }
});

test("calibração: shopping x loja dentro do shopping não é duplicata", () => {
  assert.ok(nameSimilarity("Morumbi Shopping", "Cabana Burger (Morumbi Shopping)") < T);
  assert.ok(nameSimilarity("Morumbi Shopping", "Morumbi Town Shopping") < T);
});

test("nameCore remove acento, preposição e categoria, mas não esvazia o nome", () => {
  assert.equal(nameCore("Rodoviária do Tietê"), "tiete");
  assert.equal(nameCore("Terminal Rodoviário"), "terminal rodoviario");
});

test("circleBounds contém o círculo inteiro", () => {
  const r = 1760;
  const b = circleBounds(CENTER, r);
  for (const [n, e] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const p = offset(CENTER, n, e);
    assert.ok(p.lat <= b.north + 1e-9 && p.lat >= b.south - 1e-9);
    assert.ok(p.lng <= b.east + 1e-9 && p.lng >= b.west - 1e-9);
  }
  assert.ok(Math.abs(haversineM(CENTER, offset(CENTER, 1000, 0)) - 1000) < 1);
});
