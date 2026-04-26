"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { buildScoreHtml } from "@/lib/score-html-export";

// ---------- Types ----------

type ScoreSource = "ABVE" | "Google Places" | "IBGE" | "Cálculo" | "Usuário";

interface ScoringVariable {
  id: number;
  name: string;
  category: string;
  score: number;
  weight: number;
  justification: string;
  source: ScoreSource;
}

interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  rating: number | null;
  reviews: number | null;
  distance_m: number;
}

interface CostBreakdown {
  googleQueries: number;
  googleCostUsd: number;
  claudeTokensIn: number;
  claudeTokensOut: number;
  claudeCostUsd: number;
  totalCostUsd: number;
}

interface ScoreResult {
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  overall_score: number;
  raw_score: number;
  city_factor: number;
  classification: string;
  category_scores: Record<string, number>;
  scoring_variables: ScoringVariable[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  nearby_pois: NearbyPlace[];
  nearby_chargers: NearbyPlace[];
  ibge_data: {
    population: number | null;
    gdp_total: number | null;
    gdp_per_capita: number | null;
    idhm: number | null;
  };
  abve_data?: {
    city: string;
    state: string;
    ac: number;
    dc: number;
    total: number;
    evsSold?: number;
  } | null;
  data_sources?: {
    cross_check: Array<{
      source: string;
      total: number | null;
      dc: number | null;
      status: "ok" | "partial" | "unavailable";
      details: string;
    }>;
    best_total: { value: number; source: string };
    best_dc: { value: number; source: string };
  };
  cost_breakdown: CostBreakdown;
}

// ---------- Constants ----------

const ESTABLISHMENT_TYPES: Record<string, string> = {
  posto_24h: "Posto de Combustível 24h",
  posto_combustivel: "Posto de Combustível",
  shopping: "Shopping Center",
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
  terreno: "Terreno",
  restaurante: "Restaurante",
  outro: "Outro",
};

const CLASSIFICATION_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  PREMIUM: { label: "Premium", color: "#C9A84C" },
  ESTRATÉGICO: { label: "Estratégico", color: "#2196F3" },
  VIÁVEL: { label: "Viável", color: "#FFC107" },
  MARGINAL: { label: "Marginal", color: "#FF9800" },
  "NÃO RECOMENDADO": { label: "Não Recomendado", color: "#F44336" },
};

const CATEGORY_LABELS: Record<string, string> = {
  CIDADE: "Cidade",
  CONCORRENCIA: "Concorrência",
  ENTORNO: "Entorno",
  LOCALIZACAO: "Localização",
  TIPO: "Tipo de Estabelecimento",
  OBSERVACOES: "Observações",
};

const CATEGORY_ICONS: Record<string, string> = {
  CIDADE: "🏙️",
  CONCORRENCIA: "🏁",
  ENTORNO: "🏪",
  LOCALIZACAO: "📍",
  TIPO: "🏢",
  OBSERVACOES: "📝",
};

const SOURCE_BADGE: Record<ScoreSource, { bg: string; fg: string; label: string }> = {
  ABVE: { bg: "#1F8F4F22", fg: "#3FB373", label: "ABVE" },
  "Google Places": { bg: "#2196F322", fg: "#5BB3F0", label: "Google Places" },
  IBGE: { bg: "#8B949E22", fg: "#A6ADBA", label: "IBGE" },
  Cálculo: { bg: "#FFC10722", fg: "#FFC107", label: "Cálculo" },
  Usuário: { bg: "#A06CD522", fg: "#B98AE0", label: "Usuário" },
};

const LOADING_STEPS = [
  "Geocodificando endereço...",
  "Buscando dados ABVE da cidade...",
  "Consultando IBGE...",
  "Identificando concorrentes...",
  "Buscando POIs no entorno...",
  "Calculando score (28 variáveis)...",
  "Gerando análise textual...",
];

