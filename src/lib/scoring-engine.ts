// ============================================================
// Scoring Engine — Pluggon
// 35 variáveis em 7 categorias + bônus de observações.
// Score 100% calculado por código. Dados: IBGE, ABVE, Google Places, banco interno.
// ============================================================

export type ScoreSource =
  | "ABVE"
  | "Google Places"
  | "IBGE"
  | "Cálculo"
  | "Usuário";

export interface ScoreInput {
  // IBGE
  population: number;
  gdpPerCapita: number;

  // ABVE (cidade)
  abveDC: number;
  abveTotal: number;
  abveEVs: number;

  // Banco interno de carregadores
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  dcInCity: number;
  totalInCity: number;

  // Nomes dos concorrentes DC (para justificativas e operadores)
  dcNamesIn200m?: string[];
  dcNamesIn500m?: string[];
  dcNamesIn1km?: string[];
  dcNamesIn2km?: string[];

  // Google Places — 500m
  restaurants: number;
  supermarkets: number;
  gasStations: number;
  parkingLots: number;
  totalPOIs: number;

  // Google Places — 1km
  shoppings: number;
  hotels: number;

  // Google Places — 2km
  universities: number;
  hospitals: number;

  // Google Places — hubs de transporte
  hasAirportNearby: boolean;
  hasRodoviariaNearby: boolean;

  // Geocoding
  distanceToCenter: number; // km

  // Usuário
  establishmentType: string;
  observations: string;
}

export interface ScoreVariable {
  id: number;
  name: string;
  category: string;
  score: number; // 0-10
  weight: number;
  justification: string;
  source: ScoreSource;
}

export interface CriticalFactor {
  name: string;
  category: string;
  score: number;
  weight: number;
  impact: number; // pontos perdidos no score final (0-100) vs nota máxima
  justification: string;
  suggestion: string | null;
}

export interface ScoreResult {
  overallScore: number;
  rawScore: number;
  cityFactor: number;
  classification: string;
  variables: ScoreVariable[];
  categoryScores: Record<string, number>;
  observationsBonus: number;
  criticalFactors: CriticalFactor[];
}

// Pesos por categoria (somam 100%)
const CATEGORY_WEIGHTS: Record<string, number> = {
  "Demanda e População": 20,
  "Frota EV e Adoção": 20,
  "Tráfego e Mobilidade": 15,
  Concorrência: 20,
  "Localização e Acesso": 15,
  "Tipo de Ponto": 7,
  Amenidades: 3,
};

// Constantes de mercado (ABVE)
const NATIONAL_EV_GROWTH_YOY = 0.26;
const NATIONAL_EV_MARKET_SHARE = 2.16;
const VEHICLE_OWNERSHIP_RATE = 0.5;

