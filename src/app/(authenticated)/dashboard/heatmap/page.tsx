"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";

// ---------- Types ----------
interface PointData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  category: string;
  subcategory: string;
  score: number;
  classification: string;
  justification: string;
  operacao_24h: boolean;
  tempo_permanencia: string;
  pontos_fortes: string[];
  pontos_atencao: string[];
}

interface ChargerData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  rating: number | null;
  reviews: number | null;
  operator: string;
}

interface MobilityZoneData {
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  typeLabel: string;
}

interface AnalysisResult {
  city: string;
  state: string;
  population: number | null;
  points: PointData[];
  chargers: ChargerData[];
  mobilityZones: MobilityZoneData[];
}

// ---------- Constants ----------
const CLASSIFICATION_COLORS: Record<string, string> = {
  PREMIUM: "#00D97E",
  ESTRATEGICO: "#2196F3",
  VIAVEL: "#FFC107",
  MARGINAL: "#FF9800",
  REJEITADO: "#F44336",
};

const CATEGORY_LABELS: Record<string, string> = {
  posto_24h: "Posto 24h",
  posto_combustivel: "Posto",
  shopping: "Shopping",
  hospital_24h: "Hospital 24h",
  farmacia_24h: "Farmácia 24h",
  rodoviaria: "Rodoviária",
  aeroporto: "Aeroporto",
  universidade: "Universidade",
  supermercado: "Supermercado",
  atacadao: "Atacadão",
  hotel: "Hotel",
  academia: "Academia",
  estacionamento: "Estacionamento",
  concessionaria: "Concessionária",
  centro_comercial: "Centro Comercial",
  terreno: "Terreno",
  restaurante: "Restaurante",
  outro: "Outro",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  PREMIUM: "Premium",
  ESTRATEGICO: "Estratégico",
  VIAVEL: "Viável",
  MARGINAL: "Marginal",
  REJEITADO: "Rejeitado",
};

const MOBILITY_TYPE_COLORS: Record<string, string> = {
  taxi: "#42A5F5",
  aeroporto: "#5C6BC0",
  rodoviaria: "#7E57C2",
  shopping: "#EC407A",
  hospital: "#EF5350",
  universidade: "#66BB6A",
  logistica: "#FFA726",
  gnv: "#26A69A",
};

const LOADING_STEPS = [
  "Buscando dados da cidade no IBGE...",
  "Analisando variáveis estratégicas com IA...",
  "Gerando pontos com IA...",
  "Renderizando mapa de calor...",
];

// ---------- Helpers ----------
function getScoreColor(score: number): string {
  if (score >= 80) return "#00D97E";
  if (score >= 60) return "#2196F3";
  if (score >= 40) return "#FFC107";
  if (score >= 20) return "#FF9800";
  return "#F44336";
}

// ---------- Map component (client-only via dynamic import) ----------
const HeatmapMap = dynamic(() => import("./HeatmapMap"), { ssr: false });