const POI_COLORS: Record<string, string> = {
  restaurante: "#FF6B6B",
  farmacia: "#4ECDC4",
  posto: "#FFE66D",
  shopping: "#A06CD5",
  hospital: "#FF8A5C",
  universidade: "#4ECDC4",
  hotel: "#5BB3F0",
  estacionamento: "#FFC107",
  supermercado: "#3FB373",
};

// ---------- Helpers ----------

function getClassificationColor(classification: string): string {
  return CLASSIFICATION_CONFIG[classification]?.color || "#8B949E";
}

function getClassificationLabel(classification: string): string {
  return CLASSIFICATION_CONFIG[classification]?.label || classification;
}

function getScoreColor(score: number): string {
  if (score >= 8.5) return "#C9A84C";
  if (score >= 7) return "#2196F3";
  if (score >= 5.5) return "#FFC107";
  if (score >= 4) return "#FF9800";
  return "#F44336";
}

// Recompute observation variable client-side (zero API cost)
function recomputeObservationScore(text: string): {
  score: number;
  justification: string;
} {
  const obs = (text || "").toLowerCase();
  let score = 5;
  const matchedPos: string[] = [];
  const matchedNeg: string[] = [];
  const positivas = [
    "rodovia", "br-", "transformador", "energia trifásica", "trifasica", "trifásica",
    "estacionamento", "movimento", "fluxo", "24h", "24 horas", "vagas", "câmera",
    "camera", "segurança", "seguranca", "iluminação", "iluminacao", "avenida principal",
    "esquina", "frente", "visível", "visivel", "próprio", "proprio", "parceria",
    "subestação", "subestacao",
  ];
  const negativas = [
    "rua sem saída", "sem saida", "violência", "violencia", "perigoso", "abandonado",
    "alagamento", "enchente", "rede precária", "precaria", "monofásico", "monofasico",
    "sem energia", "obras", "interditado", "longe", "isolado", "deserto",
  ];
  for (const k of positivas) {
    if (obs.includes(k)) {
      score += 0.7;
      matchedPos.push(k);
    }
  }
  for (const k of negativas) {
    if (obs.includes(k)) {
      score -= 1.0;
      matchedNeg.push(k);
    }
  }
  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  let justification: string;
  if (!obs.trim()) {
    justification = "Sem observações fornecidas";
  } else {
    const parts: string[] = [];
    if (matchedPos.length)
      parts.push(`+${matchedPos.length} positivas: ${matchedPos.slice(0, 3).join(", ")}`);
    if (matchedNeg.length)
      parts.push(`-${matchedNeg.length} negativas: ${matchedNeg.slice(0, 3).join(", ")}`);
    justification = parts.length
      ? parts.join(" | ")
      : "Observação fornecida sem palavras-chave reconhecidas";
  }
  return { score, justification };
}

// Recompute final score from current variables (used after observation edit)
const CATEGORY_WEIGHTS: Record<string, number> = {
  CIDADE: 0.20,
  CONCORRENCIA: 0.25,
  ENTORNO: 0.20,
  LOCALIZACAO: 0.15,
  TIPO: 0.10,
  OBSERVACOES: 0.10,
};

function recomputeOverall(
  variables: ScoringVariable[],
  cityFactor: number
): { rawScore: number; overallScore: number; classification: string; categoryScores: Record<string, number> } {
  const categoryScores: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_WEIGHTS)) {
    const inCat = variables.filter((v) => v.category === cat);
    if (!inCat.length) {
      categoryScores[cat] = 0;
      continue;
    }
    let weighted = 0;
    let totalW = 0;
    for (const v of inCat) {
      weighted += v.score * v.weight;
      totalW += v.weight;
    }
    categoryScores[cat] = totalW > 0 ? weighted / totalW : 0;
  }
  let rawScore = 0;
  for (const [cat, w] of Object.entries(CATEGORY_WEIGHTS)) {
    rawScore += (categoryScores[cat] || 0) * 10 * w;
  }
  const finalMultiplier = 0.7 + 0.3 * cityFactor;
  const overallScore = Math.max(0, Math.min(100, Math.round(rawScore * finalMultiplier)));
  const classification =
    overallScore >= 85 ? "PREMIUM" :
    overallScore >= 70 ? "ESTRATÉGICO" :
    overallScore >= 55 ? "VIÁVEL" :
    overallScore >= 40 ? "MARGINAL" : "NÃO RECOMENDADO";
  return { rawScore: Math.round(rawScore * 10) / 10, overallScore, classification, categoryScores };
}

