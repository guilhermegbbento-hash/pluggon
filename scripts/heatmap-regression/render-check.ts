/**
 * Abre o HTML exportado num Chrome/Edge real (headless) e confere o que o
 * cliente vê, em CINCO cenários de rede/navegador:
 *
 * - online              — mapa completo com tiles;
 * - sem_rede            — DNS bloqueado: mapa com pontos e aviso de base;
 * - firewall_pendurado  — proxy que aceita a conexão e nunca responde;
 * - sem_leaflet         — cópia do HTML sem o Leaflet: documento legível + mensagem;
 * - sem_js              — JavaScript desligado: listas e contadores legíveis.
 *
 * Tudo em TEMPO REAL via Chrome DevTools Protocol. Nada de --virtual-time-budget:
 * tempo simulado esconderia uma página travada esperando rede.
 *
 * LIMITAÇÃO CONHECIDA: print tirado enquanto a página carrega não prova tempo.
 * Com um <script src> pendurado, o Chrome só entrega a captura depois que a
 * página destrava — um print "aos 5 s" pode mostrar o estado de 30 s. A prova
 * de tempo é a métrica de primeira pintura (first-contentful-paint).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASEMAP_WARNING_TIMEOUT_MS } from "../../src/lib/heatmap/report-html";

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

export const SCENARIOS = ["online", "sem_rede", "firewall_pendurado", "sem_leaflet", "sem_js"] as const;
export type Scenario = (typeof SCENARIOS)[number];

/**
 * Teto da primeira pintura (FCP), em ms, para o HTML aberto de file://.
 *
 * Calibração (15/09/2026, Chrome headless, Windows): pior caso Curitiba cidade
 * inteira, 716 KB com Leaflet embutido, 5 aberturas × 5 cenários = 25 medições,
 * FCP entre 144 e 404 ms. 2 s dá ~5× de folga para máquina de cliente mais
 * lenta e continua pegando o defeito real: com um <script src> pendurado a
 * primeira pintura foi a 30 072 ms. Não subir sem nova medição registrada aqui.
 */
export const FCP_LIMIT_MS = 2000;

/** Único destino de rede permitido: tiles da base cartográfica, só como imagem. */
const TILE_HOST_RE = /(^|\.)basemaps\.cartocdn\.com$/;
const LOCAL_URL_RE = /^(file|data|about|blob|chrome|chrome-extension|devtools):/;

export interface ScenarioReport {
  scenario: Scenario;
  fcpMs: number | null;
  externalRequests: number;
  /** Requisições externas disparadas antes da primeira pintura (qualquer tipo). */
  externalBeforeFcp: number;
  metrics: Record<string, unknown>;
  violations: string[];
}

export interface RenderReport {
  scenarios: ScenarioReport[];
  /** Todas as violações, prefixadas com o cenário. */
  violations: string[];
}

// ---------- CDP mínimo ----------

interface WsLike {
  addEventListener(type: "open" | "message" | "error" | "close", fn: (e: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}
const WebSocketCtor = (globalThis as unknown as { WebSocket: new (url: string) => WsLike }).WebSocket;

// As mensagens do DevTools Protocol são JSON sem tipo: `any` fica confinado a este cliente mínimo.
interface CdpEvent {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
}

class Cdp {
  private nextId = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  readonly events: CdpEvent[] = [];

  private constructor(private ws: WsLike) {
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        this.events.push({ method: msg.method, params: msg.params ?? {} });
      }
    });
  }

  /** Sempre com tempo limite: conexão pendurada já travou uma regressão inteira. */
  static connect(url: string, timeoutMs = 15000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocketCtor(url);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error(`CDP: conexão não abriu em ${timeoutMs} ms (${url})`));
      }, timeoutMs);
      ws.addEventListener("open", () => (clearTimeout(timer), resolve(new Cdp(ws))));
      ws.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`CDP: falha ao conectar em ${url}`))));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP: ${method} sem resposta em ${timeoutMs} ms (página travada?)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(100);
  }
  return pred();
}