// ---------- Main Page ----------
export default function HeatmapPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);
  const [showChargers, setShowChargers] = useState(true);
  const [showMobility, setShowMobility] = useState(true);
  const [loadingChargers, setLoadingChargers] = useState(false);
  const [loadingMobility, setLoadingMobility] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<
    "pontos" | "concorrentes" | "mobilidade"
  >("pontos");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cycle through loading steps
  useEffect(() => {
    if (loading) {
      setLoadingStep(0);
      intervalRef.current = setInterval(() => {
        setLoadingStep((prev) =>
          prev < LOADING_STEPS.length - 1 ? prev + 1 : prev
        );
      }, 3500);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  // Fetch chargers in background after map renders
  const fetchChargersBackground = useCallback(
    async (cityName: string, stateName: string) => {
      setLoadingChargers(true);
      try {
        const res = await fetch("/api/analyze-city/chargers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityName, state: stateName }),
        });
        const data = await res.json();
        if (res.ok && data.chargers) {
          setResult((prev) =>
            prev ? { ...prev, chargers: data.chargers } : prev
          );
        }
      } catch (err) {
        console.error("Erro ao buscar concorrentes:", err);
      } finally {
        setLoadingChargers(false);
      }
    },
    []
  );

  // Fetch mobility zones in background after map renders
  const fetchMobilityBackground = useCallback(
    async (cityName: string, stateName: string) => {
      setLoadingMobility(true);
      try {
        const res = await fetch("/api/analyze-city/mobility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityName, state: stateName }),
        });
        const data = await res.json();
        if (res.ok && data.mobilityZones) {
          setResult((prev) =>
            prev ? { ...prev, mobilityZones: data.mobilityZones } : prev
          );
        }
      } catch (err) {
        console.error("Erro ao buscar zonas de mobilidade:", err);
      } finally {
        setLoadingMobility(false);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!city.trim() || !state.trim()) return;
      setError("");
      setResult(null);
      setLoading(true);
      setCategoryFilter(null);
      setSelectedPointIdx(null);
      setSidebarTab("pontos");
      setShowChargers(true);
      setShowMobility(true);

      const trimmedCity = city.trim();
      const trimmedState = state.trim();

      try {
        // Primeira request: só Claude API pra gerar os pontos
        const res = await fetch("/api/analyze-city", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: trimmedCity, state: trimmedState }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro desconhecido");

        // Mostrar mapa IMEDIATAMENTE com os pontos do Claude
        setResult({
          ...data,
          chargers: [],
          mobilityZones: [],
        });
        setLoading(false);

        // Depois que o mapa renderizar, buscar concorrentes e mobilidade em background
        fetchChargersBackground(trimmedCity, trimmedState);
        fetchMobilityBackground(trimmedCity, trimmedState);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Erro ao analisar cidade"
        );
        setLoading(false);
      }
    },
    [city, state, fetchChargersBackground, fetchMobilityBackground]
  );

  // Filtered points
  const filteredPoints = result
    ? categoryFilter
      ? result.points.filter((p) => p.category === categoryFilter)
      : result.points
    : [];

  // Stats
  const stats = result
    ? {
        total: result.points.length,
        premium: result.points.filter((p) => p.classification === "PREMIUM")
          .length,
        strategic: result.points.filter(
          (p) => p.classification === "ESTRATEGICO"
        ).length,
        viable: result.points.filter((p) => p.classification === "VIAVEL")
          .length,
        avgScore: Math.round(
          result.points.reduce((sum, p) => sum + p.score, 0) /
            result.points.length
        ),
        chargers: result.chargers.length,
        mobilityZones: result.mobilityZones.length,
      }
    : null;

  // Available categories
  const categories = result
    ? [...new Set(result.points.map((p) => p.category))].sort()
    : [];

  // Mobility zone type counts
  const mobilityTypeCounts = result
    ? result.mobilityZones.reduce(
        (acc, z) => {
          acc[z.typeLabel] = (acc[z.typeLabel] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    : {};

  // ========== RENDER ==========

  // Initial form state
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Descubra os melhores pontos para instalação de eletropostos na cidade.
        </p>

        <div className="mt-8 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-xl border border-[#30363D] bg-[#161B22] p-8"
          >
            <h2 className="mb-6 text-lg font-semibold text-white">
              Analisar Cidade
            </h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#8B949E]">
                  Cidade
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex: São Paulo"
                  required
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#00D97E]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#8B949E]">
                  Estado (sigla)
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="Ex: SP"
                  maxLength={2}
                  required
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#00D97E]"
                />
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              className="mt-6 w-full rounded-lg bg-[#00D97E] px-4 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#00c06e]"
            >
              Analisar Cidade
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Mapa de Calor</h1>
        <p className="mt-1 text-[#8B949E]">
          Analisando {city} - {state}...
        </p>

        <div className="mt-16 flex flex-col items-center justify-center gap-8">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 rounded-full border-4 border-[#30363D]" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#00D97E]" />
          </div>

          <div className="space-y-3 text-center">
            {LOADING_STEPS.map((step, i) => (
              <p
                key={step}
                className={`text-sm transition-all duration-500 ${
                  i <= loadingStep
                    ? "text-white opacity-100"
                    : "text-[#8B949E] opacity-40"
                } ${i === loadingStep ? "text-[#00D97E] font-medium scale-105" : ""}`}
              >
                {i < loadingStep ? "✓ " : i === loadingStep ? "● " : "○ "}
                {step}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Results
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Mapa de Calor — {result!.city}, {result!.state}
          </h1>
          <p className="mt-1 text-[#8B949E]">
            {result!.population
              ? `Pop: ${result!.population.toLocaleString("pt-BR")} hab. | `
              : ""}
            {result!.points.length} pontos sugeridos
            {loadingChargers
              ? " | Buscando concorrentes..."
              : result!.chargers.length > 0
                ? ` | ${result!.chargers.length} concorrentes`
                : ""}
            {loadingMobility
              ? " | Buscando zonas de mobilidade..."
              : result!.mobilityZones.length > 0
                ? ` | ${result!.mobilityZones.length} zonas de mobilidade`
                : ""}
          </p>
        </div>
        <button
          onClick={() => {
            setResult(null);
            setCity("");
            setState("");
          }}
          className="rounded-lg border border-[#30363D] px-4 py-2 text-sm text-[#8B949E] transition-colors hover:border-[#00D97E] hover:text-white"
        >
          Nova Análise
        </button>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="mt-4 grid grid-cols-7 gap-2">
          {[
            { label: "Pontos", value: stats.total, color: "text-white" },
            { label: "Premium", value: stats.premium, color: "text-[#00D97E]" },
            {
              label: "Estratégicos",
              value: stats.strategic,
              color: "text-[#2196F3]",
            },
            { label: "Viáveis", value: stats.viable, color: "text-[#FFC107]" },
            {
              label: "Score Médio",
              value: stats.avgScore,
              color: "text-[#00D97E]",
            },
            {
              label: "Concorrentes",
              value: loadingChargers ? "..." : stats.chargers,
              color: "text-[#F44336]",
            },
            {
              label: "Zonas Mob.",
              value: loadingMobility ? "..." : stats.mobilityZones,
              color: "text-[#42A5F5]",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-[#30363D] bg-[#161B22] px-2 py-3 text-center"
            >
              <p className="text-[10px] text-[#8B949E]">{s.label}</p>
              <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main content: sidebar + map */}
      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar */}
        <div className="flex w-80 shrink-0 flex-col rounded-xl border border-[#30363D] bg-[#161B22]">
          {/* Sidebar Tabs */}
          <div className="flex border-b border-[#30363D]">
            <button
              onClick={() => setSidebarTab("pontos")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "pontos"
                  ? "border-b-2 border-[#00D97E] text-[#00D97E]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Pontos ({result?.points.length})
            </button>
            <button
              onClick={() => setSidebarTab("concorrentes")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "concorrentes"
                  ? "border-b-2 border-[#F44336] text-[#F44336]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Concorrentes ({loadingChargers ? "..." : result?.chargers.length})
            </button>
            <button
              onClick={() => setSidebarTab("mobilidade")}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                sidebarTab === "mobilidade"
                  ? "border-b-2 border-[#42A5F5] text-[#42A5F5]"
                  : "text-[#8B949E] hover:text-white"
              }`}
            >
              Mobilidade ({loadingMobility ? "..." : result?.mobilityZones.length})
            </button>
          </div>

          {/* ===== TAB: Pontos ===== */}
          {sidebarTab === "pontos" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                <p className="mb-2 text-xs font-medium text-[#8B949E] uppercase tracking-wide">
                  Filtrar por categoria
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      categoryFilter === null
                        ? "bg-[#00D97E] text-[#0D1117]"
                        : "bg-[#21262D] text-[#8B949E] hover:text-white"
                    }`}
                  >
                    Todos ({result?.points.length})
                  </button>
                  {categories.map((cat) => {
                    const count = result!.points.filter(
                      (p) => p.category === cat
                    ).length;
                    return (
                      <button
                        key={cat}
                        onClick={() =>
                          setCategoryFilter(
                            categoryFilter === cat ? null : cat
                          )
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          categoryFilter === cat
                            ? "bg-[#00D97E] text-[#0D1117]"
                            : "bg-[#21262D] text-[#8B949E] hover:text-white"
                        }`}
                      >
                        {CATEGORY_LABELS[cat] || cat} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredPoints.map((point, idx) => {
                  const globalIdx = result!.points.indexOf(point);
                  const scoreColor = getScoreColor(point.score);
                  const classColor =
                    CLASSIFICATION_COLORS[point.classification] || "#8B949E";
                  return (
                    <button
                      key={`${point.lat}-${point.lng}-${idx}`}
                      onClick={() => setSelectedPointIdx(globalIdx)}
                      className={`w-full border-b border-[#30363D] p-3 text-left transition-colors hover:bg-[#21262D] ${
                        selectedPointIdx === globalIdx
                          ? "bg-[#21262D] border-l-2 border-l-[#00D97E]"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {point.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {point.address}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] font-medium text-[#8B949E]">
                              {CATEGORY_LABELS[point.category] ||
                                point.category}
                            </span>
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                              style={{
                                backgroundColor: classColor + "20",
                                color: classColor,
                              }}
                            >
                              {CLASSIFICATION_LABELS[point.classification] ||
                                point.classification}
                            </span>
                            {point.operacao_24h && (
                              <span className="rounded bg-[#00D97E20] px-1.5 py-0.5 text-[10px] font-bold text-[#00D97E]">
                                24H
                              </span>
                            )}
                            {point.tempo_permanencia && (
                              <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] text-[#8B949E]">
                                {point.tempo_permanencia}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 flex-col items-center rounded-lg px-2 py-1"
                          style={{ backgroundColor: scoreColor + "15" }}
                        >
                          <span
                            className="text-lg font-bold leading-tight"
                            style={{ color: scoreColor }}
                          >
                            {point.score}
                          </span>
                          <span className="text-[9px] text-[#8B949E]">
                            score
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ===== TAB: Concorrentes ===== */}
          {sidebarTab === "concorrentes" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showChargers}
                    onChange={(e) => setShowChargers(e.target.checked)}
                    className="h-4 w-4 rounded border-[#30363D] bg-[#0D1117] accent-[#F44336]"
                  />
                  <span className="text-xs text-[#8B949E]">
                    Mostrar no mapa
                  </span>
                </label>
                <p className="mt-2 text-xs text-[#8B949E]">
                  {loadingChargers
                    ? "Buscando carregadores existentes..."
                    : `${result!.chargers.length} carregadores encontrados via Google Places`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingChargers ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#30363D] border-t-[#F44336]" />
                    <span className="ml-3 text-sm text-[#8B949E]">Carregando...</span>
                  </div>
                ) : result!.chargers.length === 0 ? (
                  <div className="p-4 text-center text-sm text-[#8B949E]">
                    Nenhum carregador existente encontrado na cidade.
                  </div>
                ) : (
                  result!.chargers.map((charger, idx) => (
                    <div
                      key={`charger-${charger.lat}-${charger.lng}-${idx}`}
                      className="border-b border-[#30363D] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {charger.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {charger.address}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#F4433620] px-1.5 py-0.5 text-[10px] font-bold text-[#F44336]">
                              CONCORRENTE
                            </span>
                            {charger.operator && (
                              <span className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] text-[#8B949E]">
                                {charger.operator}
                              </span>
                            )}
                          </div>
                        </div>
                        {charger.rating && (
                          <div className="flex shrink-0 flex-col items-center rounded-lg bg-[#FF980015] px-2 py-1">
                            <span className="text-lg font-bold leading-tight text-[#FF9800]">
                              {charger.rating.toFixed(1)}
                            </span>
                            <span className="text-[9px] text-[#8B949E]">
                              {charger.reviews ?? 0} rev
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* ===== TAB: Mobilidade ===== */}
          {sidebarTab === "mobilidade" && (
            <>
              <div className="border-b border-[#30363D] p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMobility}
                    onChange={(e) => setShowMobility(e.target.checked)}
                    className="h-4 w-4 rounded border-[#30363D] bg-[#0D1117] accent-[#42A5F5]"
                  />
                  <span className="text-xs text-[#8B949E]">
                    Mostrar zonas no mapa
                  </span>
                </label>
                <p className="mt-2 text-xs text-[#8B949E]">
                  {loadingMobility
                    ? "Buscando zonas de mobilidade profissional..."
                    : `${result!.mobilityZones.length} pontos de mobilidade profissional mapeados via Google Places`}
                </p>
                {/* Type summary pills */}
                {!loadingMobility && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(mobilityTypeCounts).map(([label, count]) => (
                      <span
                        key={label}
                        className="rounded bg-[#21262D] px-1.5 py-0.5 text-[10px] text-[#8B949E]"
                      >
                        {label}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingMobility ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#30363D] border-t-[#42A5F5]" />
                    <span className="ml-3 text-sm text-[#8B949E]">Carregando...</span>
                  </div>
                ) : result!.mobilityZones.length === 0 ? (
                  <div className="p-4 text-center text-sm text-[#8B949E]">
                    Nenhuma zona de mobilidade encontrada.
                  </div>
                ) : (
                  result!.mobilityZones.map((zone, idx) => (
                    <div
                      key={`zone-${zone.lat}-${zone.lng}-${idx}`}
                      className="border-b border-[#30363D] p-3"
                    >
                      <div className="flex items-start gap-2">
                        {/* Color dot */}
                        <div
                          className="mt-1 h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5",
                            boxShadow: `0 0 6px ${MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5"}80`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {zone.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                            {zone.address}
                          </p>
                          <span
                            className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              backgroundColor: `${MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5"}20`,
                              color:
                                MOBILITY_TYPE_COLORS[zone.type] || "#42A5F5",
                            }}
                          >
                            {zone.typeLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 overflow-hidden rounded-xl border border-[#30363D]">
          <HeatmapMap
            points={filteredPoints}
            allPoints={result!.points}
            chargers={showChargers ? result!.chargers : []}
            mobilityZones={showMobility ? result!.mobilityZones : []}
            selectedPointIdx={selectedPointIdx}
            onSelectPoint={setSelectedPointIdx}
          />
        </div>
      </div>
    </div>
  );
}