// ---------- Animated Gauge ----------

function ScoreGauge({
  score,
  classification,
}: {
  score: number;
  classification: string;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const color = getClassificationColor(classification);
  const classLabel = getClassificationLabel(classification);

  useEffect(() => {
    let frame: number;
    const duration = 1500;
    const start = performance.now();

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(eased * score));
      if (progress < 1) frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const circumference = 2 * Math.PI * 90;
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: 220, height: 220 }}>
        <svg width="220" height="220" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="90" fill="none" stroke="#21262D" strokeWidth="12" />
          <circle
            cx="110"
            cy="110"
            r="90"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 110 110)"
            style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold text-white">{animatedScore}</span>
          <span className="text-sm text-[#8B949E]">de 100</span>
        </div>
      </div>
      <span
        className="rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{ backgroundColor: color + "20", color }}
      >
        {classLabel}
      </span>
    </div>
  );
}

// ---------- Mini Map ----------

function MiniMap({
  lat,
  lng,
  pois,
  chargers,
}: {
  lat: number;
  lng: number;
  pois: NearbyPlace[];
  chargers: NearbyPlace[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    interface LLayer {
      addTo: (m: unknown) => LLayer;
      bindPopup: (s: string) => LLayer;
    }
    const L = (window as unknown as Record<string, unknown>).L as {
      map: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
      tileLayer: (url: string, opts: Record<string, unknown>) => LLayer;
      circleMarker: (latlng: [number, number], opts: Record<string, unknown>) => LLayer;
      circle: (latlng: [number, number], opts: Record<string, unknown>) => LLayer;
      marker: (latlng: [number, number], opts?: Record<string, unknown>) => LLayer;
      divIcon: (opts: Record<string, unknown>) => unknown;
    };
    if (!L) return;

    const map = L.map(mapRef.current, {
      center: [lat, lng] as unknown as Record<string, unknown>,
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    } as Record<string, unknown>);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.circle([lat, lng], {
      radius: 500,
      color: "#C9A84C",
      fillColor: "#C9A84C",
      fillOpacity: 0.05,
      weight: 1,
      dashArray: "5,5",
    }).addTo(map);

    const mainIcon = L.divIcon({
      html: `<div style="width:20px;height:20px;background:#C9A84C;border:3px solid white;border-radius:50%;"></div>`,
      iconSize: [20, 20] as unknown as Record<string, unknown>,
      iconAnchor: [10, 10] as unknown as Record<string, unknown>,
      className: "",
    });
    L.marker([lat, lng], { icon: mainIcon } as Record<string, unknown>)
      .addTo(map)
      .bindPopup("<b>Ponto analisado</b>");

    pois.forEach((poi) => {
      const poiColor = POI_COLORS[poi.type] || "#8B949E";
      L.circleMarker([poi.lat, poi.lng], {
        radius: 5,
        fillColor: poiColor,
        color: poiColor,
        weight: 1,
        fillOpacity: 0.8,
      })
        .addTo(map)
        .bindPopup(`<b>${poi.name}</b><br>${poi.type} · ${poi.distance_m}m`);
    });

    chargers.forEach((c) => {
      const chargerIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:#F44336;border:2px solid white;border-radius:50%;"></div>`,
        iconSize: [14, 14] as unknown as Record<string, unknown>,
        iconAnchor: [7, 7] as unknown as Record<string, unknown>,
        className: "",
      });
      L.marker([c.lat, c.lng], { icon: chargerIcon } as Record<string, unknown>)
        .addTo(map)
        .bindPopup(`<b>⚡ ${c.name}</b><br>${c.distance_m}m`);
    });

    mapInstanceRef.current = map;
  }, [lat, lng, pois, chargers]);

  return <div ref={mapRef} className="h-full w-full rounded-lg" />;
}

