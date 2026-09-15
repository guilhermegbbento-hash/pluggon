import { test } from "node:test";
import assert from "node:assert/strict";
import { SCOPE_RULES } from "../config";
import { resolveScope, ScopeError, type GeocodeFn, type GeocodeResponse, type GeocodeResult } from "../scope";
import type { LatLng } from "../types";

// Respostas de geocoding SINTÉTICAS, no formato da API.

function result(opts: {
  name: string;
  types: string[];
  city: string;
  ufLong: string;
  uf: string;
  center: LatLng;
  bounds?: { ne: LatLng; sw: LatLng };
  partial?: boolean;
}): GeocodeResult {
  const areaComponent =
    opts.types.includes("locality") || opts.types.includes("administrative_area_level_2")
      ? []
      : [{ long_name: opts.name, short_name: opts.name, types: opts.types }];
  return {
    types: opts.types,
    ...(opts.partial ? { partial_match: true } : {}),
    address_components: [
      ...areaComponent,
      { long_name: opts.city, short_name: opts.city, types: ["administrative_area_level_2", "political"] },
      { long_name: opts.ufLong, short_name: opts.uf, types: ["administrative_area_level_1", "political"] },
      { long_name: "Brasil", short_name: "BR", types: ["country", "political"] },
    ],
    geometry: {
      location: opts.center,
      viewport: opts.bounds
        ? { northeast: opts.bounds.ne, southwest: opts.bounds.sw }
        : {
            northeast: { lat: opts.center.lat + 0.0013, lng: opts.center.lng + 0.0013 },
            southwest: { lat: opts.center.lat - 0.0013, lng: opts.center.lng - 0.0013 },
          },
      ...(opts.bounds ? { bounds: { northeast: opts.bounds.ne, southwest: opts.bounds.sw } } : {}),
    },
  };
}

const ok = (...results: GeocodeResult[]): GeocodeResponse => ({ status: "OK", results });

const CIDADE_A = result({
  name: "Cidade A",
  types: ["locality", "political"],
  city: "Cidade A",
  ufLong: "Estado A",
  uf: "AA",
  center: { lat: -23.55, lng: -46.63 },
  bounds: { ne: { lat: -23.35, lng: -46.36 }, sw: { lat: -24.0, lng: -46.82 } },
});

function geocoder(map: Record<string, GeocodeResponse>): GeocodeFn {
  return async (address) => {
    const hit = map[address];
    if (!hit) return { status: "ZERO_RESULTS", results: [] };
    return hit;
  };
}

test("bairro com bounds: raio = meia-diagonal, origem 'bounds'", async () => {
  const scope = await resolveScope(
    { city: "Cidade A", state: "AA", regions: ["Bairro Médio"] },
    geocoder({
      "Cidade A - AA, Brasil": ok(CIDADE_A),
      "Bairro Médio, Cidade A - AA, Brasil": ok(
        result({
          name: "Bairro Médio",
          types: ["political", "sublocality", "sublocality_level_1"],
          city: "Cidade A",
          ufLong: "Estado A",
          uf: "AA",
          center: { lat: -23.5978856, lng: -46.7201808 },
          bounds: { ne: { lat: -23.5868898, lng: -46.7077709 }, sw: { lat: -23.6136635, lng: -46.726084 } },
        })
      ),
    })
  );
  assert.equal(scope.mode, "bairro");
  assert.equal(scope.areas[0].radiusSource, "bounds");
  assert.ok(scope.areas[0].radiusM > 1700 && scope.areas[0].radiusM < 1800, `raio ${scope.areas[0].radiusM}`);
  assert.equal(scope.label, "Bairro Médio · Cidade A/AA");
});