const HIGH_FLOW_TYPES = [
  "rodoviaria",
  "aeroporto",
  "shopping",
  "posto_24h",
  "hospital_24h",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtNames(names?: string[], max = 2): string {
  if (!names || names.length === 0) return "";
  if (names.length <= max) return `: ${names.join("; ")}`;
  const extra = names.length - max;
  return `: ${names.slice(0, max).join("; ")} (+${extra})`;
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const vars: ScoreVariable[] = [];
  let id = 1;
  const add = (
    name: string,
    category: string,
    score: number,
    weight: number,
    just: string,
    source: ScoreSource = "Cálculo"
  ) => {
    vars.push({
      id: id++,
      name,
      category,
      score: clamp(Math.round(score * 10) / 10, 0, 10),
      weight,
      justification: just,
      source,
    });
  };

  // ---------- Cálculos auxiliares ----------
  const dcCity = Math.max(input.abveDC || 0, input.dcInCity || 0);
  const evsCityFromAbve = (input.abveEVs ?? 0) > 0;
  const evsCity =
    input.abveEVs ||
    Math.round(
      input.population *
        (input.gdpPerCapita > 50_000
          ? 0.006
          : input.gdpPerCapita > 30_000
          ? 0.004
          : 0.002)
    );
  const ratioEVperCharger = dcCity > 0 ? Math.round(evsCity / dcCity) : 999;
  const cityShare =
    input.population > 0
      ? (evsCity / (input.population * VEHICLE_OWNERSHIP_RATE)) * 100
      : 0;
  const projection5y = Math.round(
    evsCity * Math.pow(1 + NATIONAL_EV_GROWTH_YOY, 5)
  );

  const tipoKey = (input.establishmentType || "outro").toLowerCase();
  const obs = (input.observations || "").toLowerCase();
  const isHighFlow = HIGH_FLOW_TYPES.includes(tipoKey);

  // ============================================================
  // CATEGORIA 1 — DEMANDA E POPULAÇÃO (20%)
  // ============================================================

  // V1 — População do município (peso 3)
  const v1 =
    input.population > 2_000_000 ? 10 :
    input.population > 1_000_000 ? 9 :
    input.population > 500_000 ? 8 :
    input.population > 300_000 ? 7 :
    input.population > 200_000 ? 6 :
    input.population > 100_000 ? 5 :
    input.population > 50_000 ? 4 : 3;
  add(
    "População do município",
    "Demanda e População",
    v1,
    3,
    `${fmtInt(input.population)} habitantes (IBGE)`,
    "IBGE"
  );

  // V2 — Densidade populacional (peso 2)
  const v2 =
    input.population > 1_000_000 && input.distanceToCenter < 5 ? 9 :
    input.population > 500_000 && input.distanceToCenter < 5 ? 7 :
    input.population > 200_000 && input.distanceToCenter < 5 ? 6 :
    input.population > 100_000 ? 5 : 4;
  const v2Label = v2 >= 8 ? "alta" : v2 >= 6 ? "média" : "baixa";
  add(
    "Densidade populacional",
    "Demanda e População",
    v2,
    2,
    `Região de ${v2Label} densidade demográfica (proxy: porte da cidade e distância ao centro)`,
    "IBGE"
  );

  // V3 — PIB per capita (peso 3)
  const v3 =
    input.gdpPerCapita > 70_000 ? 10 :
    input.gdpPerCapita > 55_000 ? 9 :
    input.gdpPerCapita > 40_000 ? 8 :
    input.gdpPerCapita > 30_000 ? 7 :
    input.gdpPerCapita > 20_000 ? 5 : 3;
  add(
    "PIB per capita",
    "Demanda e População",
    v3,
    3,
    `R$ ${fmtInt(input.gdpPerCapita)} per capita (IBGE)`,
    "IBGE"
  );

  // V4 — Estimativa domicílios alta renda (peso 2)
  let v4: number;
  let v4Label: string;
  if (input.gdpPerCapita > 50_000 && input.distanceToCenter < 5) {
    v4 = 9;
    v4Label = "alto";
  } else if (input.gdpPerCapita > 50_000) {
    v4 = 7;
    v4Label = "alto";
  } else if (input.gdpPerCapita > 30_000 && input.distanceToCenter < 3) {
    v4 = 7;
    v4Label = "médio-alto";
  } else if (input.gdpPerCapita > 30_000) {
    v4 = 5;
    v4Label = "médio";
  } else {
    v4 = 4;
    v4Label = "baixo";
  }
  add(
    "Domicílios de alta renda (estimativa)",
    "Demanda e População",
    v4,
    2,
    `Região com ${v4Label} poder aquisitivo — PIB per capita R$ ${fmtInt(
      input.gdpPerCapita
    )} a ${input.distanceToCenter.toFixed(1)}km do centro`
  );

  // V5 — Moradores sem garagem (peso 2)
  const v5 =
    input.population > 1_000_000 ? 8 :
    input.population > 500_000 ? 7 :
    input.population > 200_000 ? 5 : 3;
  add(
    "Moradores sem garagem (estimativa)",
    "Demanda e População",
    v5,
    2,
    "Cidades maiores têm maior % de moradores em apartamentos sem garagem — dependem de carregamento público"
  );

  // V6 — Crescimento populacional (peso 1) — fixo moderado
  add(
    "Crescimento populacional",
    "Demanda e População",
    6,
    1,
    "Crescimento demográfico estável (estimativa setorial)"
  );

  // V7 — Potencial motoristas de app (peso 3)
  const v7 =
    input.population > 1_000_000 ? 9 :
    input.population > 500_000 ? 8 :
    input.population > 200_000 ? 6 :
    input.population > 100_000 ? 5 : 3;
  const appDriversEstimate = Math.round(input.population * 0.012);
  add(
    "Potencial de motoristas de app",
    "Demanda e População",
    v7,
    3,
    `Estimativa de ${fmtInt(
      appDriversEstimate
    )} motoristas de app na região. Hoje 6% da frota de app é elétrica e 20% das novas compras são EVs`
  );

  // ============================================================
  // CATEGORIA 2 — FROTA EV E ADOÇÃO (20%)
  // ============================================================

  // V8 — EVs registrados na cidade (peso 3)
  const v8 =
    evsCity > 30_000 ? 10 :
    evsCity > 15_000 ? 9 :
    evsCity > 8_000 ? 8 :
    evsCity > 3_000 ? 7 :
    evsCity > 1_000 ? 5 :
    evsCity > 500 ? 4 : 3;
  add(
    "EVs registrados na cidade",
    "Frota EV e Adoção",
    v8,
    3,
    evsCityFromAbve
      ? `${fmtInt(evsCity)} veículos eletrificados (ABVE)`
      : `${fmtInt(evsCity)} veículos estimados a partir de vendas estaduais`,
    evsCityFromAbve ? "ABVE" : "Cálculo"
  );

  // V9 — Crescimento das vendas EV nacional (peso 2)
  add(
    "Crescimento das vendas de EV",
    "Frota EV e Adoção",
    8,
    2,
    "Mercado nacional crescendo 26% ao ano. Jan-fev 2026: +90% vs ano anterior (ABVE)",
    "ABVE"
  );

  // V10 — Market share EV na cidade (peso 2)
  const v10 =
    cityShare > 3 ? 9 :
    cityShare > 2 ? 8 :
    cityShare > 1 ? 6 :
    cityShare > 0.5 ? 5 : 3;
  add(
    "Market share EV na cidade",
    "Frota EV e Adoção",
    v10,
    2,
    `${cityShare.toFixed(2)}% de penetração EV na frota local estimada`
  );

  // V11 — Concessionárias EV (peso 1)
  const v11 =
    input.population > 500_000 ? 8 :
    input.population > 200_000 ? 6 : 3;
  const v11Label =
    v11 >= 8
      ? "Forte presença de concessionárias EV (BYD, GWM, Volvo)"
      : v11 >= 6
      ? "Presença moderada de concessionárias EV"
      : "Pouca ou nenhuma concessionária EV na região";
  add(
    "Concessionárias EV na região",
    "Frota EV e Adoção",
    v11,
    1,
    `${v11Label} (proxy por porte da cidade)`
  );

  // V12 — Frotas corporativas elétricas (peso 2)
  const v12 =
    input.population > 1_000_000 ? 8 :
    input.population > 500_000 ? 6 :
    input.population > 200_000 ? 4 : 2;
  add(
    "Frotas corporativas elétricas",
    "Frota EV e Adoção",
    v12,
    2,
    "Presença estimada de frotas corporativas elétricas (Mercado Livre, Amazon, iFood, Correios)"
  );

  // V13 — % motoristas de app elétricos (peso 2)
  const v13 =
    input.population > 1_000_000 ? 8 :
    input.population > 500_000 ? 7 :
    input.population > 200_000 ? 5 : 3;
  add(
    "% de motoristas de app elétricos",
    "Frota EV e Adoção",
    v13,
    2,
    "~6% dos motoristas de app em cidades grandes já usam EV; tendência de 20% nas novas aquisições"
  );

  // V14 — Projeção da frota em 5 anos (peso 2)
  const v14 =
    projection5y > 30_000 ? 10 :
    projection5y > 15_000 ? 9 :
    projection5y > 8_000 ? 8 :
    projection5y > 3_000 ? 7 :
    projection5y > 1_000 ? 5 :
    projection5y > 500 ? 4 : 3;
  add(
    "Projeção da frota EV em 5 anos",
    "Frota EV e Adoção",
    v14,
    2,
    `Projeção de ${fmtInt(projection5y)} veículos elétricos em 2031 (crescimento 26% a.a.)`
  );

  // V15 — Índice de eletrificação vs nacional (peso 1)
  const v15 =
    cityShare > NATIONAL_EV_MARKET_SHARE ? 8 :
    cityShare > NATIONAL_EV_MARKET_SHARE * 0.7 ? 6 : 4;
  const v15Label = v15 === 8 ? "acima da" : v15 === 6 ? "na" : "abaixo da";
  add(
    "Índice de eletrificação vs nacional",
    "Frota EV e Adoção",
    v15,
    1,
    `Cidade ${v15Label} média nacional de eletrificação (${NATIONAL_EV_MARKET_SHARE}%) — local em ${cityShare.toFixed(
      2
    )}%`
  );

  // ============================================================
  // CATEGORIA 3 — TRÁFEGO E MOBILIDADE (15%)
  // ============================================================

  // V16 — Classificação da via (peso 3)
  let v16: number;
  let v16Label: string;
  if (input.gasStations >= 2 && input.distanceToCenter < 5) {
    v16 = 9;
    v16Label = "via principal";
  } else if (input.gasStations >= 1 && input.distanceToCenter < 3) {
    v16 = 8;
    v16Label = "via arterial";
  } else if (input.gasStations >= 1) {
    v16 = 7;
    v16Label = "via comercial";
  } else if (input.distanceToCenter < 3) {
    v16 = 6;
    v16Label = "via secundária central";
  } else if (input.distanceToCenter > 5) {
    v16 = 4;
    v16Label = "via local";
  } else {
    v16 = 5;
    v16Label = "via secundária";
  }
  add(
    "Classificação da via",
    "Tráfego e Mobilidade",
    v16,
    3,
    `${input.gasStations} postos de combustível em 500m e ${input.distanceToCenter.toFixed(
      1
    )}km do centro indicam ${v16Label}`
  );

  // V17 — Proximidade a rodovias e vias arteriais (peso 3)
  const highwayKw = ["rodovia", "br-", "highway", "estadual"];
  const arterialKw = ["avenida", "principal"];
  const hasHighway = highwayKw.some((k) => obs.includes(k));
  const hasArterial = arterialKw.some((k) => obs.includes(k));
  const v17 =
    hasHighway ? 9 :
    hasArterial ? 7 :
    input.distanceToCenter < 2 ? 6 : 4;
  const v17Label =
    v17 === 9 ? "próximo a rodovias/BR" :
    v17 === 7 ? "em via arterial" :
    v17 === 6 ? "em região central" :
    "distante de vias arteriais identificadas";
  add(
    "Proximidade a rodovias e vias arteriais",
    "Tráfego e Mobilidade",
    v17,
    3,
    `Ponto ${v17Label} (baseado em observações e localização)`,
    hasHighway || hasArterial ? "Usuário" : "Cálculo"
  );

  // V18 — Postos de combustível em 500m (peso 2)
  const v18 =
    input.gasStations >= 3 ? 9 :
    input.gasStations >= 2 ? 8 :
    input.gasStations >= 1 ? 6 : 3;
  add(
    "Postos de combustível em 500m",
    "Tráfego e Mobilidade",
    v18,
    2,
    `${input.gasStations} postos em 500m — alto indicador de fluxo veicular`,
    "Google Places"
  );

  // V19 — Proximidade a hub de transporte (peso 3) — aeroporto + rodoviária (substitui V19+V20 antigas)
  let vHub: number;
  let vHubLabel: string;
  let vHubSource: ScoreSource;
  if (tipoKey === "aeroporto" || tipoKey === "rodoviaria") {
    vHub = 10;
    vHubLabel =
      tipoKey === "aeroporto"
        ? "é o próprio aeroporto"
        : "é a própria rodoviária";
    vHubSource = "Usuário";
  } else if (input.hasAirportNearby || input.hasRodoviariaNearby) {
    vHub = 8;
    const hubs: string[] = [];
    if (input.hasAirportNearby) hubs.push("aeroporto (5km)");
    if (input.hasRodoviariaNearby) hubs.push("rodoviária (3km)");
    vHubLabel = `está próximo a ${hubs.join(" e ")}`;
    vHubSource = "Google Places";
  } else if (input.distanceToCenter < 2 && input.population > 200_000) {
    vHub = 6;
    vHubLabel = `está em região central de cidade grande (${input.distanceToCenter.toFixed(
      1
    )}km do centro, ${fmtInt(input.population)} hab.)`;
    vHubSource = "Cálculo";
  } else {
    vHub = 4;
    vHubLabel = "está distante de hubs de transporte identificados";
    vHubSource = "Cálculo";
  }
  add(
    "Proximidade a hub de transporte",
    "Tráfego e Mobilidade",
    vHub,
    3,
    `Ponto ${vHubLabel}`,
    vHubSource
  );

  // V20 — Potencial turístico/regional (peso 1)
  const v21 =
    input.hotels >= 5 ? 9 :
    input.hotels >= 2 ? 7 :
    input.hotels >= 1 ? 5 : 3;
  const v21Label =
    v21 >= 8 ? "alta" :
    v21 >= 6 ? "moderada" :
    v21 >= 4 ? "baixa" : "muito baixa";
  add(
    "Potencial turístico/regional",
    "Tráfego e Mobilidade",
    v21,
    1,
    `${input.hotels} hotéis em 1km indicam ${v21Label} atividade turística`,
    "Google Places"
  );

  // ============================================================
  // CATEGORIA 4 — CONCORRÊNCIA (20%)
  // ============================================================

  // V21 — DC na cidade total (peso 2)
  const v22 =
    dcCity < 5 ? 9 :
    dcCity <= 15 ? 8 :
    dcCity <= 50 ? 7 :
    dcCity <= 100 ? 6 : 5;
  add(
    "Carregadores DC na cidade (total)",
    "Concorrência",
    v22,
    2,
    `${dcCity} carregadores rápidos na cidade`,
    input.abveDC ? "ABVE" : "Cálculo"
  );

  // V22 — Concorrentes DC em 200m (peso 3) — sensível a high flow
  let v23: number;
  let v23Just: string;
  if (isHighFlow) {
    v23 =
      input.dcIn200m === 0 ? 8 :
      input.dcIn200m <= 2 ? 9 :
      input.dcIn200m <= 4 ? 6 : 4;
    v23Just =
      input.dcIn200m === 0
        ? "Nenhum concorrente direto em 200m — oportunidade aberta em ponto de alto fluxo"
        : input.dcIn200m <= 2
        ? `${input.dcIn200m} carregador(es) rápido(s) em 200m — valida demanda do local${fmtNames(
            input.dcNamesIn200m
          )}`
        : `${input.dcIn200m} carregadores rápidos em 200m — mercado disputado${fmtNames(
            input.dcNamesIn200m
          )}`;
  } else {
    v23 =
      input.dcIn200m === 0 ? 10 :
      input.dcIn200m === 1 ? 5 :
      input.dcIn200m === 2 ? 3 : 1;
    v23Just =
      input.dcIn200m === 0
        ? "Sem concorrência direta em 200m"
        : `${input.dcIn200m} carregadores rápidos em 200m — concorrência direta identificada${fmtNames(
            input.dcNamesIn200m
          )}`;
  }
  add(
    isHighFlow ? "Validação de demanda (200m)" : "Concorrência direta (200m)",
    "Concorrência",
    v23,
    3,
    v23Just
  );

  // V23 — Concorrentes DC em 500m (peso 3) — sensível a high flow
  let v24: number;
  let v24Just: string;
  if (isHighFlow) {
    v24 =
      input.dcIn500m === 0 ? 8 :
      input.dcIn500m <= 3 ? 9 :
      input.dcIn500m <= 6 ? 6 : 4;
    v24Just =
      input.dcIn500m === 0
        ? "Sem concorrentes em 500m — oportunidade aberta em ponto de alto fluxo"
        : input.dcIn500m <= 3
        ? `${input.dcIn500m} carregador(es) rápido(s) em 500m — valida demanda regional${fmtNames(
            input.dcNamesIn500m
          )}`
        : `${input.dcIn500m} carregadores rápidos em 500m — região disputada${fmtNames(
            input.dcNamesIn500m
          )}`;
  } else {
    v24 =
      input.dcIn500m === 0 ? 10 :
      input.dcIn500m <= 2 ? 7 :
      input.dcIn500m <= 5 ? 5 : 3;
    v24Just = `${input.dcIn500m} carregadores rápidos em 500m${fmtNames(
      input.dcNamesIn500m
    )}`;
  }
  add(
    isHighFlow ? "Validação de demanda (500m)" : "Concorrência próxima (500m)",
    "Concorrência",
    v24,
    3,
    v24Just
  );

  // V24 — Concorrentes DC em 1km (peso 2)
  const v25 =
    input.dcIn1km === 0 ? 9 :
    input.dcIn1km <= 3 ? 7 :
    input.dcIn1km <= 8 ? 5 : 3;
  add(
    "Concorrentes DC em 1km",
    "Concorrência",
    v25,
    2,
    `${input.dcIn1km} carregadores rápidos em 1km${fmtNames(input.dcNamesIn1km)}`
  );

  // V25 — Concorrentes DC em 2km (peso 2)
  const v26 =
    input.dcIn2km <= 2 ? 9 :
    input.dcIn2km <= 5 ? 7 :
    input.dcIn2km <= 10 ? 5 : 3;
  add(
    "Concorrentes DC em 2km",
    "Concorrência",
    v26,
    2,
    `${input.dcIn2km} carregadores rápidos em 2km${fmtNames(input.dcNamesIn2km)}`
  );

  // V26 — Ratio EVs por carregador DC (peso 3)
  const v27 =
    ratioEVperCharger > 200 ? 10 :
    ratioEVperCharger > 100 ? 9 :
    ratioEVperCharger > 50 ? 7 :
    ratioEVperCharger > 20 ? 5 :
    ratioEVperCharger > 10 ? 4 : 3;
  const v27Label =
    v27 >= 9 ? "demanda muito reprimida" :
    v27 >= 5 ? "equilíbrio entre oferta e demanda" :
    "mercado bem servido";
  add(
    "Ratio de EVs por carregador DC",
    "Concorrência",
    v27,
    3,
    `${ratioEVperCharger} veículos elétricos por carregador DC na cidade — ${v27Label}`
  );

  // V27 — Gap de cobertura (peso 2)
  let v29: number;
  let v29Label: string;
  if (input.dcIn1km === 0 && input.population > 200_000) {
    v29 = 10;
    v29Label = "Gap significativo";
  } else if (input.dcIn500m === 0) {
    v29 = 8;
    v29Label = "Gap parcial";
  } else if (input.dcIn1km < 3) {
    v29 = 6;
    v29Label = "Cobertura parcial";
  } else {
    v29 = 4;
    v29Label = "Área bem servida";
  }
  add(
    "Gap de cobertura",
    "Concorrência",
    v29,
    2,
    `${v29Label} de carregamento rápido (${input.dcIn500m} em 500m, ${input.dcIn1km} em 1km)`
  );

  // ============================================================
  // CATEGORIA 5 — LOCALIZAÇÃO E ACESSO (15%)
  // ============================================================

  // V28 — Distância ao centro (peso 3)
  const v30 =
    input.distanceToCenter < 1 ? 10 :
    input.distanceToCenter < 2 ? 9 :
    input.distanceToCenter < 3 ? 8 :
    input.distanceToCenter < 5 ? 7 :
    input.distanceToCenter < 8 ? 5 :
    input.distanceToCenter < 12 ? 4 : 2;
  add(
    "Distância ao centro",
    "Localização e Acesso",
    v30,
    3,
    `${input.distanceToCenter.toFixed(1)}km do centro da cidade`
  );

  // V29 — Visibilidade e fluxo (peso 3)
  const v31 =
    input.totalPOIs > 25 ? 10 :
    input.totalPOIs > 15 ? 8 :
    input.totalPOIs > 10 ? 7 :
    input.totalPOIs > 5 ? 5 : 3;
  const v31Label =
    v31 >= 9 ? "altíssimo" :
    v31 >= 7 ? "alto" :
    v31 >= 5 ? "moderado" : "baixo";
  add(
    "Visibilidade e fluxo",
    "Localização e Acesso",
    v31,
    3,
    `${input.totalPOIs} estabelecimentos em 500m — indica ${v31Label} fluxo de pessoas`,
    "Google Places"
  );

  // V30 — Proximidade a centros corporativos (peso 1)
  const v34 =
    input.distanceToCenter < 3 && input.population > 500_000 ? 8 :
    input.distanceToCenter < 5 && input.population > 300_000 ? 6 : 4;
  const v34Label = v34 === 8 ? "alta" : v34 === 6 ? "moderada" : "baixa";
  add(
    "Proximidade a centros corporativos",
    "Localização e Acesso",
    v34,
    1,
    `Proximidade ${v34Label} a centros empresariais (${input.distanceToCenter.toFixed(
      1
    )}km do centro em cidade de ${fmtInt(input.population)} hab.)`
  );

  // V31 — Proximidade a geradores de fluxo (peso 2) — universidades + hospitais + shoppings (substitui V35+V36 antigas)
  const generators =
    (input.universities ?? 0) +
    (input.hospitals ?? 0) +
    (input.shoppings ?? 0);
  const vGen =
    generators >= 5 ? 10 :
    generators >= 3 ? 8 :
    generators >= 1 ? 6 : 4;
  add(
    "Proximidade a geradores de fluxo",
    "Localização e Acesso",
    vGen,
    2,
    `${generators} gerador(es) de fluxo no entorno (${input.universities ?? 0} universidades em 2km, ${input.hospitals ?? 0} hospitais em 2km, ${input.shoppings ?? 0} shoppings em 1km)`,
    generators > 0 ? "Google Places" : "Cálculo"
  );

  // ============================================================
  // CATEGORIA 6 — TIPO DE PONTO (7%)
  // ============================================================

  // V32 — Adequação do tipo (peso 3)
  const tipoScores: Record<string, number> = {
    aeroporto: 10,
    rodoviaria: 10,
    posto_24h: 9,
    shopping: 9,
    hotel: 8,
    hospital_24h: 8,
    supermercado: 7,
    estacionamento: 7,
    universidade: 7,
    terreno: 6,
    restaurante: 6,
    outro: 5,
  };
  const tipoJustificativas: Record<string, string> = {
    aeroporto:
      "Aeroporto — máximo fluxo de veículos, alta visibilidade, operação 24h, perfil ideal para DC",
    rodoviaria:
      "Rodoviária — alto fluxo diário, ponto de parada natural, operação contínua",
    posto_24h:
      "Posto 24h — operação contínua, visibilidade, acesso fácil, público habituado a parar",
    shopping:
      "Shopping — alto tempo de permanência (1-3h) e público com poder aquisitivo",
    hotel:
      "Hotel — pernoite permite carregamento longo, público turista e executivo",
    hospital_24h:
      "Hospital 24h — operação contínua, fluxo constante de visitantes",
    supermercado: "Supermercado — parada de 30-60min ideal para DC",
    estacionamento:
      "Estacionamento — infraestrutura existente, vagas disponíveis",
    universidade: "Universidade — público jovem, permanência de horas",
    terreno: "Terreno — flexibilidade de projeto, mas sem fluxo existente",
    restaurante: "Restaurante — tempo de permanência ideal (30-60min)",
    outro: "Tipo de estabelecimento genérico",
  };
  add(
    "Adequação do tipo de ponto",
    "Tipo de Ponto",
    tipoScores[tipoKey] ?? 5,
    3,
    tipoJustificativas[tipoKey] || "Tipo de estabelecimento informado",
    "Usuário"
  );

  // V33 — Potencial de operação contínua (peso 3)
  const opScores: Record<string, number> = {
    posto_24h: 10,
    aeroporto: 10,
    hospital_24h: 10,
    hotel: 9,
    rodoviaria: 9,
    shopping: 7,
    supermercado: 7,
    estacionamento: 6,
    restaurante: 5,
    terreno: 5,
    universidade: 4,
    outro: 4,
  };
  const opScore = opScores[tipoKey] ?? 4;
  const opLabel = opScore >= 9 ? "24h" : opScore >= 7 ? "estendida" : "comercial";
  add(
    "Potencial de operação contínua",
    "Tipo de Ponto",
    opScore,
    3,
    `${tipoKey} permite operação ${opLabel}`,
    "Usuário"
  );

  // V34 — Tempo de permanência (peso 2)
  const dwellScores: Record<string, number> = {
    shopping: 10,
    hotel: 10,
    universidade: 9,
    restaurante: 9,
    aeroporto: 8,
    estacionamento: 8,
    supermercado: 7,
    rodoviaria: 7,
    hospital_24h: 7,
    terreno: 6,
    posto_24h: 6,
    outro: 5,
  };
  const dwellLabels: Record<string, string> = {
    shopping: "2-3h — ideal para DC",
    hotel: "pernoite — ideal para DC",
    universidade: "4-8h — ideal para DC",
    restaurante: "1h — adequado para DC",
    aeroporto: "1-3h — adequado para DC",
    estacionamento: "variável — adequado para DC",
    supermercado: "30-60min — adequado para DC",
    rodoviaria: "30-60min — adequado para DC",
    hospital_24h: "30-90min — adequado para DC",
    terreno: "indefinido — depende do projeto",
    posto_24h: "10-20min — curto para DC",
    outro: "indefinido",
  };
  add(
    "Tempo de permanência",
    "Tipo de Ponto",
    dwellScores[tipoKey] ?? 5,
    2,
    `Permanência típica: ${dwellLabels[tipoKey] || "indefinida"}`,
    "Usuário"
  );

  // ============================================================
  // CATEGORIA 7 — AMENIDADES (3%)
  // ============================================================

  // V35 — Amenidades no entorno 500m (peso 1)
  const amenitiesTotal = input.restaurants + input.supermarkets;
  const vAmen =
    amenitiesTotal >= 30 ? 10 :
    amenitiesTotal >= 20 ? 9 :
    amenitiesTotal >= 10 ? 7 :
    amenitiesTotal >= 5 ? 5 :
    amenitiesTotal >= 2 ? 4 : 2;
  add(
    "Amenidades no entorno 500m",
    "Amenidades",
    vAmen,
    1,
    `${amenitiesTotal} amenidades em 500m (${input.restaurants} restaurantes/cafés, ${input.supermarkets} supermercados)`,
    "Google Places"
  );

  // ============================================================
  // AGREGAÇÃO POR CATEGORIA E SCORE FINAL
  // ============================================================

  const categoryScores: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_WEIGHTS)) {
    const inCat = vars.filter((v) => v.category === cat);
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
  let totalCatWeight = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    rawScore += (categoryScores[cat] || 0) * 10 * (weight / 100);
    totalCatWeight += weight;
  }
  if (totalCatWeight !== 100) {
    rawScore = (rawScore * 100) / totalCatWeight;
  }

  const pop = input.population || 200_000;
  const cityFactor =
    pop > 2_000_000 ? 1.0 :
    pop > 1_000_000 ? 0.98 :
    pop > 500_000 ? 0.95 :
    pop > 200_000 ? 0.90 :
    pop > 100_000 ? 0.85 : 0.78;
  const finalMultiplier = 0.88 + 0.12 * cityFactor;

  // Bônus de observações — fora das categorias, ajuste no score final
  const highImpactWords = [
    "excelente",
    "ótimo",
    "perfeito",
    "melhor ponto",
    "premium",
    "excepcional",
  ];
  const positiveWords = [
    "24h",
    "avenida principal",
    "visibilidade",
    "frente pra rua",
    "alto fluxo",
    "segurança",
    "câmera",
    "iluminação",
    "trifásico",
    "transformador",
    "terreno próprio",
    "sem aluguel",
    "rodovia",
    "br-",
    "esquina",
    "centro",
    "batel",
    "jardins",
    "leblon",
    "faria lima",
    "paulista",
    "copacabana",
    "beira mar",
  ];
  const negativeWords = [
    "escuro",
    "perigoso",
    "difícil acesso",
    "rua estreita",
    "monofásico",
    "sem estacionamento",
    "longe",
    "ruim",
    "pouco movimento",
    "abandonado",
  ];
  const highCount = highImpactWords.filter((w) => obs.includes(w)).length;
  const posCount = positiveWords.filter((w) => obs.includes(w)).length;
  const negCount = negativeWords.filter((w) => obs.includes(w)).length;
  const highBonus = Math.min(6, highCount * 3);
  const posBonus = Math.min(5, posCount * 1);
  const negBonus = -negCount * 2;
  const observationsBonus = clamp(highBonus + posBonus + negBonus, -6, 8);

  const overallScore = clamp(
    Math.round(rawScore * finalMultiplier) + observationsBonus,
    0,
    100
  );

  const classification =
    overallScore >= 85 ? "PREMIUM" :
    overallScore >= 70 ? "ESTRATÉGICO" :
    overallScore >= 55 ? "VIÁVEL" :
    overallScore >= 40 ? "MARGINAL" : "NÃO RECOMENDADO";

  // ============================================================
  // FATORES CRÍTICOS — top 5 variáveis com pior impacto real
  // ============================================================
  const categorySumWeights: Record<string, number> = {};
  for (const cat of Object.keys(CATEGORY_WEIGHTS)) {
    categorySumWeights[cat] = vars
      .filter((v) => v.category === cat)
      .reduce((s, v) => s + v.weight, 0);
  }

  const criticalFactors: CriticalFactor[] = [...vars]
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .slice(0, 5)
    .map((v) => {
      const catSumW = categorySumWeights[v.category] || 1;
      const catW = CATEGORY_WEIGHTS[v.category] || 0;
      // Pontos perdidos no score final (0-100) vs nota máxima (10)
      const impact =
        ((10 - v.score) * v.weight * catW) / catSumW / 10 * finalMultiplier;
      return {
        name: v.name,
        category: v.category,
        score: v.score,
        weight: v.weight,
        impact: Math.round(impact * 10) / 10,
        justification: v.justification,
        suggestion: getCriticalSuggestion(v),
      };
    });

  return {
    overallScore,
    rawScore: Math.round(rawScore * 10) / 10,
    cityFactor,
    classification,
    variables: vars,
    categoryScores,
    observationsBonus,
    criticalFactors,
  };
}

