// Generates a self-contained dark-theme HTML string from a ScorePoint result.
// Embeds Leaflet (from CDN) to render a mini map centered on the point.

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

interface CriticalFactorData {
  name: string;
  category: string;
  score: number;
  weight: number;
  impact: number;
  justification: string;
  suggestion: string | null;
}

export interface ScoreExportData {
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  establishment_type: string;
  establishment_name: string;
  overall_score: number;
  classification: string;
  scoring_variables?: VariableData[];
  variables?: VariableData[];
  critical_factors?: CriticalFactorData[];
  strengths: string[];
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

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  ABVE: { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  "Google Places": { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  IBGE: { bg: "#5BB3F022", fg: "#5BB3F0", label: "Dados demográficos oficiais" },
  "Cálculo": { bg: "#C9A84C22", fg: "#C9A84C", label: "Análise PLUGGON" },
  "Usuário": { bg: "#A06CD522", fg: "#B98AE0", label: "Usuário" },
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

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scoreColor(score: number): string {
  if (score >= 8.5) return "#C9A84C";
  if (score >= 7) return "#2196F3";
  if (score >= 5.5) return "#FFC107";
  if (score >= 4) return "#FF9800";
  return "#F44336";
}

export function buildScoreHtml(r: ScoreExportData): string {
  const color = CLASSIFICATION_COLOR[r.classification] || "#8B949E";
  const classLabel = CLASSIFICATION_LABEL[r.classification] || r.classification;
  const date = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Group variables by category (prefer scoring_variables, fallback to legacy variables)
  const allVars: VariableData[] = r.scoring_variables || r.variables || [];
  const byCategory: Record<string, VariableData[]> = {};
  for (const v of allVars) {
    if (!byCategory[v.category]) byCategory[v.category] = [];
    byCategory[v.category].push(v);
  }

  const categoriesHtml = Object.entries(byCategory)
    .map(([cat, vars]) => {
      const rows = vars
        .map((v) => {
          const label = VARIABLE_LABELS[v.name] || v.name;
          const col = scoreColor(v.score);
          const pct = (v.score / 10) * 100;
          const srcKey = v.source || "Cálculo";
          const srcCfg = SOURCE_BADGE[srcKey] || SOURCE_BADGE["Cálculo"];
          const srcBadge = `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${srcCfg.bg};color:${srcCfg.fg};font-size:10px;font-weight:600;margin-right:6px;">${esc(srcCfg.label)}</span>`;
          return `
            <div class="var">
              <div class="var-head">
                <span class="var-name">${srcBadge}${esc(label)}</span>
                <span class="var-score" style="color:${col}">${v.score.toFixed(1)}</span>
              </div>
              <div class="var-bar"><div class="var-fill" style="width:${pct}%;background:${col}"></div></div>
              <p class="var-just">${esc(v.justification)}</p>
            </div>`;
        })
        .join("");
      return `
        <div class="cat">
          <h3>${CATEGORY_ICONS[cat] || "📊"} ${esc(CATEGORY_LABELS[cat] || cat)}</h3>
          ${rows}
        </div>`;
    })
    .join("");

  const strengthsHtml = (r.strengths || [])
    .map((s) => `<li>${esc(s)}</li>`)
    .join("");

  const criticalHtml = (r.critical_factors || [])
    .map((f) => {
      const isCritical = f.score <= 4;
      const accent = isCritical ? "#F44336" : "#FF9800";
      const suggestionHtml = f.suggestion
        ? `<p class="cf-sug">💡 ${esc(f.suggestion)}</p>`
        : "";
      return `
        <div class="cf-card" style="border-color:${accent}55;background:${accent}10">
          <div class="cf-head">
            <div>
              <span class="cf-icon" style="color:${accent}">⚠</span>
              <span class="cf-name">${esc(f.name)}</span>
              <div class="cf-cat">Categoria: ${esc(f.category)}</div>
            </div>
            <div class="cf-score" style="color:${accent}">${f.score.toFixed(1)}<small>/10</small></div>
          </div>
          <p class="cf-impact">Esta variável está reduzindo seu score em aproximadamente <strong style="color:${accent}">${f.impact.toFixed(1)} pontos</strong>.</p>
          ${suggestionHtml}
        </div>`;
    })
    .join("");

  const s = r.overall_score;
  let valeTitle = "NÃO RECOMENDADO";
  let valeBody =
    "Este ponto não atende os requisitos mínimos para uma operação rentável.";
  let valeColor = "#F44336";
  if (s >= 85) {
    valeTitle = "PREMIUM";
    valeBody = "Este ponto tem fundamentos sólidos. Risco baixo.";
    valeColor = "#C9A84C";
  } else if (s >= 70) {
    valeTitle = "ESTRATÉGICO";
    valeBody =
      "Bom ponto com ressalvas. Os fatores acima merecem atenção mas não impedem a operação.";
    valeColor = "#2196F3";
  } else if (s >= 55) {
    valeTitle = "VIÁVEL";
    valeBody =
      "Ponto com potencial mas riscos significativos. Avalie se os fatores negativos podem ser mitigados antes de investir.";
    valeColor = "#FFC107";
  } else if (s >= 40) {
    valeTitle = "MARGINAL";
    valeBody =
      "Risco alto. Os fatores negativos são difíceis de contornar. Recomendamos buscar alternativas.";
    valeColor = "#FF9800";
  }

  const pois = (r.nearby_pois || []).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    name: p.name,
    type: p.type,
    distance_m: p.distance_m,
  }));
  const chargers = (r.nearby_chargers || []).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    name: p.name,
    distance_m: p.distance_m,
  }));

  const mapData = JSON.stringify({
    lat: r.lat,
    lng: r.lng,
    pois,
    chargers,
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Relatório de Score — ${esc(r.address)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #0A0A0A;
    color: #C9D1D9;
    line-height: 1.6;
  }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
  .cover {
    background: #0A0A0A;
    border: 1px solid #1f1f1f;
    padding: 80px 40px;
    text-align: center;
    margin-bottom: 40px;
    border-radius: 12px;
  }
  .cover-label {
    font-size: 14px;
    letter-spacing: 8px;
    color: #C9A84C;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .cover-line { width: 80px; height: 2px; background: #C9A84C; margin: 24px auto; }
  .cover-address {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    margin: 16px 0 8px;
  }
  .cover-meta { font-size: 13px; color: #8B949E; margin-bottom: 40px; }
  .cover-score {
    font-size: 120px;
    font-weight: 800;
    color: ${color};
    line-height: 1;
    margin: 24px 0 8px;
  }
  .cover-score small { font-size: 28px; color: #8B949E; font-weight: 400; }
  .cover-class {
    display: inline-block;
    padding: 8px 24px;
    border-radius: 999px;
    background: ${color}22;
    color: ${color};
    font-weight: 600;
    font-size: 16px;
    margin-top: 8px;
  }
  .cover-footer { font-size: 11px; color: #555; margin-top: 60px; letter-spacing: 2px; }
  h2 {
    font-size: 22px;
    color: #C9A84C;
    border-bottom: 2px solid #C9A84C;
    padding-bottom: 8px;
    margin: 40px 0 20px;
  }
  .gauge-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }
  @media (max-width: 768px) { .gauge-row { grid-template-columns: 1fr; } }
  .card {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 12px;
    padding: 24px;
  }
  #map { height: 360px; border-radius: 8px; background: #0D1117; }
  .gauge-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .gauge-num { font-size: 72px; font-weight: 800; color: ${color}; line-height: 1; }
  .gauge-of { color: #8B949E; font-size: 14px; }
  .cat {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .cat h3 {
    margin: 0 0 16px;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
  }
  .var { margin-bottom: 14px; }
  .var-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .var-name { color: #C9D1D9; font-size: 13px; }
  .var-score { font-weight: 700; font-size: 13px; }
  .var-bar { height: 6px; background: #21262D; border-radius: 3px; overflow: hidden; }
  .var-fill { height: 100%; border-radius: 3px; }
  .var-just { margin: 6px 0 0; font-size: 11px; color: #8B949E; }
  .strengths {
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    border: 1px solid;
    background: #1a5928;
    border-color: #2ea043;
  }
  .strengths h3 { color: #7ee695; margin-top: 0; }
  .strengths li { color: #c7f0d4; }
  ul { padding-left: 20px; margin: 8px 0; }
  li { margin-bottom: 6px; font-size: 13px; line-height: 1.6; }
  .critical {
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    border: 1px solid #FF980055;
    background: #FF980010;
  }
  .critical h3 { color: #FFB454; margin: 0 0 4px; font-size: 16px; }
  .critical .cf-sub { color: #8B949E; font-size: 11px; margin: 0 0 14px; }
  .cf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 768px) { .cf-grid { grid-template-columns: 1fr; } }
  .cf-card { border: 1px solid; border-radius: 8px; padding: 14px; }
  .cf-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .cf-icon { font-size: 18px; margin-right: 6px; }
  .cf-name { color: #fff; font-weight: 600; font-size: 13px; }
  .cf-cat { color: #8B949E; font-size: 11px; margin-top: 2px; }
  .cf-score { font-size: 22px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .cf-score small { font-size: 12px; color: #8B949E; font-weight: 400; }
  .cf-impact { font-size: 12px; color: #C9D1D9; margin: 12px 0 0; }
  .cf-sug { font-size: 11px; color: #8B949E; margin: 8px 0 0; font-style: italic; }
  .vale {
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 16px;
    border: 1px solid;
  }
  .vale-label { font-size: 11px; color: #8B949E; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; }
  .vale-title { font-size: 26px; font-weight: 800; margin: 6px 0 10px; }
  .vale-body { font-size: 13px; color: #C9D1D9; margin: 0; }
  .footer {
    text-align: center;
    font-size: 11px;
    color: #555;
    border-top: 1px solid #1f1f1f;
    padding-top: 24px;
    margin-top: 60px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <!-- COVER -->
    <div class="cover">
      <div class="cover-label">Relatório de Análise de Ponto</div>
      <div class="cover-line"></div>
      <div class="cover-address">${esc(r.address)}</div>
      <div class="cover-meta">${esc(r.city)} - ${esc(r.state)} · ${esc(r.establishment_name || r.establishment_type)}</div>
      <div class="cover-score">${Math.round(r.overall_score)}<small>/100</small></div>
      <div class="cover-class">${esc(classLabel)}</div>
      <div class="cover-footer">PLUGGON by BLEV Educação</div>
    </div>

    <!-- GAUGE + MAP -->
    <div class="gauge-row">
      <div class="card gauge-wrap">
        <div class="gauge-num">${Math.round(r.overall_score)}</div>
        <div class="gauge-of">de 100</div>
        <div class="cover-class" style="margin-top:16px">${esc(classLabel)}</div>
        <div style="margin-top:16px;text-align:center;font-size:12px;color:#8B949E">
          ${esc(r.lat.toFixed(5))}, ${esc(r.lng.toFixed(5))}
        </div>
      </div>
      <div class="card" style="padding:12px">
        <div id="map"></div>
      </div>
    </div>

    <!-- CATEGORIES -->
    <h2>Análise por Categoria</h2>
    ${categoriesHtml}

    <!-- STRENGTHS -->
    <div class="strengths">
      <h3>✓ Pontos Fortes</h3>
      <ul>${strengthsHtml}</ul>
    </div>

    ${
      criticalHtml
        ? `<!-- CRITICAL FACTORS -->
    <div class="critical">
      <h3>⚠ Fatores que mais impactam esta nota</h3>
      <p class="cf-sub">As 5 variáveis com pior impacto real (nota × peso) no score final.</p>
      <div class="cf-grid">${criticalHtml}</div>
    </div>`
        : ""
    }

    <!-- VALE O RISCO? -->
    <div class="vale" style="border-color:${valeColor}55;background:${valeColor}10">
      <div class="vale-label">Vale o risco?</div>
      <div class="vale-title" style="color:${valeColor}">${esc(valeTitle)}</div>
      <p class="vale-body">${esc(valeBody)}</p>
    </div>

    <div class="footer">PLUGGON by BLEV Educação | Gerado em ${esc(date)}</div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function() {
      var data = ${mapData};
      if (!window.L) return;
      var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([data.lat, data.lng], 15);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
      L.circle([data.lat, data.lng], { radius: 500, color: '#C9A84C', fillColor: '#C9A84C', fillOpacity: 0.05, weight: 1, dashArray: '5,5' }).addTo(map);
      var mainIcon = L.divIcon({
        html: '<div style="width:20px;height:20px;background:#C9A84C;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(201,168,76,0.6);"></div>',
        iconSize: [20, 20], iconAnchor: [10, 10], className: ''
      });
      L.marker([data.lat, data.lng], { icon: mainIcon }).addTo(map).bindPopup('<b>Ponto analisado</b>');
      (data.pois || []).forEach(function(p) {
        L.circleMarker([p.lat, p.lng], { radius: 5, fillColor: '#4ECDC4', color: '#4ECDC4', weight: 1, fillOpacity: 0.8 })
          .addTo(map).bindPopup('<b>' + p.name + '</b><br>' + p.type + ' · ' + p.distance_m + 'm');
      });
      (data.chargers || []).forEach(function(c) {
        var ico = L.divIcon({
          html: '<div style="width:14px;height:14px;background:#F44336;border:2px solid white;border-radius:50%;"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7], className: ''
        });
        L.marker([c.lat, c.lng], { icon: ico }).addTo(map).bindPopup('<b>⚡ ' + c.name + '</b><br>' + c.distance_m + 'm');
      });
    })();
  </script>
</body>
</html>`;
}
