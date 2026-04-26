"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ---------- Types ----------

type ScoreSource = "ABVE" | "Google Places" | "IBGE" | "Cálculo" | "Usuário";

interface VariableData {
  id?: number;
  name: string;
  category: string;
  score: number;
  weight: number | string;
  justification: string;
  source?: ScoreSource;
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

interface ScoreData {
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  overall_score: number;
  classification: string;
  variables?: VariableData[];
  scoring_variables?: VariableData[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  nearby_pois: NearbyPlace[];
  nearby_chargers: NearbyPlace[];
  ibge_data: {
    population: number | null;
    gdp_total: number | null;
    gdp_per_capita: number | null;
    idhm?: number | null;
    fleet_total?: number | null;
  };
  cost_breakdown?: {
    googleQueries: number;
    googleCostUsd: number;
    claudeTokensIn: number;
    claudeTokensOut: number;
    claudeCostUsd: number;
    totalCostUsd: number;
  };
}

// ---------- Constants ----------

const CLASSIFICATION_LABEL: Record<string, string> = {
  PREMIUM: "Premium",
  ESTRATEGICO: "Estratégico",
  VIAVEL: "Viável",
  MARGINAL: "Marginal",
  REJEITADO: "Rejeitado",
};

const CLASSIFICATION_COLOR: Record<string, string> = {
  PREMIUM: "#C9A84C",
  ESTRATEGICO: "#2196F3",
  VIAVEL: "#FFC107",
  MARGINAL: "#FF9800",
  REJEITADO: "#F44336",
};

const CATEGORY_ICONS: Record<string, string> = {
  CIDADE: "🏙️",
  CONCORRENCIA: "🏁",
  ENTORNO: "🏪",
  LOCALIZACAO: "📍",
  TIPO: "🏢",
  OBSERVACOES: "📝",
};

const CATEGORY_LABELS: Record<string, string> = {
  CIDADE: "Cidade",
  CONCORRENCIA: "Concorrência",
  ENTORNO: "Entorno",
  LOCALIZACAO: "Localização",
  TIPO: "Tipo de Estabelecimento",
  OBSERVACOES: "Observações",
};

const VARIABLE_LABELS: Record<string, string> = {
  volume_veiculos_dia: "Volume Veículos/Dia",
  fluxo_motoristas_app: "Fluxo Motoristas App",
  proximidade_corredores: "Proximidade Corredores",
  fluxo_pico_manha: "Fluxo Pico Manhã",
  fluxo_pico_noite: "Fluxo Pico Noite",
  fluxo_noturno: "Fluxo Noturno",
  fluxo_fim_semana: "Fluxo Fim de Semana",
  padrao_trafego: "Padrão de Tráfego",
  proximidade_rodovias: "Proximidade Rodovias",
  distancia_centro: "Distância ao Centro",
  pontos_taxi_uber: "Pontos Taxi/Uber",
  proximidade_terminal_onibus: "Proximidade Terminal Ônibus",
  proximidade_aeroporto: "Proximidade Aeroporto",
  proximidade_rodoviaria: "Proximidade Rodoviária",
  veiculos_por_habitante: "Veículos por Habitante",
  total_evs_cidade: "Total EVs na Cidade",
  crescimento_frota_12m: "Crescimento Frota 12M",
  evs_por_carregador_rapido: "EVs por Carregador Rápido",
  vendas_mensais_evs: "Vendas Mensais EVs",
  concessionarias_ev: "Concessionárias EV",
  market_share_evs: "Market Share EVs",
  projecao_frota_5anos: "Projeção Frota 5 Anos",
  frotas_corporativas_ev: "Frotas Corporativas EV",
  locadoras_com_evs: "Locadoras com EVs",
  densidade_evs_km2: "Densidade EVs/km²",
  total_carregadores_cidade: "Total Carregadores Cidade",
  carregadores_dc_rapidos: "Carregadores DC Rápidos",
  carregadores_ac: "Carregadores AC",
  carregadores_raio_2km: "Carregadores Raio 2km",
  carregadores_raio_5km: "Carregadores Raio 5km",
  tipo_concorrentes: "Tipo Concorrentes",
  preco_medio_kwh: "Preço Médio kWh",
  disponibilidade_concorrentes: "Disponibilidade Concorrentes",
  operadores_cidade: "Operadores na Cidade",
  saturacao_mercado: "Saturação de Mercado",
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
  tempo_permanencia: "Tempo de Permanência",
  conveniencia: "Conveniência",
  visibilidade: "Visibilidade",
  tipo_estabelecimento_score: "Tipo de Estabelecimento",
  servicos_raio_200m: "Serviços Raio 200m",
  restaurantes_raio_300m: "Restaurantes Raio 300m",
  farmacias_24h_raio_500m: "Farmácias 24h Raio 500m",
  wifi_disponivel: "Wi-Fi Disponível",
  estacionamento_vigilancia: "Estacionamento Vigiado",
  loja_conveniencia: "Loja de Conveniência",
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
  usina_solar_gd: "Usina Solar GD",
  custo_energia_solar_gd: "Custo Energia Solar GD",
  postos_gnv_proximos: "Postos GNV Próximos",
  polos_universitarios: "Polos Universitários",
  corredor_eletrovias: "Corredor Eletrovias",
};

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
  const ready = useRef(false);

