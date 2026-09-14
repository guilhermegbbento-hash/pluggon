/**
 * Abre o HTML exportado num Chrome/Edge real (headless) e confere o que o
 * cliente vê: enquadramento, concorrentes visíveis, círculos de influência,
 * carimbo, lista de concorrentes e rótulos. Teste estrutural verde não garante
 * que o mapa renderiza.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findChrome(): string | null {
  return CANDIDATES.find((p): p is string => Boolean(p) && existsSync(p!)) ?? null;
}

export interface RenderReport {
  metrics: Record<string, unknown>;
  violations: string[];
}

// JS puro, sem template literal: roda dentro do HTML exportado.
const INSPECT = `<script>
window.addEventListener('load', function () { setTimeout(function () {
  var out = {}; var v = [];
  try {
    var b = map.getBounds(); var sb = scope.bounds;
    out.zoom = map.getZoom();
    if (!b.contains([[sb.south, sb.west], [sb.north, sb.east]])) v.push('mapa não enquadra o círculo do estudo inteiro');
    var span = (b.getNorth() - b.getSouth()) / (sb.north - sb.south);
    out.viewToScopeLatSpan = Math.round(span * 100) / 100;
    if (span > 4) v.push('mapa abre ' + out.viewToScopeLatSpan + 'x mais aberto que o estudo');

    var mapRect = document.getElementById('map').getBoundingClientRect();
    var icons = Array.prototype.slice.call(document.querySelectorAll('.leaflet-marker-icon'));
    var red = icons.filter(function (i) { return i.querySelector('.cmp-dot'); });
    var represented = red.reduce(function (n, i) { return n + Number(i.querySelector('.cmp-dot').getAttribute('data-count') || 1); }, 0);
    out.competitors = competitors.length; out.redMarkers = red.length; out.competitorsRepresented = represented;
    if (represented !== competitors.length) v.push('pontos vermelhos representam ' + represented + ' de ' + competitors.length + ' concorrentes');
    var hidden = { outro_concorrente: 0, ancora: 0, potencial: 0, legenda: 0, outro_elemento: 0, fora_da_tela: 0 };
    red.forEach(function (i) {
      var r = i.getBoundingClientRect(); var x = r.left + r.width / 2; var y = r.top + r.height / 2;
      if (x < mapRect.left || x > mapRect.right || y < mapRect.top || y > mapRect.bottom) { hidden.fora_da_tela++; return; }
      var el = document.elementFromPoint(x, y);
      if (el && i.contains(el)) return;
      var top = el && el.closest ? el.closest('.leaflet-marker-icon') : null;
      if (top && top.querySelector('.cmp-dot')) hidden.outro_concorrente++;
      else if (top) hidden[top.innerHTML.indexOf('#C9A84C') >= 0 ? 'ancora' : 'potencial']++;
      else if (el && el.closest && el.closest('.legend')) hidden.legenda++;
      else hidden.outro_elemento++;
    });
    out.redMarkersHidden = hidden;
    Object.keys(hidden).forEach(function (k) { if (hidden[k] > 0) v.push(hidden[k] + ' ponto(s) vermelho(s) escondido(s) por ' + k); });

    var circles = []; map.eachLayer(function (l) { if (l instanceof L.Circle) circles.push(l); });
    var inner = circles.filter(function (c) { return c.options.fillColor === '#C9A84C' && c.options.fillOpacity === INNER_OPACITY; });
    out.anchors = anchors.length; out.innerCircles = inner.length;
    var d = function (p, q) { return map.distance([p.lat, p.lng], [q.lat, q.lng]); };
    var badCircle = 0; var badMetric = 0;
    anchors.forEach(function (a) {
      var ok = inner.some(function (c) { var ll = c.getLatLng(); return Math.abs(ll.lat - a.lat) < 1e-9 && Math.abs(ll.lng - a.lng) < 1e-9 && c.getRadius() === a.influenceInnerRadiusM; });
      if (!ok) badCircle++;
      var nc = complementary.filter(function (c) { return d(a, c) <= 300; }).length;
      var nk = competitors.filter(function (c) { return d(a, c) <= 1000; }).length;
      if (nc !== a.complementaryWithin300m || nk !== a.competitorsWithin1km) badMetric++;
    });
    if (badCircle > 0) v.push(badCircle + ' âncora(s) sem círculo de influência correspondente');
    if (badMetric > 0) v.push(badMetric + ' âncora(s) com complementares/concorrentes que não batem com o mapa');
    var gold = circles.filter(function (c) { return c.options.fillColor === '#C9A84C'; });
    out.largestGoldCircleM = Math.max.apply(null, gold.map(function (c) { return c.getRadius(); }).concat([0]));
    if (out.largestGoldCircleM > 500) v.push('círculo dourado maior que 500 m');

    var stamp = document.querySelector('.footer .stamp'); var sr = stamp ? stamp.getBoundingClientRect() : null;
    out.stamp = stamp ? stamp.textContent : null;
    if (!sr || sr.height === 0 || sr.bottom > window.innerHeight || stamp.textContent.indexOf('Gerador v') < 0) v.push('carimbo não visível no rodapé');

    document.getElementById('toggleCompetitors').click();
    var list = document.getElementById('competitorsList'); var lr = list.getBoundingClientRect();
    out.competitorListHeightPx = Math.round(lr.height);
    if (lr.height < 40) v.push('lista de concorrentes aberta sem altura visível');
    var unk = Array.prototype.slice.call(list.querySelectorAll('.badge.unk')).filter(function (x) { return x.textContent.trim() === 'não informado'; });
    out.naoInformadoBadges = unk.length;
    out.unknownCompetitors = competitors.filter(function (c) { return c.charger_type === 'unknown'; }).length;
    if (unk.length !== out.unknownCompetitors) v.push('"não informado" em ' + unk.length + ' de ' + out.unknownCompetitors + ' concorrentes sem potência');

    var titles = Array.prototype.slice.call(document.querySelectorAll('.block-title')).map(function (t) { return t.textContent.trim(); });
    out.blockTitles = titles;
    if (!titles.some(function (t) { return t.indexOf('No escopo') === 0; })) v.push('bloco do raio ausente');
    var hasMunicipalCards = Array.prototype.slice.call(document.querySelectorAll('.stat-card .label')).some(function (l) { return /munic/i.test(l.textContent); });
    if (hasMunicipalCards && !titles.some(function (t) { return t.indexOf('Indicadores municipais') === 0; })) v.push('indicadores municipais sem bloco rotulado');
    out.tiles = document.querySelectorAll('img.leaflet-tile').length;
  } catch (e) { v.push('erro na inspeção: ' + ((e && e.stack) || e)); }
  var pre = document.createElement('pre'); pre.id = 'render-check'; pre.style.display = 'none';
  pre.textContent = JSON.stringify({ metrics: out, violations: v }); document.body.appendChild(pre);
}, 6000); });
</script>`;

export async function renderCheck(htmlFile: string, chrome: string): Promise<RenderReport> {
  const checkFile = htmlFile.replace(/\.html$/, ".render-check.html");
  writeFileSync(checkFile, readFileSync(htmlFile, "utf8").replace("</body>", `${INSPECT}\n</body>`));
  const url = "file:///" + checkFile.replace(/\\/g, "/").replace(/^\/+/, "").replace(/ /g, "%20");
  const { stdout } = await execFileAsync(
    chrome,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,1000", "--virtual-time-budget=25000", "--dump-dom", url],
    { maxBuffer: 64 * 1024 * 1024, timeout: 180000 }
  );
  const m = stdout.match(/<pre id="render-check"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return { metrics: {}, violations: ["inspeção não rodou no navegador (Leaflet ou script não carregou)"] };
  const decoded = m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded) as RenderReport;
}