function getCriticalSuggestion(v: ScoreVariable): string | null {
  if (v.score > 5 || v.weight < 2) return null;
  const n = v.name;
  if (n === "População do município")
    return "Cidade menor tem demanda limitada. Considere focar em pontos de passagem (rodovias) em vez de pontos urbanos.";
  if (n === "EVs registrados na cidade")
    return "Frota EV ainda pequena. O ponto precisa de outras fontes de demanda (motoristas de app, frotas corporativas).";
  if (n.includes("(200m)"))
    return "Concorrência direta em 200m. Verifique se a demanda do local comporta mais um carregador.";
  if (n === "Distância ao centro")
    return "Distante do centro. Precisa de compensadores: rodovia, alto fluxo próprio, ou operação 24h.";
  if (n === "Adequação do tipo de ponto")
    return "Tipo de estabelecimento não gera fluxo próprio. Depende 100% da localização e entorno.";
  if (n === "Amenidades no entorno 500m")
    return "Poucas opções de permanência no entorno. Motorista pode preferir carregar onde tem o que fazer enquanto espera.";
  if (n === "Proximidade a hub de transporte")
    return "Longe de aeroporto e rodoviária. Menor chance de captar viajantes.";
  if (n === "Postos de combustível em 500m")
    return "Poucos postos de combustível indicam via de baixo tráfego veicular.";
  return null;
}
