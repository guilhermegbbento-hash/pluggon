"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import CityStateSelect from "@/components/CityStateSelect";
import CityEVDataForm, {
  EMPTY_MANUAL_DATA,
  type CityEVManualData,
} from "@/components/CityEVDataForm";
import { specByKey, specsForLayer } from "@/lib/heatmap/config";
import { DISCARD_REASON_LABELS, QaGateError } from "@/lib/heatmap/qa-gate";
import {
  fmtKm,
  heatmapFileName,
  radiusCapWarnings,
  renderHeatmapHtml,
  reportStamp,
} from "@/lib/heatmap/report-html";
import type { AnchorOut, CompetitorOut, ComplementaryOut, DiscardReason, HeatmapPayload } from "@/lib/heatmap/types";

const ADMIN_EMAILS = ['guilhermegbbento@gmail.com', 'marco@bleveducacao.com.br'];

const HeatmapMapV2 = dynamic(() => import("./HeatmapMapV2"), { ssr: false });

const LOADING_STEPS = [
  "Resolvendo bairro, cidade e UF no geocoding...",
  "Buscando estabelecimentos dentro do raio de estudo...",
  "Validando tipos e deduplicando...",
  "Buscando concorrentes no mesmo raio...",
  "Rodando QA gate...",
];

const ANCHOR_EMOJI: Record<string, string> = Object.fromEntries(
  specsForLayer("anchor").map((s) => [s.key, s.emoji])
);

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR");
}
function formatCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function ChargerBadge({ c }: { c: CompetitorOut }) {
  const kw = c.chargerMaxKw ? ` ${c.chargerMaxKw} kW` : "";
  if (c.charger_type === "DC") {
    return <span className="rounded bg-[#FF980030] px-1.5 py-0.5 text-[9px] font-bold text-[#FF9800]">DC{kw}</span>;
  }
  if (c.charger_type === "AC") {
    return <span className="rounded bg-[#42A5F530] px-1.5 py-0.5 text-[9px] font-bold text-[#42A5F5]">AC{kw}</span>;
  }
  return <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[9px] font-bold text-[#8B949E]">não informado</span>;
}

type HeatmapResult = HeatmapPayload & { fromCache?: boolean };

export default function HeatmapPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [regions, setRegions] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [result, setResult] = useState<HeatmapResult | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showComplementary, setShowComplementary] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [manualData, setManualData] = useState<CityEVManualData>(EMPTY_MANUAL_DATA);

  const parsedRegions = useMemo(
    () => regions.split(",").map((r) => r.trim()).filter(Boolean),
    [regions]
  );
  const tooManyRegions = parsedRegions.length > 3;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user?.email && ADMIN_EMAILS.includes(user.email)) setIsAdmin(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((s) => (s < LOADING_STEPS.length - 1 ? s + 1 : s));
    }, 4000);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!city.trim() || !state.trim()) return;
      if (tooManyRegions) {
        setError({ message: "Máximo 3 regiões por análise", details: [] });
        return;
      }
      setError(null);
      setResult(null);
      setLoading(true);
      setLoadingStep(0);

      try {
        const res = await fetch("/api/heatmap-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: city.trim(),
            state: state.trim(),
            regions: parsedRegions.length > 0 ? parsedRegions.join(", ") : null,
            manualData: {
              bev: manualData.bev,
              phev: manualData.phev,
              chargersAC: manualData.chargersAC,
              chargersDC: manualData.chargersDC,
            },
            ...(forceRefresh ? { forceRefresh: true } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError({ message: data.error || "Erro ao gerar mapa", details: data.details ?? [] });
          return;
        }
        setResult(data);
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : "Erro desconhecido", details: [] });
      } finally {
        setLoading(false);
      }
    },
    [city, state, forceRefresh, manualData, parsedRegions, tooManyRegions]
  );

  const handleReset = () => {
    setResult(null);
    setError(null);
    setCity("");
    setState("");
    setRegions("");
    setForceRefresh(false);
    setManualData(EMPTY_MANUAL_DATA);
  };

  const exportHTML = useCallback(() => {
    if (!result) return;
    let html: string;
    try {
      // O QA gate roda dentro de renderHeatmapHtml: payload reprovado não vira arquivo.
      html = renderHeatmapHtml(result);
    } catch (err) {
      if (err instanceof QaGateError) {
        alert(`Exportação bloqueada pelo QA gate:\n\n${err.message}`);
        return;
      }
      throw err;
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = heatmapFileName(result.scope);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const anchorsByType = useMemo(() => {
    if (!result) return [] as { type: string; label: string; items: AnchorOut[] }[];
    const groups = new Map<string, AnchorOut[]>();
    for (const a of result.anchors) {
      if (!groups.has(a.type)) groups.set(a.type, []);
      groups.get(a.type)!.push(a);
    }
    return specsForLayer("anchor")
      .filter((s) => groups.has(s.key))
      .map((s) => ({ type: s.key, label: s.label, items: groups.get(s.key)! }));
  }, [result]);

  const complementaryByAnchor = useMemo(() => {
    if (!result) return [] as { anchorName: string; items: ComplementaryOut[] }[];
    const groups = new Map<string, ComplementaryOut[]>();
    for (const cp of result.complementary) {
      if (!groups.has(cp.nearAnchor)) groups.set(cp.nearAnchor, []);
      groups.get(cp.nearAnchor)!.push(cp);
    }
    return Array.from(groups.entries())
      .map(([anchorName, items]) => ({ anchorName, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [result]);

  // ========== Formulário ==========
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Mapa de calor mostrando pontos âncora e concentração de estabelecimentos. Sem IA — cálculo determinístico.
        </p>

        <div className="mt-8 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-xl border border-[#30363D] bg-[#161B22] p-8"
          >
            <h2 className="mb-6 text-lg font-semibold text-white">Gerar Mapa</h2>

            <div className="space-y-4">
              <CityStateSelect
                initialCity={city}
                initialState={state}
                onSelect={(c, s) => {
                  setCity(c);
                  setState(s);
                }}
              />

              <div>
                <label htmlFor="regions" className="mb-1 block text-xs font-medium text-[#C9D1D9]">
                  Região ou Bairro <span className="text-[#8B949E]">(opcional)</span>
                </label>
                <input
                  id="regions"
                  type="text"
                  value={regions}
                  onChange={(e) => setRegions(e.target.value)}
                  placeholder="Ex: Batel, Centro, Santa Felicidade"
                  disabled={loading}
                  className={`w-full rounded-md border bg-[#0D1117] px-3 py-2 text-sm text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C] disabled:opacity-60 ${
                    tooManyRegions ? "border-red-500" : "border-[#30363D]"
                  }`}
                />
                <p className="mt-1 text-[11px] text-[#8B949E]">
                  Se preenchido, o estudo fica restrito ao raio do bairro (derivado dos limites do bairro no
                  geocoding). Se o bairro não for encontrado nesta cidade, a análise é interrompida. Se vazio,
                  estuda a cidade inteira. Separe múltiplas regiões por vírgula (máx. 3).
                </p>
                {tooManyRegions && (
                  <p className="mt-1 text-[11px] text-red-400">Máximo 3 regiões por análise.</p>
                )}
              </div>

              <CityEVDataForm
                city={city}
                state={state}
                value={manualData}
                onChange={setManualData}
                disabled={loading}
              />
            </div>

            {isAdmin && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-[#30363D] bg-[#0D1117] px-3 py-2 text-xs text-[#C9A84C]">
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-[#C9A84C]"
                />
                <span className="font-medium">[ADMIN]</span>
                <span className="text-[#8B949E]">Forçar nova análise (ignorar cache)</span>
              </label>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <p>{error.message}</p>
                {error.details.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-red-200/80">
                    {error.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={tooManyRegions}
              className="mt-6 w-full rounded-lg bg-[#C9A84C] px-4 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Gerar Mapa
            </button>

            <p className="mt-3 text-center text-xs text-[#484F58]">
              Google Places restrito ao raio · Cache 7 dias por versão do gerador
            </p>
          </form>
        </div>
      </div>
    );
  }

  // ========== Carregando ==========
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Gerando mapa de {parsedRegions.length > 0 ? `${parsedRegions.join(", ")} · ` : ""}
          {city}/{state}...
        </p>

        <div className="mt-16 flex flex-col items-center gap-8">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 rounded-full border-4 border-[#30363D]" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#C9A84C]" />
          </div>
          <div className="space-y-2 text-center">
            {LOADING_STEPS.map((step, i) => (
              <p
                key={i}
                className={`text-sm transition-colors ${
                  i < loadingStep
                    ? "text-[#66BB6A]"
                    : i === loadingStep
                      ? "text-[#C9A84C] font-medium"
                      : "text-[#484F58]"
                }`}
              >
                {i < loadingStep ? "✓ " : i === loadingStep ? "→ " : "  "}
                {step}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;

  // ========== Resultado ==========
  const { scope, counters, municipal } = result;
  const radiusText = scope.areas.map((a) => fmtKm(a.radiusM)).join(" / ");
  const googleCost = result.googleQueries * 0.032; // USD, estimativa
  const problemSources = result.sources.filter((s) => s.status !== "ok");
  const truncatedSearches = result.searches.filter(
    (s) => s.truncated && specByKey(s.typeKey)?.completeness !== "obrigatoria"
  );
  const capWarnings = radiusCapWarnings(scope);
  const withoutAnchor = result.qa?.discardsByReason.complementar_sem_ancora_proxima ?? 0;

  const scopeCards = [
    { label: "Âncoras no raio", value: formatNumber(counters.anchors), color: "text-[#C9A84C]" },
    { label: "Pontos potenciais", value: formatNumber(counters.complementary), color: "text-white" },
    { label: "Concorrentes no raio", value: formatNumber(counters.competitors), color: "text-[#F44336]" },
    { label: "DC no raio", value: formatNumber(counters.competitorsDC), color: "text-[#FF8800]" },
    { label: "AC no raio", value: formatNumber(counters.competitorsAC), color: "text-[#42A5F5]" },
    { label: "Tipo não informado", value: formatNumber(counters.competitorsUnknown), color: "text-[#8B949E]" },
  ];

  const tagLabel = (t?: string) =>
    t === "manual" ? "Dados informados" : t === "cache" ? "Dados salvos" : t === "abve" ? "ABVE" : t === "estimate" ? "Estimativa" : t === "none" ? "Sem dados" : "—";

  const municipalCards = municipal
    ? [
        { label: "População (município)", value: formatNumber(municipal.population), available: municipal.population !== null },
        { label: "PIB per capita (município)", value: formatCurrency(municipal.gdpPerCapita), available: municipal.gdpPerCapita !== null },
        {
          label: "EVs BEV+PHEV (município)",
          value: formatNumber(municipal.bevPlusPHEV),
          available: municipal.bevPlusPHEV > 0,
          subtitle: `(${tagLabel(municipal.evsSourceTag)})`,
          title: `BEV: ${formatNumber(municipal.bev)} | PHEV: ${formatNumber(municipal.phev)} | Total eletrificados: ${formatNumber(municipal.totalEVs)}`,
        },
        { label: "Carregadores DC (município)", value: formatNumber(municipal.dcChargers), available: municipal.dcChargers > 0, subtitle: `(${tagLabel(municipal.chargersSourceTag)})` },
        { label: "Carregadores AC (município)", value: formatNumber(municipal.acChargers), available: municipal.acChargers > 0, subtitle: `(${tagLabel(municipal.chargersSourceTag)})` },
        { label: "BEV+PHEV/DC (município)", value: formatNumber(municipal.ratioEVperDC), available: municipal.ratioEVperDC > 0, subtitle: "ideal: 10" },
      ]
    : [];

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mapa de Calor — {scope.label}</h1>
          <p className="mt-1 text-sm text-[#8B949E]">
            Raio de estudo {radiusText} · {counters.anchors} pontos âncora · {counters.complementary} pontos potenciais ·{" "}
            {counters.competitors} concorrentes
            {result.fromCache && (
              <span className="ml-2 rounded bg-[#2196F320] px-2 py-0.5 text-xs text-[#2196F3]">cache</span>
            )}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#484F58]">{reportStamp(result)}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportHTML}
            className="rounded-lg border border-[#C9A84C] px-4 py-2 text-sm font-medium text-[#C9A84C] transition-colors hover:bg-[#C9A84C] hover:text-[#0D1117]"
          >
            Exportar HTML
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg border border-[#30363D] px-4 py-2 text-sm text-[#8B949E] transition-colors hover:border-[#C9A84C] hover:text-white"
          >
            Nova Análise
          </button>
        </div>
      </div>

      {capWarnings.map((w) => (
        <div
          key={w}
          className="mt-3 rounded-lg border border-[#FFC107] bg-[#FFC10726] px-3 py-2 text-sm font-semibold text-[#FFE082]"
        >
          ⚠ {w}
        </div>
      ))}

      {/* Escopo */}
      <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-[#C9A84C]">
        No escopo — raio de {radiusText}
      </p>
      <div className="mt-1 grid grid-cols-6 gap-2">
        {scopeCards.map((s) => (
          <div key={s.label} className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-2 text-center">
            <p className="text-[10px] text-[#8B949E]">{s.label}</p>
            <p className={`mt-1 text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {counters.competitors === 0 && (
        <div className="mt-2 rounded-lg border border-[#66BB6A] bg-[#66BB6A1A] px-3 py-2 text-xs text-[#A5D6A7]">
          <strong>0 concorrentes no raio de {radiusText}</strong> — praça sem concorrência mapeada, oportunidade a
          validar em campo.
        </div>
      )}
      {truncatedSearches.length > 0 && (
        <div className="mt-2 rounded-lg border border-[#FFC107] bg-[#FFC1071A] px-3 py-2 text-xs text-[#FFE082]">
          Camadas de apoio no limite de resultados da API (
          {[...new Set(truncatedSearches.map((s) => s.typeKey))].join(", ")}): podem estar incompletas. A camada de
          concorrentes é sempre buscada até completar.
        </div>
      )}
      {problemSources.length > 0 && (
        <div className="mt-2 rounded-lg border border-[#30363D] bg-[#161B22] px-3 py-2 text-[11px] text-[#FFC107]">
          {problemSources.map((s) => (
            <div key={s.name}>
              Fonte {s.name}: {s.status} — {s.detail}
            </div>
          ))}
        </div>
      )}

      {/* Indicadores municipais */}
      {municipal && (
        <>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-[#8B949E]">
            Indicadores municipais — {municipal.city}/{municipal.state} (não são do bairro)
          </p>
          <div className="mt-1 grid grid-cols-6 gap-2">
            {municipalCards.map((s) => (
              <div
                key={s.label}
                title={s.title}
                className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-2 text-center"
              >
                <p className="text-[10px] text-[#8B949E]">{s.label}</p>
                {s.available ? (
                  <>
                    <p className="mt-1 text-base font-bold text-white">{s.value}</p>
                    {s.subtitle && <p className="mt-0.5 text-[9px] italic text-[#8B949E]">{s.subtitle}</p>}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-[#8B949E]">Sem dados</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {isAdmin && result.qa && (
        <div className="mt-2 rounded-lg border border-[#30363D] bg-[#161B22] px-3 py-2 text-xs text-[#8B949E]">
          <span className="font-medium text-[#C9A84C]">[ADMIN]</span> QA gate {result.qa.passed ? "aprovado" : "REPROVADO"} ·
          Google: {result.googleQueries} requisições ≈ US$ {googleCost.toFixed(2)}
          {result.fromCache && " (cache hit — 0 cobradas agora)"} · Descartes:{" "}
          {Object.entries(result.qa.discardsByReason)
            .map(([k, n]) => `${DISCARD_REASON_LABELS[k as DiscardReason]} ${n}`)
            .join(" · ") || "nenhum"}{" "}
          · Complementares sem âncora a ≤ 500 m: {withoutAnchor}
        </div>
      )}

      <div className="mt-3 flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden rounded-xl border border-[#30363D]">
          <HeatmapMapV2
            scope={scope}
            anchors={result.anchors}
            complementary={result.complementary}
            competitors={result.competitors}
            flyTo={flyTo}
          />
        </div>

        <div className="flex w-[28rem] shrink-0 flex-col rounded-xl border border-[#30363D] bg-[#161B22]">
          <div className="border-b border-[#30363D] px-3 py-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#C9A84C]">
              Pontos Âncora ({result.anchors.length})
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {result.anchors.length === 0 ? (
              <p className="p-4 text-center text-sm text-[#8B949E]">Nenhum ponto âncora no raio de {radiusText}.</p>
            ) : (
              anchorsByType.map(({ type, label, items }) => (
                <div key={type}>
                  <div className="bg-[#0D1117] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#C9A84C]">
                    {ANCHOR_EMOJI[type] || "📍"} {label} ({items.length})
                  </div>
                  {items.map((a) => (
                    <button
                      key={a.placeId}
                      onClick={() => setFlyTo({ lat: a.lat, lng: a.lng, zoom: 16 })}
                      className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                    >
                      <p className="truncate text-xs font-medium text-white">{a.name}</p>
                      <p className="truncate text-[10px] text-[#8B949E]">
                        {fmtKm(a.distanceToCenterM)} do centro · {a.address}
                      </p>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-[#30363D]">
            <button
              onClick={() => setShowCompetitors((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#F44336] transition-colors hover:text-white"
            >
              <span>Concorrentes no raio ({result.competitors.length})</span>
              <span>{showCompetitors ? "▴" : "▾"}</span>
            </button>
            {showCompetitors && (
              <div className="max-h-60 overflow-y-auto border-t border-[#30363D]">
                {result.competitors.length === 0 ? (
                  <p className="p-3 text-center text-xs text-[#8B949E]">0 concorrentes no raio de {radiusText}.</p>
                ) : (
                  result.competitors.map((c) => (
                    <button
                      key={c.placeId}
                      onClick={() => setFlyTo({ lat: c.lat, lng: c.lng, zoom: 17 })}
                      className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                    >
                      <div className="flex items-center gap-2">
                        <ChargerBadge c={c} />
                        <p className="flex-1 truncate text-xs font-medium text-white">{c.name}</p>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-[#8B949E]">
                        {fmtKm(c.distanceToCenterM)} do centro · {c.address}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[#30363D]">
            <button
              onClick={() => setShowComplementary((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#8B949E] transition-colors hover:text-white"
            >
              <span>Pontos Potenciais ({result.complementary.length})</span>
              <span>{showComplementary ? "▴" : "▾"}</span>
            </button>
            {showComplementary && (
              <div className="max-h-60 overflow-y-auto border-t border-[#30363D]">
                {complementaryByAnchor.length === 0 ? (
                  <p className="p-3 text-center text-xs text-[#8B949E]">Nenhum ponto potencial próximo a âncoras.</p>
                ) : (
                  complementaryByAnchor.map((g) => (
                    <div key={g.anchorName}>
                      <div className="bg-[#0D1117] px-3 py-1.5 text-[10px] font-bold uppercase text-[#8B949E]">
                        Próximos a {g.anchorName} ({g.items.length})
                      </div>
                      {g.items.map((cp) => (
                        <button
                          key={cp.placeId}
                          onClick={() => setFlyTo({ lat: cp.lat, lng: cp.lng, zoom: 17 })}
                          className="block w-full border-b border-[#30363D] px-3 py-2 text-left transition-colors hover:bg-[#21262D]"
                        >
                          <p className="truncate text-xs font-medium text-white">
                            {cp.name} ({cp.nearAnchorDist} m)
                          </p>
                          <p className="truncate text-[10px] text-[#8B949E]">{cp.typeLabel}</p>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
