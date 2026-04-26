import { getABVEData } from "@/lib/abve-real-data";

export type ScoreSource =
  | "ABVE"
  | "Google Places"
  | "IBGE"
  | "Cálculo"
  | "Usuário";

export interface ScoreInput {
  // Dados cidade
  city: string;
  state: string;
  population: number | null;
  gdpPerCapita: number | null;

  // Dados ABVE da cidade (se existir)
  abveDcCity: number | null;
  abveTotalCity: number | null;
  abveEvsSold: number | null;

  // Concorrência (Google Places)
  competitorsIn200m: number;
  competitorsIn500m: number;
  competitorsIn1km: number;
  competitorsIn2km: number;

  // POIs no entorno (Google Places)
  restaurantsIn500m: number;
  supermercadosIn500m: number;
  farmaciasIn500m: number;
  shoppingsIn1km: number;
  hospitaisIn1km: number;
  postosIn500m: number;
  hoteisIn1km: number;
  totalPoisIn500m: number;

  // Localização
  lat: number;
  lng: number;
  cityLat: number;
  cityLng: number;

  // Google Places do ponto
  rating: number;
  reviews: number;

  // Tipo / observações (usuário)
  establishmentType: string;
  is24h: boolean;
  observations: string;
}

export interface ScoreVariable {
  id: number;
  name: string;
  category: string;
  score: number; // 0-10
  weight: number; // 1, 2 ou 3
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

const CATEGORY_WEIGHTS: Record<string, number> = {
  CIDADE: 0.15,
  CONCORRENCIA: 0.20,
  ENTORNO: 0.18,
  LOCALIZACAO: 0.22,
  TIPO: 0.17,
  OBSERVACOES: 0.08,
};

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    justification: string,
    source: ScoreSource
  ) => {
    vars.push({
      id: id++,
      name,
      category,
      score: clamp(Math.round(score * 10) / 10, 0, 10),
      weight,
      justification,
      source,
    });
  };

  // Dados ABVE da cidade
  const abve = getABVEData(input.city, input.state);
  const abveDc = abve?.dc ?? input.abveDcCity;
  const abveEvs = abve?.evsSold ?? input.abveEvsSold;

  // ===== CATEGORIA 1: CIDADE (5 vars) =====
  // 1. População (peso 3) — IBGE
  if (input.population != null) {
    const pop = input.population;
    const popScore =
      pop > 2_000_000 ? 10 :
      pop > 1_000_000 ? 9 :
      pop > 500_000 ? 8 :
      pop > 200_000 ? 6 :
      pop > 100_000 ? 5 :
      pop > 50_000 ? 4 : 3;
    add(
      "População",
      "CIDADE",
      popScore,
      3,
      `${pop.toLocaleString("pt-BR")} habitantes (IBGE)`,
      "IBGE"
    );
  } else {
    add(
      "População",
      "CIDADE",
      5,
      3,
      "Sem dados IBGE para a cidade",
      "IBGE"
    );
  }

  // 2. PIB per capita (peso 3) — IBGE
  if (input.gdpPerCapita != null) {
    const g = input.gdpPerCapita;
    const gScore =
      g > 80_000 ? 10 :
      g > 60_000 ? 9 :
      g > 45_000 ? 8 :
      g > 30_000 ? 6 :
      g > 20_000 ? 4 : 3;
    add(
      "PIB per capita",
      "CIDADE",
      gScore,
      3,
      `R$ ${Math.round(g).toLocaleString("pt-BR")}/hab (IBGE)`,
      "IBGE"
    );
  } else {
    add(
      "PIB per capita",
      "CIDADE",
      5,
      3,
      "Sem dados IBGE para a cidade",
      "IBGE"
    );
  }

  // 3. EVs vendidos na cidade (peso 3) — ABVE
  if (abveEvs != null) {
    const e = abveEvs;
    const eScore =
      e > 50_000 ? 10 :
      e > 20_000 ? 9 :
      e > 10_000 ? 8 :
      e > 5_000 ? 6 :
      e > 2_000 ? 4 : 3;
    add(
      "EVs vendidos na cidade",
      "CIDADE",
      eScore,
      3,
      `${e.toLocaleString("pt-BR")} EVs vendidos 2022-2026 (ABVE)`,
      "ABVE"
    );
  } else {
    add(
      "EVs vendidos na cidade",
      "CIDADE",
      5,
      3,
      "Cidade sem dados ABVE — usar referência estadual",
      "ABVE"
    );
  }

  // 4. Total carregadores DC na cidade (peso 3) — ABVE
  if (abveDc != null) {
    const d = abveDc;
    // Quanto MAIS DC, MENOR a oportunidade de novo DC (saturação)
    const dScore =
      d < 5 ? 10 :
      d < 15 ? 9 :
      d < 40 ? 7 :
      d < 100 ? 5 :
      d < 200 ? 4 : 3;
    add(
      "Total Carregadores DC na Cidade",
      "CIDADE",
      dScore,
      3,
      `${d} carregadores DC na cidade (ABVE fev/2026)`,
      "ABVE"
    );
  } else {
    add(
      "Total Carregadores DC na Cidade",
      "CIDADE",
      6,
      3,
      "Cidade sem dados ABVE",
      "ABVE"
    );
  }

  // 5. Ratio EVs/carregador DC (peso 3) — Cálculo ABVE
  if (abveEvs != null && abveDc != null && abveDc > 0) {
    const ratio = Math.round(abveEvs / abveDc);
    // Quanto MAIOR o ratio, MAIS demanda reprimida
    const rScore =
      ratio > 500 ? 10 :
      ratio > 200 ? 9 :
      ratio > 100 ? 8 :
      ratio > 50 ? 6 :
      ratio > 20 ? 4 : 3;
    add(
      "Ratio EVs/Carregador DC",
      "CIDADE",
      rScore,
      3,
      `${ratio} EVs por carregador DC na cidade (referência IEA: 10/1)`,
      "Cálculo"
    );
  } else {
    add(
      "Ratio EVs/Carregador DC",
      "CIDADE",
      5,
      3,
      "Sem dados ABVE para calcular",
      "Cálculo"
    );
  }

  // ===== CATEGORIA 2: CONCORRÊNCIA (5 vars) =====
  // 6. DC na cidade (peso 3)
  if (abveDc != null) {
    const d = abveDc;
    const dScore =
      d < 5 ? 10 :
      d <= 15 ? 8 :
      d <= 50 ? 7 :
      d <= 100 ? 6 :
      d <= 200 ? 5 : 4;
    add(
      "DC na Cidade (Saturação)",
      "CONCORRENCIA",
      dScore,
      3,
      `${d} carregadores rápidos identificados na cidade`,
      "ABVE"
    );
  } else {
    add(
      "DC na Cidade (Saturação)",
      "CONCORRENCIA",
      6,
      3,
      "Sem inventário de carregadores rápidos disponível para a cidade",
      "ABVE"
    );
  }

  // 7. Concorrentes 200m (peso 3) — Google Places
  {
    const c = input.competitorsIn200m;
    const s = c === 0 ? 10 : c === 1 ? 5 : c === 2 ? 3 : 1;
    add(
      "Concorrentes em 200m",
      "CONCORRENCIA",
      s,
      3,
      `${c} carregadores em 200m`,
      "Google Places"
    );
  }

  // 8. Concorrentes 500m (peso 3) — Google Places
  {
    const c = input.competitorsIn500m;
    const s = c === 0 ? 9 : c <= 2 ? 7 : c <= 5 ? 5 : c <= 10 ? 3 : 1;
    add(
      "Concorrentes em 500m",
      "CONCORRENCIA",
      s,
      3,
      `${c} carregadores em 500m`,
      "Google Places"
    );
  }

  // 9. Concorrentes 1km (peso 2) — Google Places
  {
    const c = input.competitorsIn1km;
    const s = c === 0 ? 10 : c <= 3 ? 8 : c <= 8 ? 6 : c <= 15 ? 4 : 2;
    add(
      "Concorrentes em 1km",
      "CONCORRENCIA",
      s,
      2,
      `${c} carregadores em 1km (Google Places)`,
      "Google Places"
    );
  }

  // 10. Concorrentes 2km (peso 2) — Google Places
  {
    const c = input.competitorsIn2km;
    const s = c === 0 ? 10 : c <= 5 ? 8 : c <= 15 ? 6 : c <= 30 ? 4 : 2;
    add(
      "Concorrentes em 2km",
      "CONCORRENCIA",
      s,
      2,
      `${c} carregadores em 2km (Google Places)`,
      "Google Places"
    );
  }

  // ===== CATEGORIA 3: ENTORNO (8 vars) =====
  // 11. Restaurantes 500m (peso 2)
  {
    const c = input.restaurantsIn500m;
    const s = c >= 10 ? 10 : c >= 5 ? 8 : c >= 3 ? 6 : c >= 1 ? 4 : 2;
    add(
      "Restaurantes em 500m",
      "ENTORNO",
      s,
      2,
      `${c} restaurantes (Google Places)`,
      "Google Places"
    );
  }

  // 12. Supermercados 500m (peso 2)
  {
    const c = input.supermercadosIn500m;
    const s = c >= 3 ? 10 : c === 2 ? 8 : c === 1 ? 6 : 3;
    add(
      "Supermercados em 500m",
      "ENTORNO",
      s,
      2,
      `${c} supermercados (Google Places)`,
      "Google Places"
    );
  }

  // 13. Farmácias 500m (peso 1)
  {
    const c = input.farmaciasIn500m;
    const s = c >= 3 ? 10 : c === 2 ? 7 : c === 1 ? 5 : 2;
    add(
      "Farmácias em 500m",
      "ENTORNO",
      s,
      1,
      `${c} farmácias (Google Places)`,
      "Google Places"
    );
  }

  // 14. Shoppings 1km (peso 2)
  {
    const c = input.shoppingsIn1km;
    const s = c >= 2 ? 10 : c === 1 ? 8 : 3;
    add(
      "Shoppings em 1km",
      "ENTORNO",
      s,
      2,
      `${c} shoppings (Google Places)`,
      "Google Places"
    );
  }

  // 15. Hospitais 1km (peso 2)
  {
    const c = input.hospitaisIn1km;
    const s = c >= 2 ? 10 : c === 1 ? 7 : 3;
    add(
      "Hospitais em 1km",
      "ENTORNO",
      s,
      2,
      `${c} hospitais (Google Places)`,
      "Google Places"
    );
  }

  // 16. Postos combustível 500m (peso 2)
  {
    const c = input.postosIn500m;
    const s = c >= 3 ? 10 : c === 2 ? 8 : c === 1 ? 6 : 2;
    add(
      "Postos de Combustível em 500m",
      "ENTORNO",
      s,
      2,
      `${c} postos (Google Places)`,
      "Google Places"
    );
  }

  // 17. Hotéis 1km (peso 1)
  {
    const c = input.hoteisIn1km;
    const s = c >= 3 ? 10 : c === 2 ? 7 : c === 1 ? 5 : 2;
    add(
      "Hotéis em 1km",
      "ENTORNO",
      s,
      1,
      `${c} hotéis (Google Places)`,
      "Google Places"
    );
  }

  // 18. Total POIs 500m (peso 2)
  {
    const c = input.totalPoisIn500m;
    const s =
      c >= 30 ? 10 :
      c >= 20 ? 8 :
      c >= 10 ? 6 :
      c >= 5 ? 4 : 2;
    add(
      "Total POIs em 500m",
      "ENTORNO",
      s,
      2,
      `${c} pontos de interesse (Google Places)`,
      "Google Places"
    );
  }

  // ===== CATEGORIA 4: LOCALIZAÇÃO (3 vars) =====
  // 19. Distância ao centro (peso 3)
  const distKm = haversineKm(input.lat, input.lng, input.cityLat, input.cityLng);
  {
    const s =
      distKm < 1 ? 10 :
      distKm < 2 ? 9 :
      distKm < 3 ? 8 :
      distKm < 5 ? 7 :
      distKm < 8 ? 6 :
      distKm < 12 ? 4 : 2;
    add(
      "Distância ao Centro",
      "LOCALIZACAO",
      s,
      3,
      `${distKm.toFixed(1)} km do centro da cidade (cálculo haversine)`,
      "Cálculo"
    );
  }

  // 20. Rating Google (peso 2)
  if (input.rating > 0) {
    const r = input.rating;
    const s =
      r >= 4.5 ? 10 :
      r >= 4.0 ? 8 :
      r >= 3.5 ? 6 :
      r >= 3.0 ? 4 : 2;
    add(
      "Rating Google",
      "LOCALIZACAO",
      s,
      2,
      `Rating ${r.toFixed(1)} (Google Places)`,
      "Google Places"
    );
  } else {
    add(
      "Rating Google",
      "LOCALIZACAO",
      5,
      2,
      "Sem rating disponível no Google Places",
      "Google Places"
    );
  }

  // 21. Reviews Google (peso 1)
  {
    const r = input.reviews;
    const s =
      r >= 500 ? 10 :
      r >= 100 ? 8 :
      r >= 50 ? 6 :
      r >= 10 ? 4 : 2;
    add(
      "Reviews Google",
      "LOCALIZACAO",
      s,
      1,
      `${r} reviews (Google Places)`,
      "Google Places"
    );
  }

  // ===== CATEGORIA 5: TIPO ESTABELECIMENTO (3 vars) =====
  // 22. Adequação do tipo (peso 3)
  const tipoMap: Record<string, number> = {
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
  const tipoKey = (input.establishmentType || "outro").toLowerCase();
  const tipoScore = tipoMap[tipoKey] ?? 5;
  add(
    "Adequação do Tipo",
    "TIPO",
    tipoScore,
    3,
    `Tipo "${input.establishmentType || "outro"}" — score ${tipoScore}/10`,
    "Usuário"
  );

  // 23. Potencial operação contínua (peso 3)
  const operacaoMap: Record<string, number> = {
    posto_24h: 10,
    aeroporto: 10,
    hospital_24h: 10,
    hotel: 9,
    rodoviaria: 9,
    shopping: 7,
    supermercado: 7,
    estacionamento: 6,
    universidade: 4,
    restaurante: 5,
    terreno: 5,
    outro: 4,
  };
  let operacaoScore: number;
  let operacaoJust: string;
  if (input.is24h) {
    operacaoScore = 10;
    operacaoJust = "Operação 24h confirmada";
  } else {
    operacaoScore = operacaoMap[tipoKey] ?? 4;
    if (operacaoScore >= 9) operacaoJust = "Operação 24h típica do segmento";
    else if (operacaoScore >= 7) operacaoJust = "Operação semi-contínua (estendida)";
    else if (operacaoScore >= 5) operacaoJust = "Operação comercial padrão";
    else operacaoJust = "Operação restrita";
  }
  add(
    "Potencial Operação Contínua",
    "TIPO",
    operacaoScore,
    3,
    operacaoJust,
    "Usuário"
  );

  // 24. Tempo permanência (peso 2)
  const permanenciaMap: Record<string, number> = {
    shopping: 10,
    hotel: 10,
    restaurante: 9,
    aeroporto: 9,
    universidade: 9,
    rodoviaria: 8,
    hospital_24h: 8,
    estacionamento: 8,
    supermercado: 7,
    posto_24h: 6,
    terreno: 5,
  };
  const permScore = permanenciaMap[tipoKey] ?? 5;
  add(
    "Tempo de Permanência",
    "TIPO",
    permScore,
    2,
    `Tempo típico no tipo "${input.establishmentType || "outro"}" — score ${permScore}/10`,
    "Usuário"
  );

  // ===== CATEGORIA 6: OBSERVAÇÕES (1 var) =====
  // 25. Análise de texto (peso 2)
  const obs = (input.observations || "").toLowerCase();
  let obsScore = 5;
  const matchedPos: string[] = [];
  const matchedNeg: string[] = [];
  const positivas = [
    "rodovia",
    "br-",
    "transformador",
    "energia trifásica",
    "trifasica",
    "trifásica",
    "estacionamento",
    "movimento",
    "fluxo",
    "24h",
    "24 horas",
    "vagas",
    "câmera",
    "camera",
    "segurança",
    "seguranca",
    "iluminação",
    "iluminacao",
    "avenida principal",
    "esquina",
    "frente",
    "visível",
    "visivel",
    "próprio",
    "proprio",
    "parceria",
    "subestação",
    "subestacao",
  ];
  const negativas = [
    "rua sem saída",
    "sem saida",
    "violência",
    "violencia",
    "perigoso",
    "abandonado",
    "alagamento",
    "enchente",
    "rede precária",
    "precaria",
    "monofásico",
    "monofasico",
    "sem energia",
    "obras",
    "interditado",
    "longe",
    "isolado",
    "deserto",
  ];
  for (const k of positivas) {
    if (obs.includes(k)) {
      obsScore += 0.7;
      matchedPos.push(k);
    }
  }
  for (const k of negativas) {
    if (obs.includes(k)) {
      obsScore -= 1.0;
      matchedNeg.push(k);
    }
  }
  obsScore = clamp(obsScore, 0, 10);
  let obsJust: string;
  if (!obs.trim()) {
    obsJust = "Sem observações fornecidas";
  } else {
    const parts: string[] = [];
    if (matchedPos.length)
      parts.push(`+${matchedPos.length} positivas: ${matchedPos.slice(0, 3).join(", ")}`);
    if (matchedNeg.length)
      parts.push(`-${matchedNeg.length} negativas: ${matchedNeg.slice(0, 3).join(", ")}`);
    obsJust = parts.length
      ? parts.join(" | ")
      : "Observação fornecida sem palavras-chave reconhecidas";
  }
  add("Análise de Observações", "OBSERVACOES", obsScore, 2, obsJust, "Usuário");

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
  for (const [cat, w] of Object.entries(CATEGORY_WEIGHTS)) {
    rawScore += (categoryScores[cat] || 0) * 10 * w;
  }

  // City factor
  const pop = input.population ?? 200_000;
  const cityFactor =
    pop > 2_000_000 ? 1.00 :
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