/** Proxy "buraco negro": aceita a conexão e nunca responde (firewall corporativo pendurado). */
async function blackHoleProxy(): Promise<{ port: number; close: () => void }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((s) => {
    sockets.push(s);
    s.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

async function launchChrome(chrome: string, extraArgs: string[], profileDir: string) {
  mkdirSync(profileDir, { recursive: true });
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,1000",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      ...extraArgs,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  // Nunca segurar o encerramento do Node por causa do navegador.
  proc.unref();
  const portFile = path.join(profileDir, "DevToolsActivePort");
  let port = "";
  await waitFor(() => {
    if (!existsSync(portFile)) return false;
    port = readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim();
    return port.length > 0;
  }, 15000);
  if (!port) {
    proc.kill();
    throw new Error("Chrome não abriu a porta de depuração");
  }
  let pageWs: string | undefined;
  let browserWs: string | undefined;
  for (let i = 0; i < 50 && !pageWs; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      browserWs = ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    } catch {}
    if (!pageWs) await sleep(100);
  }
  if (!pageWs) {
    proc.kill();
    throw new Error("Chrome sem aba para inspecionar");
  }
  // Se a conexão falhar, o Chrome não pode ficar órfão segurando o processo.
  let cdp: Cdp;
  try {
    cdp = await Cdp.connect(pageWs);
  } catch (err) {
    proc.kill();
    throw err;
  }
  const shutdown = async () => {
    cdp.close();
    if (browserWs) {
      try {
        const b = await Cdp.connect(browserWs);
        await b.send("Browser.close", {}, 3000).catch(() => {});
        b.close();
      } catch {}
    }
    await sleep(300);
    proc.kill();
  };
  return { cdp, shutdown };
}

// ---------- Inspeção dentro da página ----------

// JS puro (ES5), roda no HTML exportado via Runtime.evaluate.
const PROBE = (scenario: Scenario) => `(function (SCENARIO) {
  var out = {}; var v = [];
  try {
    var fcp = performance.getEntriesByName('first-contentful-paint')[0];
    out.fcpMs = fcp ? Math.round(fcp.startTime) : null;
    out.timeOrigin = performance.timeOrigin;
    var $ = function (s) { return document.querySelector(s); };
    var visible = function (el) {
      if (!el || el.hidden) return false;
      var r = el.getBoundingClientRect(); var cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    var num = function (sel) { var el = $(sel); return el ? Number(el.textContent) : NaN; };

    // --- Documento: vale em TODO cenário, com ou sem mapa, com ou sem JS ---
    var counters = { anchors: num('#cntAnchors'), competitors: num('#cntCompetitors'), complementary: num('#cntComplementary'), unknown: num('#cntUnknown') };
    var items = {
      anchors: document.querySelectorAll('#anchorsList [data-layer="anchor"]').length,
      competitors: document.querySelectorAll('#competitorsList [data-layer="competitor"]').length,
      complementary: document.querySelectorAll('#complementaryList [data-layer="complementary"]').length
    };
    out.counters = counters; out.listItems = items;
    ['anchors', 'competitors', 'complementary'].forEach(function (k) {
      if (items[k] !== counters[k]) v.push('lista ' + k + ' com ' + items[k] + ' itens para contador ' + counters[k]);
    });
    var stamp = $('.footer .stamp'); var sr = stamp ? stamp.getBoundingClientRect() : null;
    if (!sr || sr.height === 0 || sr.bottom > window.innerHeight || stamp.textContent.indexOf('Gerador v') < 0) v.push('carimbo não visível no rodapé');

    $('#toggleCompetitors').click();
    var list = $('#competitorsList'); var lr = list.getBoundingClientRect();
    out.competitorListHeightPx = Math.round(lr.height);
    if (!$('#competitorsSection').open || lr.height < 40) v.push('lista de concorrentes não abre com altura visível');
    var unk = list.querySelectorAll('.badge.unk').length;
    out.naoInformadoBadges = unk;
    if (unk !== counters.unknown) v.push('"não informado" em ' + unk + ' de ' + counters.unknown + ' concorrentes sem potência');

    var titles = Array.prototype.slice.call(document.querySelectorAll('.block-title')).map(function (t) { return t.textContent.trim(); });
    if (!titles.some(function (t) { return t.indexOf('No escopo') === 0; })) v.push('bloco do raio ausente');
    var hasMunicipalCards = Array.prototype.slice.call(document.querySelectorAll('.stat-card .label')).some(function (l) { return /munic/i.test(l.textContent); });
    if (hasMunicipalCards && !titles.some(function (t) { return t.indexOf('Indicadores municipais') === 0; })) v.push('indicadores municipais sem bloco rotulado');

    // --- Camada do mapa ---
    var fallback = $('#mapFallback'); var legend = $('#legend'); var warn = $('#basemapWarning');
    out.fallbackVisible = visible(fallback); out.legendVisible = visible(legend); out.basemapWarningVisible = visible(warn);
    var mapExpected = SCENARIO === 'online' || SCENARIO === 'sem_rede' || SCENARIO === 'firewall_pendurado';

    if (!mapExpected) {
      if (!out.fallbackVisible) v.push('sem mapa, e a mensagem de mapa indisponível não aparece');
      if (out.legendVisible) v.push('legenda visível descrevendo um mapa que não existe');
      if (out.basemapWarningVisible) v.push('aviso de base cartográfica visível sem mapa');
    } else {
      if (typeof map === 'undefined' || !map) { v.push('mapa não inicializou'); throw 'fim'; }
      if (out.fallbackVisible) v.push('mensagem de mapa indisponível cobrindo um mapa que funciona');
      if (!out.legendVisible) v.push('legenda escondida com o mapa funcionando');
      out.tilesLoaded = document.querySelectorAll('img.leaflet-tile-loaded').length;
      if (SCENARIO === 'online') {
        if (out.tilesLoaded === 0) v.push('online sem nenhum tile carregado');
        if (out.basemapWarningVisible) v.push('aviso de base cartográfica visível com tiles carregados');
      } else {
        if (!out.basemapWarningVisible) v.push('base cartográfica não carregou e o aviso não está visível');
        else {
          var wr = warn.getBoundingClientRect(); var cr = $('.map-container').getBoundingClientRect();
          out.basemapWarningPx = { width: Math.round(wr.width), height: Math.round(wr.height), fontSize: getComputedStyle(warn).fontSize };
          if (wr.top < cr.top || wr.bottom > cr.bottom || wr.left < cr.left - 1 || wr.right > cr.right + 1) v.push('aviso de base fora do painel do mapa');
          if (wr.height < 30) v.push('aviso de base discreto demais (' + Math.round(wr.height) + ' px de altura)');
          if (warn.textContent.indexOf('continuam válidos') < 0) v.push('aviso de base não diz que pontos, raios e contagens continuam válidos');
        }
      }

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
      var hidden = { outro_concorrente: 0, ancora: 0, potencial: 0, legenda: 0, aviso: 0, outro_elemento: 0, fora_da_tela: 0 };
      red.forEach(function (i) {
        var r = i.getBoundingClientRect(); var x = r.left + r.width / 2; var y = r.top + r.height / 2;
        if (x < mapRect.left || x > mapRect.right || y < mapRect.top || y > mapRect.bottom) { hidden.fora_da_tela++; return; }
        var el = document.elementFromPoint(x, y);
        if (el && i.contains(el)) return;
        var top = el && el.closest ? el.closest('.leaflet-marker-icon') : null;
        if (top && top.querySelector('.cmp-dot')) hidden.outro_concorrente++;
        else if (top) hidden[top.innerHTML.indexOf('#C9A84C') >= 0 ? 'ancora' : 'potencial']++;
        else if (el && el.closest && el.closest('.legend')) hidden.legenda++;
        else if (el && el.closest && el.closest('.basemap-warning')) hidden.aviso++;
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
    }
  } catch (e) { if (e !== 'fim') v.push('erro na inspeção: ' + ((e && e.stack) || e)); }
  return JSON.stringify({ metrics: out, violations: v });
})(${JSON.stringify(scenario)})`;

// ---------- Execução ----------

const LEAFLET_SCRIPT_RE = /<script>\/\*! Leaflet[\s\S]*?<\/script>/;

async function runScenario(htmlFile: string, chrome: string, scenario: Scenario, outDir: string, id: string): Promise<ScenarioReport> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pluggon-render-"));
  const report: ScenarioReport = { scenario, fcpMs: null, externalRequests: 0, externalBeforeFcp: 0, metrics: {}, violations: [] };
  let file = htmlFile;
  if (scenario === "sem_leaflet") {
    const html = readFileSync(htmlFile, "utf8");
    const stripped = html.replace(LEAFLET_SCRIPT_RE, "");
    if (stripped === html) {
      report.violations.push("Leaflet embutido não encontrado no HTML (voltou a depender de CDN?)");
      return report;
    }
    file = path.join(tmp, path.basename(htmlFile));
    writeFileSync(file, stripped);
  }

  const hole = scenario === "firewall_pendurado" ? await blackHoleProxy() : null;
  const args =
    scenario === "sem_rede"
      ? ["--host-resolver-rules=MAP * ~NOTFOUND"]
      : hole
        ? [`--proxy-server=http://127.0.0.1:${hole.port}`, "--proxy-bypass-list=<-loopback>"]
        : [];
  const { cdp, shutdown } = await launchChrome(chrome, args, path.join(tmp, "profile"));
  try {
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    if (scenario === "sem_js") await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });

    const t0 = Date.now();
    await cdp.send("Page.navigate", { url: pathToFileURL(file).href });
    const dcl = await waitFor(() => cdp.events.some((e) => e.method === "Page.domContentEventFired"), 40000);
    report.metrics.domContentLoadedMs = dcl ? Date.now() - t0 : null;
    if (!dcl) report.violations.push("DOMContentLoaded não disparou em 40 s (página travada esperando rede)");

    // Tempo para os estados assentarem: tiles no online; prazo do aviso nos cenários sem base.
    if (scenario === "online") {
      await waitFor(() => cdp.events.some((e) => e.method === "Network.loadingFinished"), 15000);
      await sleep(3000);
    } else if (scenario === "sem_rede" || scenario === "firewall_pendurado") {
      await sleep(Math.max(0, t0 + BASEMAP_WARNING_TIMEOUT_MS + 2500 - Date.now()));
    } else {
      await sleep(1500);
    }
    if (scenario === "sem_js") await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });

    const evaluated = await cdp.send("Runtime.evaluate", { expression: PROBE(scenario), returnByValue: true }, 20000);
    const probe = JSON.parse(evaluated?.result?.value ?? '{"metrics":{},"violations":["inspeção sem retorno"]}');
    const timeOrigin = probe.metrics.timeOrigin as number | undefined;
    delete probe.metrics.timeOrigin;
    report.metrics = { ...report.metrics, ...probe.metrics };
    report.violations.push(...probe.violations);
    report.fcpMs = (probe.metrics.fcpMs as number | null) ?? null;

    if (report.fcpMs === null) report.violations.push("sem primeira pintura registrada");
    else if (report.fcpMs > FCP_LIMIT_MS) report.violations.push(`primeira pintura em ${report.fcpMs} ms (limite ${FCP_LIMIT_MS} ms)`);

    // Rede: só tiles, só como imagem. Nunca a URL inteira no relatório (tem chave).
    const requests = cdp.events
      .filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => ({ url: String(e.params.request?.url ?? ""), type: String(e.params.type ?? "Other"), wallMs: Number(e.params.wallTime) * 1000 }))
      .filter((r) => !LOCAL_URL_RE.test(r.url));
    report.externalRequests = requests.length;
    const forbidden = new Map<string, number>();
    for (const r of requests) {
      let host = "?";
      try {
        host = new URL(r.url).hostname;
      } catch {}
      if (!TILE_HOST_RE.test(host) || r.type !== "Image") {
        const k = `${r.type} ${host}`;
        forbidden.set(k, (forbidden.get(k) ?? 0) + 1);
      }
      if (timeOrigin !== undefined && report.fcpMs !== null && r.wallMs - timeOrigin < report.fcpMs) report.externalBeforeFcp++;
    }
    for (const [k, n] of forbidden) report.violations.push(`requisição externa não permitida: ${k} (${n}x)`);
    report.metrics.externalTypes = [...new Set(requests.map((r) => r.type))];

    const exceptions = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown");
    if (exceptions.length > 0) {
      report.violations.push(
        `${exceptions.length} erro(s) de JavaScript não tratado(s): ` +
          exceptions.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text ?? "?").split("\n")[0]).join(" | ")
      );
    }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, 20000).catch(() => null);
    if (shot?.data) writeFileSync(path.join(outDir, `${id}.${scenario}.png`), Buffer.from(shot.data, "base64"));
  } catch (err) {
    report.violations.push(`falha ao inspecionar: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await shutdown();
    hole?.close();
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  return report;
}

export async function renderCheck(
  htmlFile: string,
  chrome: string,
  opts: { outDir: string; id: string; scenarios?: readonly Scenario[] }
): Promise<RenderReport> {
  mkdirSync(opts.outDir, { recursive: true });
  const scenarios: ScenarioReport[] = [];
  for (const s of opts.scenarios ?? SCENARIOS) {
    // Um cenário que quebra vira violação registrada, nunca erro que derruba a
    // rodada inteira e leva a mensagem embora.
    try {
      scenarios.push(await runScenario(htmlFile, chrome, s, opts.outDir, opts.id));
    } catch (err) {
      const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error(`[render-check][${opts.id}][${s}] ${detail}`);
      scenarios.push({
        scenario: s,
        fcpMs: null,
        externalRequests: 0,
        externalBeforeFcp: 0,
        metrics: { erro: detail },
        violations: [`cenário não pôde ser verificado: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }
  return { scenarios, violations: scenarios.flatMap((s) => s.violations.map((v) => `[${s.scenario}] ${v}`)) };
}
