import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeafletAssets } from "../../../../scripts/vendor-leaflet";
import { ExportBasemapKeyError } from "../../basemap";
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_SOURCE_SHA256, LEAFLET_VERSION } from "../leaflet-vendor";
import { runPipeline } from "../pipeline";
import { appScriptOf, BASEMAP_WARNING_TEXT, MAP_FALLBACK_TEXT, renderHeatmapHtml } from "../report-html";
import type { HeatmapPayload } from "../types";
import { cand, CENTER, makeScope, offset, place } from "./helpers";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=teste";

function payload(): HeatmapPayload {
  const scope = makeScope({ radiusM: 1500 });
  const out = runPipeline(scope, [
    cand("anchor", "gas_station", place("a1", "Posto <Um>", offset(CENTER, 100, 0), { types: ["gas_station"] })),
    cand("anchor", "shopping_mall", place("a2", "Shopping Dois", offset(CENTER, -500, 0), { types: ["shopping_mall"] })),
    cand("complementary", "pharmacy", place("c1", "Farmácia Três", offset(CENTER, 150, 0), { types: ["pharmacy"] })),
    cand("competitor", "electric_vehicle_charging_station", place("k1", "Eletroposto Quatro", offset(CENTER, 0, 300), { types: ["electric_vehicle_charging_station"], chargerMaxKw: 60, chargerKwSource: "google_ev_options" })),
    cand("competitor", "electric_vehicle_charging_station", place("k2", "Eletroposto Cinco", offset(CENTER, 400, 300), { types: ["electric_vehicle_charging_station"] })),
  ]);
  return {
    generatorVersion: "9.9.9",
    generatedAt: "2026-09-15T12:00:00.000Z",
    scope,
    ...out,
    searches: [],
    sources: [],
    municipal: null,
    qa: null,
    googleQueries: 0,
  };
}

/** Tira o Leaflet embutido (JS e CSS): os comentários dele citam URLs que não são requisições. */
const withoutLeaflet = (html: string) =>
  html.replace(/<script>\/\*! Leaflet[\s\S]*?<\/script>/, "").replace(`<style>${LEAFLET_CSS}</style>`, "");
const styleBlocks = (html: string) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

test("HTML exportado é autocontido: nenhum script, CSS, fonte ou imagem externa", () => {
  const html = renderHeatmapHtml(payload(), { tileUrl: TILE_URL });
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/i, "nenhum <script src>");
  assert.doesNotMatch(html, /<link\b/i, "nenhum <link> (CSS/fonte externa)");
  assert.doesNotMatch(html, /<img\b/i, "nenhuma imagem no documento");
  assert.doesNotMatch(styleBlocks(html), /@import|url\(/i, "nenhum @import ou url() no CSS");

  // Fora do Leaflet embutido, os únicos endereços externos são o molde dos tiles e os links da atribuição.
  const hosts = new Set(
    [...withoutLeaflet(html).matchAll(/https?:\/\/([^/\s"'<>)\\]+)/g)].map((m) => m[1])
  );
  assert.deepEqual([...hosts].sort(), ["carto.com", "www.openstreetmap.org", "{s}.basemaps.cartocdn.com"].sort());
});

test("Leaflet embutido fica DEPOIS do documento e não quebra a tag <script>", () => {
  const html = renderHeatmapHtml(payload(), { tileUrl: TILE_URL });
  const leaflet = html.indexOf("<script>/*! Leaflet");
  assert.ok(leaflet > 0, "Leaflet embutido presente");
  assert.ok(leaflet > html.indexOf('class="footer"'), "scripts depois do rodapé: nada bloqueia a primeira pintura do documento");
  assert.ok(html.indexOf("</head>") < html.indexOf('<div class="header">'));
  assert.doesNotMatch(LEAFLET_JS, /<\/script|<!--|<script/i);
  assert.doesNotMatch(LEAFLET_CSS, /<\/style|url\(/i);
  assert.match(appScriptOf(html), /L\.tileLayer\(/);
});

test("listas e contadores saem prontos no HTML — legíveis sem JavaScript e sem mapa", () => {
  const p = payload();
  const html = renderHeatmapHtml(p, { tileUrl: TILE_URL });
  const doc = html.slice(0, html.indexOf("<script>"));
  const count = (layer: string) => (doc.match(new RegExp(`data-layer="${layer}"`, "g")) ?? []).length;
  assert.equal(count("anchor"), p.anchors.length);
  assert.equal(count("competitor"), p.competitors.length);
  assert.equal(count("complementary"), p.complementary.length);
  assert.ok(p.competitors.length === 2 && p.anchors.length === 2);
  assert.match(doc, new RegExp(`id="cntCompetitors">${p.counters.competitors}<`));
  assert.match(doc, new RegExp(`id="cntUnknown">${p.counters.competitorsUnknown}<`));
  assert.match(doc, /Posto &lt;Um&gt;/, "nome escapado");
  assert.doesNotMatch(doc, /Posto <Um>/);
  // Recolher/abrir nativo, sem JS.
  assert.match(doc, /<details id="competitorsSection">\s*<summary[^>]*id="toggleCompetitors"/);
  assert.match(doc, /<details id="complementarySection">\s*<summary[^>]*id="toggleComplementary"/);
  assert.match(doc, /n&atilde;o informado/);
});

test("mapa é camada: sem JS a mensagem aparece, a legenda não; aviso de base pronto e claro", () => {
  const html = renderHeatmapHtml(payload(), { tileUrl: TILE_URL });
  assert.match(html, /<div class="map-fallback" id="mapFallback">/, "mensagem visível por padrão");
  assert.doesNotMatch(html, /id="mapFallback"[^>]*hidden/);
  assert.match(html, /<div class="legend" id="legend" hidden>/, "legenda só aparece quando o mapa existe");
  assert.match(html, /id="basemapWarning" role="status" hidden>/);
  assert.match(BASEMAP_WARNING_TEXT, /Pontos, raios e contagens continuam válidos/);
  assert.match(MAP_FALLBACK_TEXT, /contagens e listas ao lado continuam válidas/);
  assert.ok(html.includes(BASEMAP_WARNING_TEXT) && html.includes(MAP_FALLBACK_TEXT));
  // Mapa inteiro protegido: erro no Leaflet não derruba o documento.
  assert.match(appScriptOf(html), /try \{\s*if \(typeof L === 'undefined'\)/);
});

test("módulo do Leaflet embutido é idêntico ao gerado a partir do pacote instalado", () => {
  const a = buildLeafletAssets(process.cwd());
  assert.equal(LEAFLET_VERSION, a.version);
  assert.equal(LEAFLET_SOURCE_SHA256, a.sourceSha256, "rode npm run vendor:leaflet");
  assert.equal(LEAFLET_JS, a.js);
  assert.equal(LEAFLET_CSS, a.css);
  assert.match(LEAFLET_JS, /^\/\*! Leaflet [\d.]+ — embutido pelo PLUGGON\. Licença:\n[\s\S]*BSD|Copyright/);
});

test(
  "sem nenhuma chave do CARTO, o HTML não é gerado (nunca sai sem base cartográfica)",
  {
    skip:
      Boolean(process.env.NEXT_PUBLIC_CARTO_EXPORT_API_KEY || process.env.NEXT_PUBLIC_CARTO_API_KEY) &&
      "há chave do CARTO no ambiente",
  },
  () => {
    assert.throws(() => renderHeatmapHtml(payload()), ExportBasemapKeyError);
  }
);