test("bairro pequeno usa o piso; bairro grande usa o teto; sem bounds usa fallback", async () => {
  const mk = (name: string, halfDeg: number | null) =>
    result({
      name,
      types: ["sublocality_level_1", "sublocality", "political"],
      city: "Cidade A",
      ufLong: "Estado A",
      uf: "AA",
      center: { lat: -23.6, lng: -46.7 },
      ...(halfDeg === null
        ? {}
        : { bounds: { ne: { lat: -23.6 + halfDeg, lng: -46.7 + halfDeg }, sw: { lat: -23.6 - halfDeg, lng: -46.7 - halfDeg } } }),
    });
  const geo = geocoder({
    "Cidade A - AA, Brasil": ok(CIDADE_A),
    "Pequeno, Cidade A - AA, Brasil": ok(mk("Pequeno", 0.002)),
    "Enorme, Cidade A - AA, Brasil": ok(mk("Enorme", 0.08)),
    "Pontual, Cidade A - AA, Brasil": ok(mk("Pontual", null)),
  });
  const rule = SCOPE_RULES.bairro;
  const [p, e, f] = await Promise.all(
    ["Pequeno", "Enorme", "Pontual"].map((r) => resolveScope({ city: "Cidade A", state: "AA", regions: [r] }, geo))
  );
  assert.equal(p.areas[0].radiusM, rule.minRadiusM);
  assert.equal(p.areas[0].radiusClamp, "piso");
  assert.equal(p.areas[0].boundsCoveragePct, 100);
  assert.equal(e.areas[0].radiusM, rule.maxRadiusM);
  assert.equal(e.areas[0].radiusClamp, "teto");
  assert.ok(e.areas[0].boundsCoveragePct! < 100, "teto deixa parte do bairro de fora");
  assert.equal(f.areas[0].radiusM, rule.fallbackRadiusM);
  assert.equal(f.areas[0].radiusSource, "fallback");
  assert.equal(f.areas[0].radiusClamp, null);
  assert.equal(f.areas[0].boundsCoveragePct, null);
});

test("bairro inexistente (resultado parcial de estabelecimento) ABORTA — nunca usa o centro do município", async () => {
  await assert.rejects(
    resolveScope(
      { city: "Cidade A", state: "AA", regions: ["Bairro Que Não Existe"] },
      geocoder({
        "Cidade A - AA, Brasil": ok(CIDADE_A),
        "Bairro Que Não Existe, Cidade A - AA, Brasil": ok(
          result({
            name: "Salão Qualquer",
            types: ["establishment", "point_of_interest"],
            city: "Cidade A",
            ufLong: "Estado A",
            uf: "AA",
            center: { lat: -23.5, lng: -46.6 },
            partial: true,
          })
        ),
      })
    ),
    (err: unknown) => err instanceof ScopeError && err.code === "bairro_nao_encontrado"
  );
});

test("bairro com o nome pedido só em OUTRAS cidades aborta e cita onde foi encontrado", async () => {
  const geo = geocoder({
    "Cidade B - BB, Brasil": ok(
      result({
        name: "Cidade B",
        types: ["locality", "political"],
        city: "Cidade B",
        ufLong: "Estado B",
        uf: "BB",
        center: { lat: -25.42, lng: -49.26 },
        bounds: { ne: { lat: -25.34, lng: -49.18 }, sw: { lat: -25.64, lng: -49.38 } },
      })
    ),
    "Bairro X, Cidade B - BB, Brasil": ok(
      result({ name: "Cidade B", types: ["locality", "political"], city: "Cidade B", ufLong: "Estado B", uf: "BB", center: { lat: -25.42, lng: -49.26 }, partial: true }),
      result({ name: "Bairro X", types: ["sublocality_level_1", "sublocality", "political"], city: "Cidade C", ufLong: "Estado B", uf: "BB", center: { lat: -23.3, lng: -51.16 }, partial: true })
    ),
  });
  await assert.rejects(
    resolveScope({ city: "Cidade B", state: "BB", regions: ["Bairro X"] }, geo),
    (err: unknown) =>
      err instanceof ScopeError &&
      err.code === "bairro_nao_encontrado" &&
      err.details.some((d) => d.includes("Cidade C/BB"))
  );
});

test("bairro homônimo em município errado (sem partial_match) é rejeitado pela conferência de município", async () => {
  const geo = geocoder({
    "Cidade A - AA, Brasil": ok(CIDADE_A),
    "Centro, Cidade A - AA, Brasil": ok(
      result({ name: "Centro", types: ["sublocality_level_1", "sublocality", "political"], city: "Outra Cidade", ufLong: "Estado A", uf: "AA", center: { lat: -22.9, lng: -47.06 } })
    ),
  });
  await assert.rejects(
    resolveScope({ city: "Cidade A", state: "AA", regions: ["Centro"] }, geo),
    (err: unknown) => err instanceof ScopeError && err.details.some((d) => d.includes("fica em Outra Cidade/AA"))
  );
});

