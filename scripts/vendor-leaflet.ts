/**
 * Gera src/lib/heatmap/leaflet-vendor.ts com o Leaflet (JS + CSS) em texto,
 * para o HTML exportado não depender de CDN. Rode depois de atualizar o pacote:
 *   npm run vendor:leaflet
 *
 * Transformações (e só estas):
 * - CSS: remove declarações com url(...) — imagens do marcador padrão e da
 *   camada de controle, que o relatório não usa. Nenhum recurso externo sobra.
 * - JS: remove o comentário sourceMappingURL.
 * - Prefixa a licença BSD-2-Clause do Leaflet.
 * Aborta se o texto tiver algo que feche a tag <script>/<style> antes da hora.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface LeafletAssets {
  version: string;
  sourceSha256: string;
  js: string;
  css: string;
}

export function buildLeafletAssets(repoRoot: string): LeafletAssets {
  const dir = path.join(repoRoot, "node_modules/leaflet");
  const version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version as string;
  const rawJs = readFileSync(path.join(dir, "dist/leaflet.js"), "utf8");
  const rawCss = readFileSync(path.join(dir, "dist/leaflet.css"), "utf8");
  const license = readFileSync(path.join(dir, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim();

  const js =
    `/*! Leaflet ${version} — embutido pelo PLUGGON. Licença:\n${license.replace(/\*\//g, "* /")}\n*/\n` +
    rawJs.replace(/\r\n/g, "\n").replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
  const css = rawCss.replace(/\r\n/g, "\n").replace(/[^;{}]*url\([^)]*\)[^;{}]*;?/g, "");

  if (/url\(/i.test(css)) throw new Error("leaflet.css ainda referencia url(...)");
  if (/<\/style/i.test(css)) throw new Error("leaflet.css contém </style");
  if (/<\/script|<!--|<script/i.test(js)) throw new Error("leaflet.js contém sequência que quebra <script> inline");

  const sourceSha256 = createHash("sha256").update(rawJs).update(rawCss).digest("hex");
  return { version, sourceSha256, js, css };
}

export function renderVendorModule(a: LeafletAssets): string {
  return (
    `/**\n * GERADO por scripts/vendor-leaflet.ts — não editar à mão.\n` +
    ` * Leaflet ${a.version} (BSD-2-Clause) embutido no HTML exportado do Mapa de Calor.\n` +
    ` * O HTML exportado é autocontido por decisão de produto (ver README).\n */\n\n` +
    `export const LEAFLET_VERSION = ${JSON.stringify(a.version)};\n` +
    `export const LEAFLET_SOURCE_SHA256 = ${JSON.stringify(a.sourceSha256)};\n` +
    `export const LEAFLET_CSS = ${JSON.stringify(a.css)};\n` +
    `export const LEAFLET_JS = ${JSON.stringify(a.js)};\n`
  );
}

if (/vendor-leaflet\.ts$/.test(process.argv[1] ?? "")) {
  const root = process.cwd();
  const assets = buildLeafletAssets(root);
  const out = path.join(root, "src/lib/heatmap/leaflet-vendor.ts");
  writeFileSync(out, renderVendorModule(assets));
  console.log(`Leaflet ${assets.version} → ${out} (JS ${assets.js.length} B, CSS ${assets.css.length} B)`);
}