  useEffect(() => {
    if (!mapRef.current || ready.current) return;

    function init() {
      const L = (window as unknown as { L?: Record<string, unknown> }).L as unknown as {
        map: (el: HTMLElement, opts: Record<string, unknown>) => {
          setView: (c: [number, number], z: number) => unknown;
        };
        tileLayer: (url: string, opts: Record<string, unknown>) => {
          addTo: (m: unknown) => unknown;
        };
        circle: (c: [number, number], opts: Record<string, unknown>) => {
          addTo: (m: unknown) => unknown;
        };
        circleMarker: (c: [number, number], opts: Record<string, unknown>) => {
          addTo: (m: unknown) => { bindPopup: (s: string) => unknown };
        };
        marker: (c: [number, number], opts?: Record<string, unknown>) => {
          addTo: (m: unknown) => { bindPopup: (s: string) => unknown };
        };
        divIcon: (opts: Record<string, unknown>) => unknown;
      } | undefined;

      if (!L || !mapRef.current) return;
      ready.current = true;

      const map = L.map(mapRef.current, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      L.circle([lat, lng], {
        radius: 500,
        color: "#C9A84C",
        fillColor: "#C9A84C",
        fillOpacity: 0.08,
        weight: 1.5,
      }).addTo(map);

      const mainIcon = L.divIcon({
        html: '<div style="width:18px;height:18px;background:#C9A84C;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        className: "",
      });
      L.marker([lat, lng], { icon: mainIcon }).addTo(map).bindPopup("<b>Ponto analisado</b>");

      pois.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 4,
          fillColor: "#4ECDC4",
          color: "#4ECDC4",
          weight: 1,
          fillOpacity: 0.8,
        }).addTo(map);
      });

      chargers.forEach((c) => {
        const ico = L.divIcon({
          html: '<div style="width:12px;height:12px;background:#F44336;border:2px solid white;border-radius:50%;"></div>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          className: "",
        });
        L.marker([c.lat, c.lng], { icon: ico }).addTo(map);
      });
    }

    if ((window as unknown as { L?: unknown }).L) {
      init();
      return;
    }
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css";
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = init;
    document.head.appendChild(js);
  }, [lat, lng, pois, chargers]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}

// ---------- Page ----------

