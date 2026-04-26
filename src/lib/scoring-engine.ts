// ============================================================
// Scoring Engine — Pluggon
// Score 100% calculado por código, sem chamadas de IA.
// Variáveis adaptadas do framework Stable.auto para o Brasil.
// ============================================================

export type ScoreSource =
  | "ABVE"
  | "Google Places"
  | "IBGE"
  | "Cálculo"
  | "Usuário";

export interface ScoreInput {
  // Cidade — IBGE
  population: number;
  gdpPerCapita: number;

  // ABVE (cidade)
  abveDC: number;     // DC oficial ABVE na cidade (0 se cidade fora do dataset)
  abveTotal: number;  // Total ABVE na cidade
  abveEVs: number;    // EVs vendidos na cidade (ABVE)

  // Banco próprio (ev_chargers via charger-database.ts)
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  dcInCity: number;   // DC achados pelo Google/OpenChargeMap/etc
  totalInCity: number;

  // Nomes dos concorrentes DC em cada raio (para justificativas)
  dcNamesIn200m?: string[];
  dcNamesIn500m?: string[];
  dcNamesIn1km?: string[];
  dcNamesIn2km?: string[];

  // POIs Google Places
  restaurants: number;   // 500m
  supermarkets: number;  // 500m
  gasStations: number;   // 500m
  shoppings: number;     // 1km
  hotels: number;        // 1km
  parkingLots: number;   // 500m
  totalPOIs: number;     // 500m

  // Geocoding
  distanceToCenter: number; // km

  // Google Places — local
  rating: number;       // 0 se não tem
  reviewCount: number;  // 0 se não tem

  // Usuário
  establishmentType: string;
  observations: string;
}

export interface ScoreVariable {
  id: number;
  name: string;
  category: string;
  score: number;       // 0-10
  weight: number;
  justification: string;
  source: ScoreSource;
}

export interface ScoreResult {
  overallScore: number;
  rawScore: number;
  cityFactor: number;
  classification: string;
  variables: ScoreVariable[];
  categoryScores: Record<string, number>;
}