// ---------- Source Badge ----------

function SourceBadge({ source }: { source: ScoreSource }) {
  const cfg = SOURCE_BADGE[source];
  return (
    <span
      className="inline-flex rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  );
}

// ---------- Main Page ----------

export default function ScorePage() {
  return (
    <Suspense fallback={<div className="p-8 text-[#8B949E]">Carregando...</div>}>
      <ScorePageInner />
    </Suspense>
  );
}

function ScorePageInner() {
  const searchParams = useSearchParams();
  const [address, setAddress] = useState(searchParams.get("address") || "");
  const [establishmentType, setEstablishmentType] = useState(searchParams.get("type") || "");
  const [establishmentName, setEstablishmentName] = useState(searchParams.get("name") || "");
  const [addressTab, setAddressTab] = useState<"address" | "gmaps">("address");
  const [gmapsLink, setGmapsLink] = useState("");
  const [gmapsError, setGmapsError] = useState("");
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [scoreId, setScoreId] = useState<number | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Local state for client-side observation re-edit
  const [extraObservation, setExtraObservation] = useState("");
  const [obsDraftOpen, setObsDraftOpen] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (document.getElementById("leaflet-css")) {
      setLeafletLoaded(true);
      return;
    }
    const css = document.createElement("link");
    css.id = "leaflet-css";
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);

    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => setLeafletLoaded(true);
    document.head.appendChild(js);
  }, []);

  useEffect(() => {
    if (loading) {
      setLoadingStep(0);
      intervalRef.current = setInterval(() => {
        setLoadingStep((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
      }, 3000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  function parseGoogleMapsLink(link: string): { lat: number; lng: number } | null {
    const match1 = link.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match1) return { lat: parseFloat(match1[1]), lng: parseFloat(match1[2]) };
    const match2 = link.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match2) return { lat: parseFloat(match2[1]), lng: parseFloat(match2[2]) };
    const match3 = link.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match3) return { lat: parseFloat(match3[1]), lng: parseFloat(match3[2]) };
    return null;
  }

  async function handleGmapsLink(link: string) {
    setGmapsLink(link);
    setGmapsError("");
    setParsedCoords(null);

    if (!link.trim()) return;

    if (/goo\.gl/.test(link)) {
      setGmapsError(
        "Link curto não suportado. Abra o Google Maps, clique no local e copie o link completo da barra de endereço."
      );
      return;
    }

    const coords = parseGoogleMapsLink(link);
    if (!coords) {
      setGmapsError(
        "Não foi possível extrair coordenadas deste link. Copie o link completo da barra de endereço do Google Maps."
      );
      return;
    }

    setParsedCoords(coords);

    try {
      const res = await fetch(`/api/reverse-geocode?lat=${coords.lat}&lng=${coords.lng}`);
      if (res.ok) {
        const data = await res.json();
        if (data.address) setAddress(data.address);
      }
    } catch {
      // continue
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim() && !parsedCoords) return;

    setLoading(true);
    setError("");
    setResult(null);
    setExtraObservation("");

    try {
      const payload: Record<string, unknown> = {
        address: address.trim(),
        establishment_type: establishmentType || "outro",
        establishment_name: establishmentName.trim(),
      };
      if (parsedCoords) {
        payload.lat = parsedCoords.lat;
        payload.lng = parsedCoords.lng;
      }
      const res = await fetch("/api/score-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao analisar o ponto.");
        return;
      }

      setResult(data);
      setScoreId((data?.score_id as number) ?? null);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function applyObservation() {
    if (!result) return;
    const baseObs = (result.establishment_name || "").trim();
    const merged = [baseObs, extraObservation.trim()].filter(Boolean).join(" | ");
    const recomp = recomputeObservationScore(merged);

    const newVars = result.scoring_variables.map((v) =>
      v.category === "OBSERVACOES"
        ? { ...v, score: recomp.score, justification: recomp.justification }
        : v
    );
    const newAgg = recomputeOverall(newVars, result.city_factor);
    setResult({
      ...result,
      scoring_variables: newVars,
      raw_score: newAgg.rawScore,
      overall_score: newAgg.overallScore,
      classification: newAgg.classification,
      category_scores: newAgg.categoryScores,
      establishment_name: merged,
    });
    setExtraObservation("");
    setObsDraftOpen(false);
  }

  // Group + sort variables
  const sortedVariables = useMemo(() => {
    if (!result) return [];
    const order = ["CIDADE", "CONCORRENCIA", "ENTORNO", "LOCALIZACAO", "TIPO", "OBSERVACOES"];
    return [...result.scoring_variables].sort((a, b) => {
      const da = order.indexOf(a.category);
      const db = order.indexOf(b.category);
      if (da !== db) return da - db;
      return a.id - b.id;
    });
  }, [result]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Score do Ponto</h1>
      <p className="mt-1 text-[#8B949E]">
        Score 100% calculado por código a partir de dados verificáveis (ABVE, IBGE, Google Places).
      </p>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 rounded-xl border border-[#30363D] bg-[#161B22] p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Localização *
            </label>
            <div className="mb-2 flex gap-1 rounded-lg border border-[#30363D] bg-[#0D1117] p-1">
              <button
                type="button"
                onClick={() => setAddressTab("address")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  addressTab === "address"
                    ? "bg-[#C9A84C] text-[#0D1117]"
                    : "text-[#8B949E] hover:text-white"
                }`}
              >
                Endereço
              </button>
              <button
                type="button"
                onClick={() => setAddressTab("gmaps")}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  addressTab === "gmaps"
                    ? "bg-[#C9A84C] text-[#0D1117]"
                    : "text-[#8B949E] hover:text-white"
                }`}
              >
                Link do Google Maps
              </button>
            </div>

            {addressTab === "address" ? (
              <input
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setParsedCoords(null);
                }}
                placeholder="Ex: Av. Paulista, 1000, São Paulo, SP"
                className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                disabled={loading}
                required={addressTab === "address"}
              />
            ) : (
              <div>
                <input
                  type="text"
                  value={gmapsLink}
                  onChange={(e) => handleGmapsLink(e.target.value)}
                  placeholder="Cole aqui o link do Google Maps"
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
                  disabled={loading}
                />
                {gmapsError && <p className="mt-1.5 text-sm text-yellow-400">{gmapsError}</p>}
                {parsedCoords && (
                  <p className="mt-1.5 text-sm text-green-400">
                    Coordenadas extraídas: {parsedCoords.lat.toFixed(6)}, {parsedCoords.lng.toFixed(6)}
                    {address && ` — ${address}`}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Tipo de estabelecimento *
            </label>
            <select
              value={establishmentType}
              onChange={(e) => setEstablishmentType(e.target.value)}
              className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white outline-none transition-colors focus:border-[#C9A84C]"
              disabled={loading}
              required
            >
              <option value="">Selecione...</option>
              {Object.entries(ESTABLISHMENT_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Observações <span className="text-[#484F58]">(opcional)</span>
            </label>
            <textarea
              value={establishmentName}
              onChange={(e) => setEstablishmentName(e.target.value)}
              placeholder="Ex: terreno próprio, frente pra avenida principal, transformador trifásico..."
              rows={3}
              className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
              disabled={loading}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || (!address.trim() && !parsedCoords) || !establishmentType}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0D1117] border-t-transparent" />
              Analisando...
            </>
          ) : (
            <>Analisar Ponto</>
          )}
        </button>

        {loading && (
          <div className="mt-4 space-y-2">
            {LOADING_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {i < loadingStep ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="#C9A84C">
                    <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
                  </svg>
                ) : i === loadingStep ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C9A84C] border-t-transparent" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-[#30363D]" />
                )}
                <span className={i <= loadingStep ? "text-[#C9D1D9]" : "text-[#484F58]"}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Results */}
      {result && (
        <div className="mt-8 space-y-6">
          {/* Top: Gauge + Map */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <ScoreGauge score={result.overall_score} classification={result.classification} />
              <div className="mt-4 text-center">
                <p className="text-sm text-[#8B949E]">{result.address}</p>
                <p className="mt-1 text-xs text-[#484F58]">
                  {result.city} - {result.state} · {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
                </p>
                <p className="mt-2 text-[11px] text-[#484F58]">
                  Score bruto: {result.raw_score} | Fator cidade: {result.city_factor.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22] lg:col-span-2">
              <div className="flex items-center justify-between border-b border-[#30363D] px-4 py-3">
                <h3 className="text-sm font-semibold text-white">Mapa do Entorno (500m)</h3>
                <div className="flex items-center gap-3 text-xs text-[#8B949E]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#C9A84C" }} />
                    Ponto
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#F44336" }} />
                    Carregadores
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#4ECDC4" }} />
                    POIs
                  </span>
                </div>
              </div>
              <div style={{ height: 320 }}>
                {leafletLoaded ? (
                  <MiniMap
                    lat={result.lat}
                    lng={result.lng}
                    pois={result.nearby_pois}
                    chargers={result.nearby_chargers}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[#8B949E]">
                    Carregando mapa...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">População</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.ibge_data.population?.toLocaleString("pt-BR") ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">PIB per capita</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.ibge_data.gdp_per_capita
                  ? `R$ ${Math.round(result.ibge_data.gdp_per_capita).toLocaleString("pt-BR")}`
                  : "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">DC na Cidade (ABVE)</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.abve_data?.dc ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">EVs na Cidade (ABVE)</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.abve_data?.evsSold?.toLocaleString("pt-BR") ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">Concorrentes 500m</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.scoring_variables.find((v) => v.name === "Concorrentes em 500m")?.score ?? "—"}
                <span className="ml-1 text-sm font-normal text-[#8B949E]">/10</span>
              </p>
            </div>
          </div>

          {/* Variables Table */}
          <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22]">
            <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
              <h3 className="text-base font-semibold text-white">
                Variáveis do Score ({sortedVariables.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                {(Object.keys(SOURCE_BADGE) as ScoreSource[]).map((s) => (
                  <SourceBadge key={s} source={s} />
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0D1117] text-left text-xs uppercase text-[#8B949E]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Variável</th>
                    <th className="px-4 py-2.5 font-medium">Categoria</th>
                    <th className="px-4 py-2.5 font-medium text-center">Peso</th>
                    <th className="px-4 py-2.5 font-medium text-center">Nota</th>
                    <th className="px-4 py-2.5 font-medium">Fonte</th>
                    <th className="px-4 py-2.5 font-medium">Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVariables.map((v) => {
                    const color = getScoreColor(v.score);
                    return (
                      <tr key={v.id} className="border-t border-[#21262D] hover:bg-[#0D1117]">
                        <td className="px-4 py-3 text-xs text-[#8B949E]">{v.id}</td>
                        <td className="px-4 py-3 text-[#C9D1D9]">{v.name}</td>
                        <td className="px-4 py-3 text-xs text-[#8B949E]">
                          {CATEGORY_ICONS[v.category]} {CATEGORY_LABELS[v.category] || v.category}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-[#8B949E]">×{v.weight}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-base font-bold" style={{ color }}>
                            {v.score.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3"><SourceBadge source={v.source} /></td>
                        <td className="px-4 py-3 text-xs text-[#8B949E]">{v.justification}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Category scores summary */}
            <div className="border-t border-[#30363D] bg-[#0D1117] px-5 py-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {Object.entries(result.category_scores).map(([cat, score]) => (
                  <div key={cat} className="text-xs">
                    <div className="text-[#8B949E]">
                      {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}
                    </div>
                    <div
                      className="mt-0.5 text-base font-bold"
                      style={{ color: getScoreColor(score) }}
                    >
                      {score.toFixed(1)}<span className="ml-1 text-[10px] text-[#8B949E]">/10</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Fontes de Dados (cruzamento de fontes para concorrentes / DC) */}
          {result.data_sources && (
            <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22]">
              <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
                <h3 className="text-base font-semibold text-white">
                  🔎 Fontes de Dados — Concorrentes / DC na Cidade
                </h3>
                <span className="text-xs text-[#8B949E]">
                  Melhor DC: <span className="font-semibold text-white">{result.data_sources.best_dc.value}</span>
                  {" "}({result.data_sources.best_dc.source})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0D1117] text-left text-xs uppercase text-[#8B949E]">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Fonte</th>
                      <th className="px-4 py-2.5 font-medium text-center">Total</th>
                      <th className="px-4 py-2.5 font-medium text-center">DC</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data_sources.cross_check.map((s) => {
                      const statusLabel =
                        s.status === "ok"
                          ? "✅ Dado oficial"
                          : s.status === "partial"
                          ? "⚠️ Parcial"
                          : "❌ Indisponível";
                      const statusColor =
                        s.status === "ok"
                          ? "text-[#4CAF50]"
                          : s.status === "partial"
                          ? "text-[#FFC107]"
                          : "text-[#8B949E]";
                      return (
                        <tr key={s.source} className="border-t border-[#21262D] hover:bg-[#0D1117]">
                          <td className="px-4 py-3 text-[#C9D1D9]">{s.source}</td>
                          <td className="px-4 py-3 text-center text-[#C9D1D9]">
                            {s.total ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-center text-[#C9D1D9]">
                            {s.dc ?? "—"}
                          </td>
                          <td className={`px-4 py-3 text-xs ${statusColor}`}>{statusLabel}</td>
                          <td className="px-4 py-3 text-xs text-[#8B949E]">{s.details}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-[#30363D] bg-[#0D1117]">
                      <td className="px-4 py-3 font-semibold text-[#C9A84C]">MELHOR DADO</td>
                      <td className="px-4 py-3 text-center font-bold text-white">
                        {result.data_sources.best_total.value}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-white">
                        {result.data_sources.best_dc.value}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#C9A84C]" colSpan={2}>
                        Fonte total: {result.data_sources.best_total.source}
                        {" · "}Fonte DC: {result.data_sources.best_dc.source}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Adicionar Observação (zero custo) */}
          <div className="rounded-xl border border-[#A06CD5]/30 bg-[#A06CD5]/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[#B98AE0]">
                  ➕ Adicionar Observação
                </h3>
                <p className="mt-1 text-xs text-[#8B949E]">
                  Recalcula apenas a variável de Observações (custo zero — sem chamadas de API).
                </p>
              </div>
              {!obsDraftOpen && (
                <button
                  type="button"
                  onClick={() => setObsDraftOpen(true)}
                  className="rounded-lg border border-[#A06CD5] bg-transparent px-4 py-1.5 text-sm font-semibold text-[#B98AE0] transition-colors hover:bg-[#A06CD5]/10"
                >
                  Adicionar
                </button>
              )}
            </div>
            {obsDraftOpen && (
              <div className="mt-3 space-y-3">
                <textarea
                  value={extraObservation}
                  onChange={(e) => setExtraObservation(e.target.value)}
                  placeholder="Ex: terreno tem transformador trifásico dedicado, esquina movimentada, câmeras 24h..."
                  rows={3}
                  className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-sm text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#A06CD5]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={applyObservation}
                    disabled={!extraObservation.trim()}
                    className="rounded-lg bg-[#A06CD5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#8B5DBF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Aplicar e Recalcular
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExtraObservation("");
                      setObsDraftOpen(false);
                    }}
                    className="rounded-lg border border-[#30363D] bg-transparent px-4 py-2 text-sm text-[#8B949E] hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Strengths + Weaknesses */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 p-5">
              <h3 className="mb-3 text-base font-semibold text-[#C9A84C]">✓ Pontos Fortes</h3>
              <ul className="space-y-2">
                {result.strengths.length === 0 && (
                  <li className="text-sm text-[#8B949E]">Nenhum ponto forte gerado.</li>
                )}
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#C9D1D9]">
                    <span className="mt-1 text-[#C9A84C]">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-[#FFC107]/30 bg-[#FFC107]/5 p-5">
              <h3 className="mb-3 text-base font-semibold text-[#FFC107]">⚠ Pontos de Atenção</h3>
              <ul className="space-y-2">
                {result.weaknesses.length === 0 && (
                  <li className="text-sm text-[#8B949E]">Nenhum ponto de atenção gerado.</li>
                )}
                {result.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#C9D1D9]">
                    <span className="mt-1 text-[#FFC107]">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommendation */}
          {result.recommendation && (
            <div className="rounded-xl border border-[#2196F3]/30 bg-[#2196F3]/5 p-5">
              <h3 className="mb-3 text-base font-semibold text-[#2196F3]">Recomendação</h3>
              <p className="text-sm leading-relaxed text-[#C9D1D9]">{result.recommendation}</p>
            </div>
          )}

          {/* Cost Card */}
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
            <h3 className="mb-3 text-base font-semibold text-white">💰 Custo desta análise</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-[#2196F3]/20 bg-[#2196F3]/5 p-3">
                <p className="text-xs text-[#5BB3F0]">Google Places</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {result.cost_breakdown.googleQueries} queries
                </p>
                <p className="text-xs text-[#8B949E]">
                  US$ {result.cost_breakdown.googleCostUsd.toFixed(4)}
                </p>
              </div>
              <div className="rounded-lg border border-[#A06CD5]/20 bg-[#A06CD5]/5 p-3">
                <p className="text-xs text-[#B98AE0]">Claude (texto)</p>
                <p className="mt-1 text-lg font-bold text-white">
                  {(result.cost_breakdown.claudeTokensIn + result.cost_breakdown.claudeTokensOut).toLocaleString("pt-BR")} tokens
                </p>
                <p className="text-xs text-[#8B949E]">
                  in {result.cost_breakdown.claudeTokensIn} / out {result.cost_breakdown.claudeTokensOut} · US$ {result.cost_breakdown.claudeCostUsd.toFixed(4)}
                </p>
              </div>
              <div className="rounded-lg border border-[#C9A84C]/20 bg-[#C9A84C]/5 p-3">
                <p className="text-xs text-[#C9A84C]">Total</p>
                <p className="mt-1 text-lg font-bold text-white">
                  US$ {result.cost_breakdown.totalCostUsd.toFixed(4)}
                </p>
                <p className="text-xs text-[#8B949E]">
                  ≈ R$ {(result.cost_breakdown.totalCostUsd * 5).toFixed(3)}
                </p>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!scoreId) {
                  alert("Aguarde — salvando no histórico...");
                  return;
                }
                window.open(`/score-print/${scoreId}`, "_blank");
              }}
              disabled={!scoreId}
              className="rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar PDF
            </button>

            <button
              type="button"
              onClick={() => {
                const html = buildScoreHtml(result);
                const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const safeCity = result.city.replace(/[^a-zA-Z0-9]/g, "_");
                a.href = url;
                a.download = `score-ponto-${safeCity}-${Date.now()}.html`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
            >
              Exportar HTML
            </button>

            <button
              type="button"
              onClick={() => {
                setResult(null);
                setScoreId(null);
              }}
              className="rounded-lg border border-[#C9A84C] bg-transparent px-6 py-3 font-semibold text-[#C9A84C] transition-colors hover:bg-[#C9A84C]/10"
            >
              Nova Análise
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