export default function ScorePrintPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<ScoreData | null>(null);
  const [error, setError] = useState("");
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: row, error: err } = await supabase
        .from("point_scores")
        .select("full_json")
        .eq("id", id)
        .single();
      if (err || !row) {
        setError("Score não encontrado.");
        return;
      }
      const full = (row as { full_json: ScoreData | null }).full_json;
      if (!full) {
        setError("Dados do relatório indisponíveis.");
        return;
      }
      setData(full);
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!data || printed) return;
    const t = setTimeout(() => {
      setPrinted(true);
      window.print();
    }, 1200);
    return () => clearTimeout(t);
  }, [data, printed]);

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: "Georgia, serif" }}>
        <p style={{ color: "red" }}>{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 40, fontFamily: "Georgia, serif", textAlign: "center" }}>
        <p>Carregando relatório...</p>
      </div>
    );
  }

  const color = CLASSIFICATION_COLOR[data.classification] || "#8B949E";
  const classLabel = CLASSIFICATION_LABEL[data.classification] || data.classification;
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // group variables (prefer scoring_variables, fallback to legacy variables)
  const allVars: VariableData[] = data.scoring_variables || data.variables || [];
  const byCategory: Record<string, VariableData[]> = {};
  for (const v of allVars) {
    if (!byCategory[v.category]) byCategory[v.category] = [];
    byCategory[v.category].push(v);
  }

  // Gauge SVG
  const pct = Math.max(0, Math.min(100, data.overall_score));
  const circumference = 2 * Math.PI * 90;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <>
      <style jsx global>{`
        body {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 12px;
          line-height: 1.6;
          color: #2c2c2c;
          background: white;
          margin: 0;
          padding: 0;
        }

        /* Cover */
        .page-capa {
          height: 100vh;
          background: #0A0A0A;
          color: white;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          padding: 40px;
          page-break-after: always;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-label {
          font-size: 14px;
          letter-spacing: 8px;
          color: #C9A84C;
          text-transform: uppercase;
        }
        .capa-line {
          width: 80px;
          height: 2px;
          background: #C9A84C;
          margin: 30px auto;
        }
        .capa-address {
          font-size: 24px;
          font-weight: 800;
          color: white;
          max-width: 600px;
          margin-bottom: 8px;
        }
        .capa-city { font-size: 14px; color: #999; margin-bottom: 40px; }
        .capa-score {
          font-size: 140px;
          font-weight: 800;
          color: ${color};
          line-height: 1;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-score small { font-size: 32px; color: #666; font-weight: 400; }
        .capa-class {
          display: inline-block;
          padding: 10px 28px;
          border: 1px solid ${color};
          color: ${color};
          font-size: 18px;
          font-weight: 600;
          margin-top: 16px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-footer {
          position: absolute;
          bottom: 40px;
          font-size: 10px;
          color: #666;
          letter-spacing: 2px;
        }

        /* Content page */
        .page {
          padding: 15mm 20mm;
          page-break-after: always;
        }
        .page:last-child { page-break-after: auto; }

        h2 {
          font-size: 22px;
          color: #C9A84C;
          border-bottom: 3px solid #C9A84C;
          padding-bottom: 8px;
          margin: 0 0 16px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        h3.cat-title {
          font-size: 15px;
          color: #1a1a1a;
          margin: 18px 0 10px;
          font-weight: 700;
        }

        /* Gauge + map row */
        .gauge-map {
          display: flex;
          gap: 20px;
          align-items: stretch;
          margin-top: 20px;
        }
        .gauge-box {
          flex: 0 0 280px;
          border: 1px solid #e0e0e0;
          padding: 20px;
          border-radius: 8px;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }
        .gauge-svg { width: 220px; height: 220px; }
        .gauge-num {
          font-size: 48px;
          font-weight: 800;
          color: ${color};
          line-height: 1;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .gauge-of { color: #888; font-size: 12px; }
        .class-badge {
          display: inline-block;
          padding: 6px 16px;
          border-radius: 999px;
          background: ${color}22;
          color: ${color};
          font-weight: 600;
          font-size: 13px;
          margin-top: 12px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .map-box {
          flex: 1;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
          min-height: 320px;
        }

        /* Variables table */
        .var-table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0 16px;
          font-size: 11px;
        }
        .var-table th {
          background: #C9A84C !important;
          color: white !important;
          text-align: left;
          padding: 6px 8px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .var-table td {
          border-bottom: 1px solid #eee;
          padding: 6px 8px;
          vertical-align: top;
        }
        .var-table .col-name { width: 28%; font-weight: 600; color: #1a1a1a; }
        .var-table .col-score { width: 10%; font-weight: 700; text-align: center; }
        .var-table .col-bar { width: 18%; }
        .var-table .col-just { width: 44%; color: #555; font-size: 10px; }
        .bar-outer {
          height: 6px;
          background: #eee;
          border-radius: 3px;
          overflow: hidden;
        }
        .bar-inner {
          height: 100%;
          border-radius: 3px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* Highlights */
        .highlights { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
        .box-strength, .box-weakness, .box-reco {
          border-radius: 8px;
          padding: 14px 18px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .box-strength {
          background: #e8f5e9 !important;
          border: 1px solid #2ea043;
        }
        .box-strength h3 { color: #1b5e20; margin: 0 0 8px; font-size: 14px; }
        .box-strength li { color: #1b5e20; }
        .box-weakness {
          background: #fff8e1 !important;
          border: 1px solid #FFC107;
        }
        .box-weakness h3 { color: #b28704; margin: 0 0 8px; font-size: 14px; }
        .box-weakness li { color: #5d4500; }
        .box-reco {
          background: #e3f2fd !important;
          border: 1px solid #2196F3;
          margin-top: 16px;
        }
        .box-reco h3 { color: #0d47a1; margin: 0 0 8px; font-size: 14px; }
        .box-reco p { color: #0d47a1; margin: 0; font-size: 12px; line-height: 1.7; }
        ul { padding-left: 18px; margin: 6px 0; }
        li { font-size: 11px; line-height: 1.6; margin-bottom: 4px; }

        .bp-footer {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: #bbb;
          border-top: 1px solid #e0e0e0;
          padding-top: 8px;
          margin-top: 24px;
        }

        /* Screen preview */
        @media screen {
          body { background: #e8e8e8; padding: 20px; }
          .doc {
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          }
          .no-print {
            display: flex;
            justify-content: center;
            gap: 12px;
            padding: 20px;
            position: sticky;
            top: 0;
            background: #e8e8e8;
            z-index: 10;
          }
          .no-print button {
            padding: 12px 28px;
            font-size: 14px;
            font-weight: 600;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          }
          .btn-print { background: #C9A84C; color: #0D1117; }
          .btn-back { background: #30363D; color: white; }
        }

        @media print {
          @page { size: A4; margin: 0; }
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
        }

        h2, h3 { page-break-after: avoid; }
        .var-table { page-break-inside: avoid; }
        .box-strength, .box-weakness, .box-reco { page-break-inside: avoid; }
      `}</style>

      <div className="no-print">
        <button className="btn-print" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </button>
        <button className="btn-back" onClick={() => window.close()}>
          Fechar
        </button>
      </div>

      <div className="doc">
        {/* ===== CAPA ===== */}
        <div className="page-capa">
          <div className="capa-label">Relatório de Análise de Ponto</div>
          <div className="capa-line" />
          <div className="capa-address">{data.address}</div>
          <div className="capa-city">
            {data.city} - {data.state}
            {data.establishment_name ? ` · ${data.establishment_name}` : ""}
          </div>
          <div className="capa-score">
            {Math.round(data.overall_score)}
            <small>/100</small>
          </div>
          <div className="capa-class">{classLabel}</div>
          <div className="capa-footer">PLUGGON by BLEV Educação</div>
        </div>

        {/* ===== PAGE 2: Gauge + Map ===== */}
        <div className="page">
          <h2>Resumo Executivo</h2>
          <div className="gauge-map">
            <div className="gauge-box">
              <svg className="gauge-svg" viewBox="0 0 220 220">
                <circle cx="110" cy="110" r="90" fill="none" stroke="#eee" strokeWidth="14" />
                <circle
                  cx="110"
                  cy="110"
                  r="90"
                  fill="none"
                  stroke={color}
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  transform="rotate(-90 110 110)"
                />
                <text
                  x="110"
                  y="115"
                  textAnchor="middle"
                  fontSize="52"
                  fontWeight="800"
                  fill={color}
                >
                  {Math.round(data.overall_score)}
                </text>
                <text
                  x="110"
                  y="140"
                  textAnchor="middle"
                  fontSize="12"
                  fill="#888"
                >
                  de 100
                </text>
              </svg>
              <div className="class-badge">{classLabel}</div>
              <div style={{ marginTop: 14, fontSize: 11, color: "#888" }}>
                {data.lat.toFixed(5)}, {data.lng.toFixed(5)}
              </div>
            </div>
            <div className="map-box">
              <MiniMap
                lat={data.lat}
                lng={data.lng}
                pois={data.nearby_pois || []}
                chargers={data.nearby_chargers || []}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 20 }}>
            <div style={{ border: "1px solid #e0e0e0", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#888" }}>POIs no Entorno</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a1a" }}>
                {(data.nearby_pois || []).length}
              </div>
            </div>
            <div style={{ border: "1px solid #e0e0e0", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#888" }}>Carregadores</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a1a" }}>
                {(data.nearby_chargers || []).length}
              </div>
            </div>
            <div style={{ border: "1px solid #e0e0e0", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#888" }}>População</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a1a" }}>
                {data.ibge_data?.population?.toLocaleString("pt-BR") ?? "N/D"}
              </div>
            </div>
            <div style={{ border: "1px solid #e0e0e0", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#888" }}>PIB per Capita</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1a1a1a" }}>
                {data.ibge_data?.gdp_per_capita
                  ? `R$ ${Math.round(data.ibge_data.gdp_per_capita).toLocaleString("pt-BR")}`
                  : "N/D"}
              </div>
            </div>
          </div>

          <div className="bp-footer">
            <span>PLUGGON by BLEV Educação</span>
            <span>Gerado em {today}</span>
          </div>
        </div>

        {/* ===== CATEGORIES ===== */}
        {Object.entries(byCategory).map(([cat, vars]) => (
          <div className="page" key={cat}>
            <h2>
              {CATEGORY_ICONS[cat] || "📊"} {CATEGORY_LABELS[cat] || cat}
            </h2>
            <table className="var-table">
              <thead>
                <tr>
                  <th className="col-name">Variável</th>
                  <th className="col-score">Nota</th>
                  <th className="col-bar">Barra</th>
                  <th className="col-just">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {vars.map((v) => {
                  const label = VARIABLE_LABELS[v.name] || v.name;
                  const barPct = (v.score / 10) * 100;
                  const barColor =
                    v.score >= 8.5
                      ? "#C9A84C"
                      : v.score >= 7
                      ? "#2196F3"
                      : v.score >= 5.5
                      ? "#FFC107"
                      : v.score >= 4
                      ? "#FF9800"
                      : "#F44336";
                  return (
                    <tr key={v.name}>
                      <td className="col-name">{label}</td>
                      <td className="col-score" style={{ color: barColor }}>
                        {v.score.toFixed(1)}
                      </td>
                      <td className="col-bar">
                        <div className="bar-outer">
                          <div
                            className="bar-inner"
                            style={{ width: `${barPct}%`, background: barColor }}
                          />
                        </div>
                      </td>
                      <td className="col-just">{v.justification}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="bp-footer">
              <span>PLUGGON by BLEV Educação</span>
              <span>Gerado em {today}</span>
            </div>
          </div>
        ))}

        {/* ===== STRENGTHS / WEAKNESSES / RECOMMENDATION ===== */}
        <div className="page">
          <h2>Conclusões</h2>
          <div className="highlights">
            <div className="box-strength">
              <h3>✓ Pontos Fortes</h3>
              <ul>
                {(data.strengths || []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="box-weakness">
              <h3>⚠ Pontos de Atenção</h3>
              <ul>
                {(data.weaknesses || []).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="box-reco">
            <h3>💡 Recomendação</h3>
            <p>{data.recommendation}</p>
          </div>

          <div className="bp-footer">
            <span>PLUGGON by BLEV Educação</span>
            <span>Gerado em {today}</span>
          </div>
        </div>
      </div>
    </>
  );
}