test("mesmo nome de bairro em duas cidades resolve cada um no seu município", async () => {
  const centroA = result({ name: "Centro", types: ["sublocality_level_1", "sublocality", "political"], city: "Cidade A", ufLong: "Estado A", uf: "AA", center: { lat: -23.54, lng: -46.63 }, bounds: { ne: { lat: -23.53, lng: -46.62 }, sw: { lat: -23.55, lng: -46.64 } } });
  const cidadeD = result({ name: "Cidade D", types: ["locality", "political"], city: "Cidade D", ufLong: "Estado D", uf: "DD", center: { lat: -27.59, lng: -48.55 }, bounds: { ne: { lat: -27.38, lng: -48.35 }, sw: { lat: -27.85, lng: -48.61 } } });
  const centroD = result({ name: "Centro", types: ["sublocality_level_1", "sublocality", "political"], city: "Cidade D", ufLong: "Estado D", uf: "DD", center: { lat: -27.5922687, lng: -48.5490266 } });
  const geo = geocoder({
    "Cidade A - AA, Brasil": ok(CIDADE_A),
    "Centro, Cidade A - AA, Brasil": ok(centroA),
    "Cidade D - DD, Brasil": ok(cidadeD),
    "Centro, Cidade D - DD, Brasil": ok(centroD),
  });
  const a = await resolveScope({ city: "Cidade A", state: "AA", regions: ["Centro"] }, geo);
  const d = await resolveScope({ city: "Cidade D", state: "DD", regions: ["Centro"] }, geo);
  assert.deepEqual(a.areas[0].center, { lat: -23.54, lng: -46.63 });
  assert.deepEqual(d.areas[0].center, { lat: -27.5922687, lng: -48.5490266 });
  assert.notEqual(a.key, d.key);
});

test("área coloquial sem limites é rejeitada", async () => {
  const geo = geocoder({
    "Cidade A - AA, Brasil": ok(CIDADE_A),
    "Zona Qualquer, Cidade A - AA, Brasil": ok(
      result({ name: "Zona Qualquer", types: ["colloquial_area", "political"], city: "Cidade A", ufLong: "Estado A", uf: "AA", center: { lat: -23.65, lng: -46.66 } })
    ),
  });
  await assert.rejects(
    resolveScope({ city: "Cidade A", state: "AA", regions: ["Zona Qualquer"] }, geo),
    (err: unknown) => err instanceof ScopeError && err.code === "bairro_nao_encontrado"
  );
});

test("município inexistente aborta", async () => {
  await assert.rejects(
    resolveScope({ city: "Cidade Fantasma", state: "AA", regions: [] }, geocoder({})),
    (err: unknown) => err instanceof ScopeError && err.code === "municipio_nao_encontrado"
  );
});

test("modo cidade: raio dos bounds do município com teto do modo cidade", async () => {
  const scope = await resolveScope({ city: "Cidade A", state: "AA", regions: [] }, geocoder({ "Cidade A - AA, Brasil": ok(CIDADE_A) }));
  assert.equal(scope.mode, "cidade");
  assert.equal(scope.areas[0].radiusM, SCOPE_RULES.cidade.maxRadiusM);
  assert.equal(scope.label, "Cidade A/AA");
});

test("modo região: um bairro inválido derruba a análise inteira", async () => {
  const bom = result({ name: "Bom", types: ["sublocality_level_1"], city: "Cidade A", ufLong: "Estado A", uf: "AA", center: { lat: -23.6, lng: -46.7 } });
  const geo = geocoder({ "Cidade A - AA, Brasil": ok(CIDADE_A), "Bom, Cidade A - AA, Brasil": ok(bom) });
  await assert.rejects(resolveScope({ city: "Cidade A", state: "AA", regions: ["Bom", "Ruim"] }, geo), ScopeError);
});
