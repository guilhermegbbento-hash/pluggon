"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { buildScoreHtml } from "@/lib/score-html-export";

// ---------- Types ----------

interface VariableData {
  name: string;
  category: string;
  score: number;
  weight: string;
  justification: string;
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

interface ScoreResult {
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  overall_score: number;
  classification: string;
  variables: VariableData[];
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
    fleet_total: number | null;
  };
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
  { label: string; color: string; min: number }
> = {
  PREMIUM: { label: "Premium", color: "#C9A84C", min: 85 },
  ESTRATEGICO: { label: "Estratégico", color: "#2196F3", min: 70 },
  VIAVEL: { label: "Viável", color: "#FFC107", min: 55 },
  MARGINAL: { label: "Marginal", color: "#FF9800", min: 40 },
  REJEITADO: { label: "Rejeitado", color: "#F44336", min: 0 },
};

const VARIABLE_LABELS: Record<string, string> = {
  // 1. Demanda e Mobilidade (15)
  volume_veiculos_dia: "Volume Veículos/Dia",
  fluxo_motoristas_app: "Fluxo Motoristas App",
  proximidade_corredores: "Proximidade Corredores Principais",
  fluxo_pico_manha: "Fluxo Pico Manhã",
  fluxo_pico_noite: "Fluxo Pico Noite",
  fluxo_noturno: "Fluxo Noturno",
  fluxo_fim_semana: "Fluxo Fim de Semana",
  padrao_trafego: "Padrão de Tráfego",
  proximidade_rodovias: "Proximidade Rodovias",
  distancia_centro: "Distância ao Centro",
  pontos_taxi_uber: "Pontos Taxi/Uber Próximos",
  proximidade_terminal_onibus: "Proximidade Terminal Ônibus",
  proximidade_aeroporto: "Proximidade Aeroporto",
  proximidade_rodoviaria: "Proximidade Rodoviária",
  veiculos_por_habitante: "Veículos por Habitante",
  // 2. Frota de EVs (10)
  total_evs_cidade: "Total EVs na Cidade",
  crescimento_frota_12m: "Crescimento Frota 12 Meses",
  evs_por_carregador_rapido: "EVs por Carregador Rápido",
  vendas_mensais_evs: "Vendas Mensais EVs",
  concessionarias_ev: "Concessionárias EV",
  market_share_evs: "Market Share EVs",
  projecao_frota_5anos: "Projeção Frota 5 Anos",
  frotas_corporativas_ev: "Frotas Corporativas Elétricas",
  locadoras_com_evs: "Locadoras com EVs",
  densidade_evs_km2: "Densidade EVs/km²",
  // 3. Concorrência e Saturação (10)
  total_carregadores_cidade: "Total Carregadores Cidade",
  carregadores_dc_rapidos: "Carregadores DC Rápidos",
  carregadores_ac: "Carregadores AC",
  carregadores_raio_2km: "Carregadores Raio 2km",
  carregadores_raio_5km: "Carregadores Raio 5km",
  tipo_concorrentes: "Tipo Concorrentes Próximos",
  preco_medio_kwh: "Preço Médio kWh",
  disponibilidade_concorrentes: "Disponibilidade Concorrentes",
  operadores_cidade: "Operadores na Cidade",
  saturacao_mercado: "Saturação de Mercado",
  // 4. Infraestrutura do Local (10)
  rede_eletrica: "Rede Elétrica",
  custo_conexao: "Custo Conexão",
  acessibilidade_entrada_saida: "Acessibilidade Entrada/Saída",
  espaco_fisico: "Espaço Físico",
  seguranca_local: "Segurança Local",
  iluminacao: "Iluminação",
  acessibilidade_pne: "Acessibilidade PNE",
  operacao_24h: "Operação 24h",
  cobertura_chuva: "Cobertura contra Chuva",
  distancia_quadro_eletrico: "Distância Quadro Elétrico",
  // 5. Amenidades e Conveniência (10)
  tempo_permanencia: "Tempo de Permanência",
  conveniencia: "Conveniência",
  visibilidade: "Visibilidade",
  tipo_estabelecimento_score: "Tipo de Estabelecimento",
  servicos_raio_200m: "Serviços Raio 200m",
  restaurantes_raio_300m: "Restaurantes Raio 300m",
  farmacias_24h_raio_500m: "Farmácias 24h Raio 500m",
  wifi_disponivel: "Wi-Fi Disponível",
  estacionamento_vigilancia: "Estacionamento com Vigilância",
  loja_conveniencia: "Loja de Conveniência",
  // 6. Demografia e Economia (10)
  populacao: "População",
  pib_per_capita: "PIB Per Capita",
  pib_total: "PIB Total",
  idhm: "IDHM",
  renda_media_bairro: "Renda Média do Bairro",
  perfil_socioeconomico: "Perfil Socioeconômico",
  densidade_populacional: "Densidade Populacional",
  crescimento_populacional: "Crescimento Populacional",
  frota_total_veiculos: "Frota Total Veículos",
  veiculos_por_hab: "Veículos por Habitante",
  // 7. Potencial Comercial (10)
  potencial_parceria: "Potencial de Parceria",
  diferencial_competitivo: "Diferencial Competitivo",
  receitas_complementares: "Receitas Complementares",
  potencial_b2b_frotas: "Potencial B2B/Frotas",
  potencial_clube_assinatura: "Potencial Clube Assinatura",
  alinhamento_pluggon: "Alinhamento Pluggon",
  custo_aluguel_regiao: "Custo Aluguel Região",
  potencial_expansao: "Potencial Expansão",
  incentivos_governamentais: "Incentivos Governamentais",
  tarifa_energia: "Tarifa de Energia",
  // 8. Exclusivas Brasil (5)
  usina_solar_gd: "Usina Solar GD",
  custo_energia_solar_gd: "Custo Energia Solar GD",
  postos_gnv_proximos: "Postos GNV Próximos",
  polos_universitarios: "Polos Universitários",
  corredor_eletrovias: "Corredor Eletrovias",
};

const CATEGORY_ICONS: Record<string, string> = {
  "Demanda e Mobilidade": "🚗",
  "Frota de EVs": "⚡",
  "Concorrência e Saturação": "🏁",
  "Infraestrutura do Local": "🔌",
  "Amenidades e Conveniência": "🏪",
  "Demografia e Economia": "👥",
  "Potencial Comercial": "💰",
  "Exclusivas Brasil": "🇧🇷",
};

const LOADING_STEPS = [
  "Geocodificando endereço...",
  "Buscando POIs no entorno...",
  "Identificando carregadores concorrentes...",
  "Consultando dados do IBGE...",
  "Analisando 80 variáveis com IA...",
  "Calculando score final...",
];

const POI_COLORS: Record<string, string> = {
  restaurante: "#FF6B6B",
  farmacia: "#4ECDC4",
  posto: "#FFE66D",
  shopping: "#A06CD5",
  hospital: "#FF8A5C",
  carregador_ev: "#F44336",
};

// ---------- Helpers ----------

function getClassificationColor(classification: string): string {
  return CLASSIFICATION_CONFIG[classification]?.color || "#8B949E";
}

function getScoreColor(score: number): string {
  if (score >= 8.5) return "#C9A84C";
  if (score >= 7) return "#2196F3";
  if (score >= 5.5) return "#FFC107";
  if (score >= 4) return "#FF9800";
  return "#F44336";
}

// ---------- Animated Gauge Component ----------

function ScoreGauge({
  score,
  classification,
}: {
  score: number;
  classification: string;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const color = getClassificationColor(classification);
  const classLabel = CLASSIFICATION_CONFIG[classification]?.label || classification;

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
          <circle
            cx="110"
            cy="110"
            r="90"
            fill="none"
            stroke="#21262D"
            strokeWidth="12"
          />
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

// ---------- Mini Map Component ----------

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

    // 500m radius circle
    L.circle([lat, lng], {
      radius: 500,
      color: "#C9A84C",
      fillColor: "#C9A84C",
      fillOpacity: 0.05,
      weight: 1,
      dashArray: "5,5",
    }).addTo(map);

    // Main point marker
    const mainIcon = L.divIcon({
      html: `<div style="width:20px;height:20px;background:#C9A84C;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,217,126,0.5);"></div>`,
      iconSize: [20, 20] as unknown as Record<string, unknown>,
      iconAnchor: [10, 10] as unknown as Record<string, unknown>,
      className: "",
    });
    L.marker([lat, lng], { icon: mainIcon } as Record<string, unknown>)
      .addTo(map)
      .bindPopup("<b>Ponto analisado</b>");

    // POIs
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

    // Chargers (red)
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

// ---------- Variable Bar Component ----------

const WEIGHT_CONFIG: Record<string, { label: string; color: string }> = {
  alto: { label: "x3", color: "#F44336" },
  medio: { label: "x2", color: "#FFC107" },
  baixo: { label: "x1", color: "#8B949E" },
};

function VariableBar({ variable }: { variable: VariableData }) {
  const label = VARIABLE_LABELS[variable.name] || variable.name;
  const color = getScoreColor(variable.score);
  const pct = (variable.score / 10) * 100;
  const weightKey = variable.weight?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "medio";
  const weightCfg = WEIGHT_CONFIG[weightKey] || WEIGHT_CONFIG.medio;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#C9D1D9]">{label}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: weightCfg.color + "20", color: weightCfg.color }}
          >
            {weightCfg.label}
          </span>
        </div>
        <span className="text-sm font-semibold" style={{ color }}>
          {variable.score.toFixed(1)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#21262D]">
        <div
          className="h-2 rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-xs text-[#8B949E]">{variable.justification}</p>
    </div>
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
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [scoreId, setScoreId] = useState<number | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load Leaflet
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

  // Loading step animation
  useEffect(() => {
    if (loading) {
      setLoadingStep(0);
      intervalRef.current = setInterval(() => {
        setLoadingStep((prev) =>
          prev < LOADING_STEPS.length - 1 ? prev + 1 : prev
        );
      }, 3000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/score-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address.trim(),
          establishment_type: establishmentType || "outro",
          establishment_name: establishmentName.trim(),
        }),
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

  // Group variables by category
  const variablesByCategory: Record<string, VariableData[]> = {};
  if (result?.variables) {
    for (const v of result.variables) {
      if (!variablesByCategory[v.category]) variablesByCategory[v.category] = [];
      variablesByCategory[v.category].push(v);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Score do Ponto</h1>
      <p className="mt-1 text-[#8B949E]">
        Avalie a qualidade de um ponto específico para instalação de eletroposto.
      </p>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 rounded-xl border border-[#30363D] bg-[#161B22] p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-[#C9D1D9]">
              Endereço completo *
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ex: Av. Paulista, 1000, São Paulo, SP"
              className="w-full rounded-lg border border-[#30363D] bg-[#0D1117] px-4 py-3 text-white placeholder-[#484F58] outline-none transition-colors focus:border-[#C9A84C]"
              disabled={loading}
              required
            />
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
              Nome do estabelecimento{" "}
              <span className="text-[#484F58]">(opcional)</span>
            </label>
            <input
              type="text"
              value={establishmentName}
              onChange={(e) => setEstablishmentName(e.target.value)}
              placeholder="Ex: Posto Shell Av. Paulista"
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
          disabled={loading || !address.trim() || !establishmentType}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0D1117] border-t-transparent" />
              Analisando...
            </>
          ) : (
            <>
              <svg
                width="20"
                height="20"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Analisar Ponto
            </>
          )}
        </button>

        {loading && (
          <div className="mt-4 space-y-2">
            {LOADING_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {i < loadingStep ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="#C9A84C"
                  >
                    <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
                  </svg>
                ) : i === loadingStep ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C9A84C] border-t-transparent" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-[#30363D]" />
                )}
                <span
                  className={
                    i <= loadingStep ? "text-[#C9D1D9]" : "text-[#484F58]"
                  }
                >
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
          {/* Top: Gauge + Map + Info */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Gauge */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#30363D] bg-[#161B22] p-6">
              <ScoreGauge
                score={result.overall_score}
                classification={result.classification}
              />
              <div className="mt-4 text-center">
                <p className="text-sm text-[#8B949E]">{result.address}</p>
                <p className="mt-1 text-xs text-[#484F58]">
                  {result.city} - {result.state} · {result.lat.toFixed(5)},{" "}
                  {result.lng.toFixed(5)}
                </p>
              </div>
            </div>

            {/* Mini Map */}
            <div className="overflow-hidden rounded-xl border border-[#30363D] bg-[#161B22] lg:col-span-2">
              <div className="flex items-center justify-between border-b border-[#30363D] px-4 py-3">
                <h3 className="text-sm font-semibold text-white">
                  Mapa do Entorno (500m)
                </h3>
                <div className="flex items-center gap-3 text-xs text-[#8B949E]">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "#C9A84C" }}
                    />
                    Ponto
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "#F44336" }}
                    />
                    Carregadores
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "#4ECDC4" }}
                    />
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">POIs no Entorno</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {result.nearby_pois.length}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">Carregadores Próximos</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {result.nearby_chargers.length}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">População</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {result.ibge_data.population?.toLocaleString("pt-BR") ?? "N/D"}
              </p>
            </div>
            <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-4">
              <p className="text-xs text-[#8B949E]">PIB per Capita</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {result.ibge_data.gdp_per_capita
                  ? `R$ ${Math.round(result.ibge_data.gdp_per_capita).toLocaleString("pt-BR")}`
                  : "N/D"}
              </p>
            </div>
          </div>

          {/* Variables by Category */}
          <div className="grid gap-6 md:grid-cols-2">
            {Object.entries(variablesByCategory).map(([category, vars]) => (
              <div
                key={category}
                className="rounded-xl border border-[#30363D] bg-[#161B22] p-5"
              >
                <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
                  <span>{CATEGORY_ICONS[category] || "📊"}</span>
                  {category}
                </h3>
                <div className="space-y-4">
                  {vars.map((v) => (
                    <VariableBar key={v.name} variable={v} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Strengths + Weaknesses + Recommendation */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Strengths */}
            <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#C9A84C]">
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="#C9A84C"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Pontos Fortes
              </h3>
              <ul className="space-y-2">
                {result.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-[#C9D1D9]"
                  >
                    <span className="mt-1 text-[#C9A84C]">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Weaknesses */}
            <div className="rounded-xl border border-[#FFC107]/30 bg-[#FFC107]/5 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#FFC107]">
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="#FFC107"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Pontos de Atenção
              </h3>
              <ul className="space-y-2">
                {result.weaknesses.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-[#C9D1D9]"
                  >
                    <span className="mt-1 text-[#FFC107]">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommendation */}
          <div className="rounded-xl border border-[#2196F3]/30 bg-[#2196F3]/5 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#2196F3]">
              <svg
                width="20"
                height="20"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#2196F3"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              Recomendação
            </h3>
            <p className="text-sm leading-relaxed text-[#C9D1D9]">
              {result.recommendation}
            </p>
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
              className="flex items-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
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
              className="flex items-center gap-2 rounded-lg bg-[#C9A84C] px-6 py-3 font-semibold text-[#0D1117] transition-colors hover:bg-[#B89443]"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar HTML
            </button>

            <a
              href={`/dashboard/business-plan?lat=${result.lat}&lng=${result.lng}&address=${encodeURIComponent(result.address)}&city=${encodeURIComponent(result.city)}&state=${encodeURIComponent(result.state)}&score=${result.overall_score}&classification=${result.classification}&establishment_type=${result.establishment_type}&establishment_name=${encodeURIComponent(result.establishment_name)}`}
              className="flex items-center gap-2 rounded-lg border border-[#C9A84C] bg-transparent px-6 py-3 font-semibold text-[#C9A84C] transition-colors hover:bg-[#C9A84C]/10"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Gerar Business Plan
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