// Pesos por categoria (somam 100%)
const CATEGORY_WEIGHTS: Record<string, number> = {
  Demanda: 25,
  Concorrência: 25,
  Localização: 20,
  Amenidades: 15,
  "Tipo de Ponto": 10,
  Observações: 5,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

  // Melhor dado DC na cidade: ABVE ou banco próprio (o maior)
  const dcCity = Math.max(input.abveDC || 0, input.dcInCity || 0);
  const evsCity =
    input.abveEVs ||
    Math.round(
      input.population *
        (input.gdpPerCapita > 50000
          ? 0.006
          : input.gdpPerCapita > 30000
          ? 0.004
          : 0.002)
    );
  const ratioEVperCharger = dcCity > 0 ? Math.round(evsCity / dcCity) : 999;

  // ===== 1. DEMANDA (25%) =====

  const popScore =
    input.population > 2_000_000 ? 10 :
    input.population > 1_000_000 ? 9 :
    input.population > 500_000 ? 8 :
    input.population > 300_000 ? 7 :
    input.population > 200_000 ? 6 :
    input.population > 100_000 ? 5 :
    input.population > 50_000 ? 4 : 3;
  add(
    "Densidade Populacional",
    "Demanda",
    popScore,
    3,
    `${input.population.toLocaleString("pt-BR")} habitantes`,
    "IBGE"
  );

  const gdpScore =
    input.gdpPerCapita > 70_000 ? 10 :
    input.gdpPerCapita > 55_000 ? 9 :
    input.gdpPerCapita > 40_000 ? 8 :
    input.gdpPerCapita > 30_000 ? 7 :
    input.gdpPerCapita > 20_000 ? 5 : 3;
  add(
    "Poder Aquisitivo",
    "Demanda",
    gdpScore,
    3,
    `PIB per capita R$ ${Math.round(input.gdpPerCapita).toLocaleString("pt-BR")}`,
    "IBGE"
  );

  const evScore =
    evsCity > 30_000 ? 10 :
    evsCity > 15_000 ? 9 :
    evsCity > 8_000 ? 8 :
    evsCity > 3_000 ? 7 :
    evsCity > 1_000 ? 5 :
    evsCity > 500 ? 4 : 3;
  add(
    "Frota de Veículos Elétricos",
    "Demanda",
    evScore,
    3,
    `${evsCity.toLocaleString("pt-BR")} veículos eletrificados${
      input.abveEVs ? "" : " (estimativa)"
    }`,
    input.abveEVs ? "ABVE" : "Cálculo"
  );

  const appScore =
    input.population > 1_000_000 ? 9 :
    input.population > 500_000 ? 8 :
    input.population > 200_000 ? 6 :
    input.population > 100_000 ? 5 : 3;
  add(
    "Potencial Motoristas de App",
    "Demanda",
    appScore,
    2,
    input.population > 500_000
      ? "Alta concentração de motoristas Uber/99 em cidades acima de 500 mil hab."
      : "Concentração moderada de motoristas de app"
  );

  add(
    "Crescimento do Mercado EV",
    "Demanda",
    8,
    2,
    "Mercado nacional crescendo 26% ao ano, 778 mil veículos eletrificados no Brasil",
    "ABVE"
  );

  // ===== 2. CONCORRÊNCIA (25%) =====
  // Em pontos de alto fluxo (rodoviária, aeroporto, shopping, posto/hospital 24h),
  // 1-2 concorrentes próximos VALIDAM a demanda em vez de prejudicar o score.
  const highFlowTypes = [
    "rodoviaria",
    "aeroporto",
    "shopping",
    "posto_24h",
    "hospital_24h",
  ];
  const isHighFlow = highFlowTypes.includes(
    (input.establishmentType || "").toLowerCase()
  );

  const fmtNames = (names?: string[], max = 2): string => {
    if (!names || names.length === 0) return "";
    if (names.length <= max) return `: ${names.join("; ")}`;
    const extra = names.length - max;
    return `: ${names.slice(0, max).join("; ")} (+${extra})`;
  };

  // V6. Concorrência 200m
  if (isHighFlow) {
    const dc200 =
      input.dcIn200m === 0 ? 8 :
      input.dcIn200m <= 2 ? 9 :
      input.dcIn200m <= 4 ? 6 : 4;
    const just =
      input.dcIn200m === 0
        ? "Nenhum concorrente direto — oportunidade aberta em ponto de alto fluxo"
        : input.dcIn200m <= 2
        ? `${input.dcIn200m} carregador(es) rápido(s) em 200m — valida a demanda do local${fmtNames(input.dcNamesIn200m)}`
        : `${input.dcIn200m} carregadores rápidos em 200m — mercado validado mas disputado${fmtNames(input.dcNamesIn200m)}`;
    add("Validação de Demanda (200m)", "Concorrência", dc200, 3, just);
  } else {
    const dc200 =
      input.dcIn200m === 0 ? 10 :
      input.dcIn200m === 1 ? 5 :
      input.dcIn200m === 2 ? 3 : 1;
    add(
      "Concorrência Direta (200m)",
      "Concorrência",
      dc200,
      3,
      `${input.dcIn200m} carregadores rápidos em 200 metros${fmtNames(input.dcNamesIn200m)}`
    );
  }

  // Concorrência 500m
  if (isHighFlow) {
    const dc500 =
      input.dcIn500m === 0 ? 7 :
      input.dcIn500m <= 3 ? 9 :
      input.dcIn500m <= 6 ? 6 : 4;
    const just =
      input.dcIn500m === 0
        ? "Nenhum concorrente em 500m — oportunidade aberta em ponto de alto fluxo"
        : input.dcIn500m <= 3
        ? `${input.dcIn500m} carregador(es) rápido(s) em 500m — valida a demanda da região${fmtNames(input.dcNamesIn500m)}`
        : `${input.dcIn500m} carregadores rápidos em 500m — região validada mas disputada${fmtNames(input.dcNamesIn500m)}`;
    add("Validação de Demanda (500m)", "Concorrência", dc500, 3, just);
  } else {
    const dc500 =
      input.dcIn500m === 0 ? 10 :
      input.dcIn500m <= 2 ? 7 :
      input.dcIn500m <= 5 ? 5 : 3;
    add(
      "Concorrência Próxima (500m)",
      "Concorrência",
      dc500,
      3,
      `${input.dcIn500m} carregadores rápidos em 500 metros${fmtNames(input.dcNamesIn500m)}`
    );
  }

  // Concorrência 1km
  if (isHighFlow) {
    const dc1k =
      input.dcIn1km === 0 ? 6 :
      input.dcIn1km <= 5 ? 8 :
      input.dcIn1km <= 10 ? 6 : 4;
    const just =
      input.dcIn1km === 0
        ? "Nenhum concorrente em 1km — oportunidade aberta em ponto de alto fluxo"
        : input.dcIn1km <= 5
        ? `${input.dcIn1km} carregador(es) rápido(s) em 1km — valida a demanda regional${fmtNames(input.dcNamesIn1km)}`
        : `${input.dcIn1km} carregadores rápidos em 1km — região saturada${fmtNames(input.dcNamesIn1km)}`;
    add("Validação Regional (1km)", "Concorrência", dc1k, 2, just);
  } else {
    const dc1k =
      input.dcIn1km === 0 ? 9 :
      input.dcIn1km <= 3 ? 7 :
      input.dcIn1km <= 8 ? 5 : 3;
    add(
      "Concorrência Regional (1km)",
      "Concorrência",
      dc1k,
      2,
      `${input.dcIn1km} carregadores rápidos em 1 km${fmtNames(input.dcNamesIn1km)}`
    );
  }

  const dc2k =
    input.dcIn2km <= 2 ? 9 :
    input.dcIn2km <= 5 ? 7 :
    input.dcIn2km <= 10 ? 5 : 3;
  add(
    "Densidade Regional (2km)",
    "Concorrência",
    dc2k,
    2,
    `${input.dcIn2km} carregadores rápidos em 2 km${fmtNames(input.dcNamesIn2km)}`
  );

  const ratioScore =
    ratioEVperCharger > 200 ? 10 :
    ratioEVperCharger > 100 ? 9 :
    ratioEVperCharger > 50 ? 7 :
    ratioEVperCharger > 20 ? 5 :
    ratioEVperCharger > 10 ? 4 : 3;
  add(
    "Demanda vs Oferta",
    "Concorrência",
    ratioScore,
    3,
    `${ratioEVperCharger} veículos elétricos por carregador DC na cidade`
  );

  // ===== 3. LOCALIZAÇÃO (20%) =====

  const distScore =
    input.distanceToCenter < 1 ? 10 :
    input.distanceToCenter < 2 ? 9 :
    input.distanceToCenter < 3 ? 8 :
    input.distanceToCenter < 5 ? 7 :
    input.distanceToCenter < 8 ? 5 :
    input.distanceToCenter < 12 ? 4 : 2;
  add(
    "Proximidade ao Centro",
    "Localização",
    distScore,
    3,
    `${input.distanceToCenter.toFixed(1)} km do centro da cidade`
  );

  const visScore =
    input.totalPOIs > 25 ? 10 :
    input.totalPOIs > 15 ? 8 :
    input.totalPOIs > 8 ? 7 :
    input.totalPOIs > 3 ? 5 : 3;
  add(
    "Visibilidade e Fluxo",
    "Localização",
    visScore,
    3,
    `${input.totalPOIs} pontos de interesse em 500m indicam alto fluxo de pessoas`,
    "Google Places"
  );

  const gasScore =
    input.gasStations >= 3 ? 9 :
    input.gasStations >= 2 ? 8 :
    input.gasStations >= 1 ? 6 : 3;
  add(
    "Fluxo de Veículos",
    "Localização",
    gasScore,
    2,
    `${input.gasStations} postos de combustível em 500m — indicador de tráfego veicular`,
    "Google Places"
  );

  const parkScore =
    input.parkingLots >= 3 ? 9 :
    input.parkingLots >= 1 ? 7 : 4;
  add(
    "Infraestrutura de Estacionamento",
    "Localização",
    parkScore,
    1,
    `${input.parkingLots} estacionamentos em 500m`,
    "Google Places"
  );

  // ===== 4. AMENIDADES — TEMPO DE PERMANÊNCIA (15%) =====

  const restScore =
    input.restaurants >= 10 ? 10 :
    input.restaurants >= 5 ? 8 :
    input.restaurants >= 3 ? 7 :
    input.restaurants >= 1 ? 5 : 2;
  add(
    "Opções de Alimentação",
    "Amenidades",
    restScore,
    3,
    `${input.restaurants} restaurantes/cafés em 500m — favorece tempo de permanência para recarga`,
    "Google Places"
  );

  const supScore =
    input.supermarkets >= 3 ? 9 :
    input.supermarkets >= 1 ? 7 : 3;
  add(
    "Comércio Local",
    "Amenidades",
    supScore,
    2,
    `${input.supermarkets} supermercados em 500m`,
    "Google Places"
  );

  const shopScore =
    input.shoppings >= 2 ? 10 :
    input.shoppings >= 1 ? 8 : 3;
  add(
    "Centros Comerciais",
    "Amenidades",
    shopScore,
    2,
    `${input.shoppings} shoppings/centros comerciais em 1km`,
    "Google Places"
  );

  const hotelScore =
    input.hotels >= 3 ? 9 :
    input.hotels >= 1 ? 7 : 3;
  add(
    "Infraestrutura Hoteleira",
    "Amenidades",
    hotelScore,
    1,
    `${input.hotels} hotéis em 1km — indica demanda turística e pernoite`,
    "Google Places"
  );

  // ===== 5. TIPO DE PONTO (10%) =====

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
      "Aeroporto — máximo fluxo de veículos, alta visibilidade, operação 24h",
    rodoviaria:
      "Rodoviária — alto fluxo diário, ponto de parada natural, operação contínua",
    posto_24h:
      "Posto 24h — operação contínua, visibilidade, acesso fácil, público habituado a parar",
    shopping:
      "Shopping — alto tempo de permanência (1-3h), público com poder aquisitivo",
    hotel: "Hotel — pernoite permite carregamento longo, público turista",
    hospital_24h:
      "Hospital 24h — operação contínua, fluxo constante de visitantes",
    supermercado: "Supermercado — parada de 30-60min ideal para DC",
    estacionamento: "Estacionamento — infraestrutura existente, vagas disponíveis",
    universidade: "Universidade — público jovem, permanência de horas",
    terreno: "Terreno — flexibilidade de projeto, mas sem fluxo existente",
    restaurante: "Restaurante — tempo de permanência ideal (30-60min)",
    outro: "Tipo de estabelecimento genérico",
  };
  const tipoKey = (input.establishmentType || "outro").toLowerCase();
  const tipoScore = tipoScores[tipoKey] ?? 5;
  add(
    "Tipo de Estabelecimento",
    "Tipo de Ponto",
    tipoScore,
    3,
    tipoJustificativas[tipoKey] || "Tipo de estabelecimento informado",
    "Usuário"
  );

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
  add(
    "Potencial Operação Contínua",
    "Tipo de Ponto",
    opScore,
    2,
    opScore >= 9
      ? "Estabelecimento com operação contínua ou 24h"
      : "Operação limitada a horário comercial",
    "Usuário"
  );

  // ===== 6. OBSERVAÇÕES DO ANALISTA (5%) =====

  const obs = (input.observations || "").toLowerCase();
  const positives = [
    "24h",
    "avenida",
    "principal",
    "visibilidade",
    "frente",
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
    "próprio",
    "excelente",
    "ótimo",
    "premium",
    "nobre",
    "centro",
    "batel",
    "jardins",
    "leblon",
  ];
  const negatives = [
    "escuro",
    "perigoso",
    "difícil acesso",
    "rua estreita",
    "monofásico",
    "sem estacionamento",
    "longe",
    "afastado",
    "ruim",
    "pouco movimento",
  ];
  const posCount = positives.filter((p) => obs.includes(p)).length;
  const negCount = negatives.filter((n) => obs.includes(n)).length;
  const obsScore = clamp(5 + posCount * 2 - negCount * 2, 1, 10);
  const obsJust =
    obs.length > 0
      ? `Observações analisadas: ${posCount} fatores positivos, ${negCount} fatores de atenção`
      : "Sem observações adicionais";
  add("Observações do Analista", "Observações", obsScore, 2, obsJust, "Usuário");

  // ===== AGREGAÇÃO POR CATEGORIA =====

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

  // Score bruto: média ponderada das categorias (×10 → 0-100)
  let rawScore = 0;
  let totalCatWeight = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    rawScore += (categoryScores[cat] || 0) * 10 * (weight / 100);
    totalCatWeight += weight;
  }
  if (totalCatWeight !== 100) {
    // normaliza se algum dia mexerem nos pesos
    rawScore = (rawScore * 100) / totalCatWeight;
  }

  // City factor suave
  const pop = input.population || 200_000;
  const cityFactor =
    pop > 2_000_000 ? 1.0 :
    pop > 1_000_000 ? 0.98 :
    pop > 500_000 ? 0.94 :
    pop > 200_000 ? 0.88 :
    pop > 100_000 ? 0.82 : 0.75;

  const finalMultiplier = 0.85 + 0.15 * cityFactor;
  const overallScore = clamp(Math.round(rawScore * finalMultiplier), 0, 100);

  const classification =
    overallScore >= 85 ? "PREMIUM" :
    overallScore >= 70 ? "ESTRATÉGICO" :
    overallScore >= 55 ? "VIÁVEL" :
    overallScore >= 40 ? "MARGINAL" : "NÃO RECOMENDADO";

  return {
    overallScore,
    rawScore: Math.round(rawScore * 10) / 10,
    cityFactor,
    classification,
    variables: vars,
    categoryScores,
  };
}
