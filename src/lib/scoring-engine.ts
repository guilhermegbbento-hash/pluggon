export interface ScoreVariable {
  name: string;
  category: string;
  score: number;
  weight: number;
  justification: string;
}

export interface ScoreResult {
  overallScore: number;
  classification: string;
  variables: ScoreVariable[];
}

export interface ScoreInput {
  // Cidade
  population: number;
  gdpPerCapita: number;
  // Ponto
  establishmentType: string;
  is24h: boolean;
  neighborhoodQuality: string; // premium, alto, medio, baixo
  // Concorrência
  chargersIn200m: number;
  chargersIn2km: number;
  dcChargersInCity: number;
  chargersInCity: number;
  // POIs no entorno
  restaurantsNearby: number;
  hospitalsNearby: number;
  shoppingNearby: number;
  gasStationsNearby: number;
  parkingNearby: number;
  // Google Places
  rating: number;
  reviews: number;
}

export function calculateScore(data: ScoreInput): ScoreResult {
  const vars: ScoreVariable[] = [];

  // ===== LOCALIZAÇÃO (40%) =====

  // Tipo de estabelecimento (peso 5)
  const typeMap: Record<string, number> = {
    posto_24h: 95,
    shopping: 90,
    rodoviaria: 88,
    aeroporto: 95,
    hospital_24h: 75,
    farmacia_24h: 70,
    supermercado: 75,
    atacadao: 70,
    hotel: 78,
    universidade: 72,
    academia: 65,
    estacionamento: 68,
    terreno: 60,
    restaurante: 65,
    concessionaria: 70,
    centro_comercial: 82,
    posto_combustivel: 80,
    outro: 55,
  };
  const typeScore = (typeMap[data.establishmentType] || 55) / 10;
  vars.push({
    name: "Tipo de Estabelecimento",
    category: "Localização",
    score: typeScore,
    weight: 5,
    justification: data.establishmentType,
  });

  // Operação 24h (peso 4)
  const h24 = data.is24h ? 10 : 4;
  vars.push({
    name: "Operação 24 horas",
    category: "Localização",
    score: h24,
    weight: 4,
    justification: data.is24h ? "Funciona 24h" : "Horário limitado",
  });

  // Qualidade do bairro (peso 4)
  const nbMap: Record<string, number> = {
    premium: 10,
    alto: 8,
    medio: 6,
    baixo: 3,
  };
  const nbScore = nbMap[data.neighborhoodQuality] || 6;
  vars.push({
    name: "Qualidade do Bairro/Região",
    category: "Localização",
    score: nbScore,
    weight: 4,
    justification: "Nível " + data.neighborhoodQuality,
  });

  // Amenidades no entorno (peso 3)
  const amenTotal =
    data.restaurantsNearby +
    data.shoppingNearby * 3 +
    data.hospitalsNearby * 2 +
    data.gasStationsNearby +
    data.parkingNearby;
  const amenScore = Math.min(10, Math.round(amenTotal * 0.8));
  vars.push({
    name: "Amenidades no Entorno",
    category: "Localização",
    score: amenScore,
    weight: 3,
    justification: `${data.restaurantsNearby} rest, ${data.shoppingNearby} shop, ${data.hospitalsNearby} hosp`,
  });

  // Rating do Google (peso 2)
  const ratingScore =
    data.rating >= 4.5
      ? 10
      : data.rating >= 4.0
        ? 8
        : data.rating >= 3.5
          ? 6
          : data.rating >= 3.0
            ? 4
            : 2;
  vars.push({
    name: "Avaliação no Google",
    category: "Localização",
    score: ratingScore,
    weight: 2,
    justification: `${data.rating}/5 (${data.reviews} avaliações)`,
  });

  // ===== MERCADO (35%) =====

  // População (peso 3)
  const popScore =
    data.population > 2000000
      ? 10
      : data.population > 1000000
        ? 9
        : data.population > 500000
          ? 8
          : data.population > 200000
            ? 6
            : data.population > 100000
              ? 5
              : 3;
  vars.push({
    name: "População",
    category: "Mercado",
    score: popScore,
    weight: 3,
    justification: data.population.toLocaleString("pt-BR") + " hab",
  });

  // PIB per capita (peso 4)
  const gdpScore =
    data.gdpPerCapita > 70000
      ? 10
      : data.gdpPerCapita > 50000
        ? 8
        : data.gdpPerCapita > 35000
          ? 7
          : data.gdpPerCapita > 25000
            ? 5
            : 3;
  vars.push({
    name: "PIB per Capita",
    category: "Mercado",
    score: gdpScore,
    weight: 4,
    justification: "R$ " + data.gdpPerCapita.toLocaleString("pt-BR"),
  });

  // Concorrência DIRETA (peso 4) - só conta se < 200m
  const cDirect = data.chargersIn200m || 0;
  const cDirectScore = cDirect === 0 ? 10 : cDirect === 1 ? 6 : cDirect <= 3 ? 3 : 1;
  vars.push({ name: 'Concorrência Direta (<200m)', category: 'Mercado', score: cDirectScore, weight: 4, justification: cDirect + ' carregadores a menos de 200m' });

  // Concorrência regional é INFORMATIVA, peso baixo (peso 1)
  const cRegional = data.chargersIn2km || 0;
  const cRegScore = cRegional === 0 ? 10 : cRegional <= 5 ? 8 : cRegional <= 10 ? 6 : 5;
  vars.push({ name: 'Densidade Regional (2km)', category: 'Mercado', score: cRegScore, weight: 1, justification: cRegional + ' na região - informativo' });

  // Saturação (EVs por carregador DC) (peso 4)
  const evPerDC =
    data.dcChargersInCity > 0
      ? Math.round((data.population * 0.003) / data.dcChargersInCity)
      : 999;
  const satScore =
    evPerDC > 200
      ? 10
      : evPerDC > 100
        ? 8
        : evPerDC > 50
          ? 6
          : evPerDC > 20
            ? 4
            : 2;
  vars.push({
    name: "Demanda vs Oferta",
    category: "Mercado",
    score: satScore,
    weight: 4,
    justification:
      evPerDC > 200
        ? "Demanda muito reprimida"
        : evPerDC > 100
          ? "Alta demanda"
          : "Mercado equilibrando",
  });

  // ===== INFRAESTRUTURA (25%) =====

  // Rede elétrica estimada pelo tipo (peso 3)
  const elecMap: Record<string, number> = {
    shopping: 10,
    aeroporto: 10,
    posto_24h: 8,
    supermercado: 8,
    hospital_24h: 9,
    universidade: 8,
    hotel: 7,
    estacionamento: 7,
    posto_combustivel: 7,
    terreno: 5,
    restaurante: 6,
    outro: 5,
  };
  const elecScore = elecMap[data.establishmentType] || 6;
  vars.push({
    name: "Infraestrutura Elétrica",
    category: "Infraestrutura",
    score: elecScore,
    weight: 3,
    justification: "Estimativa por tipo",
  });

  // Espaço/Estacionamento (peso 3)
  const spaceMap: Record<string, number> = {
    shopping: 10,
    aeroporto: 10,
    supermercado: 9,
    posto_24h: 8,
    estacionamento: 9,
    terreno: 8,
    universidade: 8,
    hotel: 7,
    hospital_24h: 6,
    posto_combustivel: 7,
    restaurante: 5,
    outro: 5,
  };
  const spaceScore = spaceMap[data.establishmentType] || 6;
  vars.push({
    name: "Espaço Físico",
    category: "Infraestrutura",
    score: spaceScore,
    weight: 3,
    justification: "Estimativa por tipo",
  });

  // Segurança (peso 3)
  const secMap: Record<string, number> = {
    shopping: 10,
    aeroporto: 10,
    hospital_24h: 8,
    universidade: 8,
    hotel: 9,
    posto_24h: 7,
    supermercado: 7,
    estacionamento: 7,
    posto_combustivel: 6,
    terreno: 4,
    restaurante: 6,
    outro: 5,
  };
  const secScore = secMap[data.establishmentType] || 5;
  vars.push({
    name: "Segurança",
    category: "Infraestrutura",
    score: secScore,
    weight: 3,
    justification: "Estimativa por tipo",
  });

  // CALCULAR SCORE FINAL
  let totalW = 0,
    maxW = 0;
  for (const v of vars) {
    totalW += v.score * v.weight;
    maxW += 10 * v.weight;
  }
  const overallScore = Math.round((totalW / maxW) * 100);

  // CALIBRAÇÃO REALISTA
  let calibrated = overallScore;

  // Posto 24h em cidade grande = mínimo 80
  if (['posto_24h', 'posto_combustivel'].includes(data.establishmentType) && data.is24h && popScore >= 7) {
    calibrated = Math.max(calibrated, 80);
  }

  // Bairro premium + cidade grande = bônus +8
  if (nbScore >= 9 && popScore >= 8) {
    calibrated = Math.min(100, calibrated + 8);
  }

  // Bairro alto + cidade grande = bônus +5
  if (nbScore >= 7 && popScore >= 7) {
    calibrated = Math.min(100, calibrated + 5);
  }

  // Sem concorrência direta (<200m) = bônus +5
  if (cDirect === 0) {
    calibrated = Math.min(100, calibrated + 5);
  }

  // Shopping em qualquer cidade grande = mínimo 82
  if (['shopping', 'centro_comercial'].includes(data.establishmentType) && popScore >= 7) {
    calibrated = Math.max(calibrated, 82);
  }

  // Aeroporto/Rodoviária = mínimo 85
  if (['aeroporto', 'rodoviaria'].includes(data.establishmentType)) {
    calibrated = Math.max(calibrated, 85);
  }

  // Terreno em cidade grande = mínimo 78
  if (data.establishmentType === 'terreno' && popScore >= 8) {
    calibrated = Math.max(calibrated, 78);
  }

  // Terreno em bairro premium de cidade grande = mínimo 85
  if (data.establishmentType === 'terreno' && nbScore >= 8 && popScore >= 8) {
    calibrated = Math.max(calibrated, 85);
  }

  // Qualquer tipo em bairro premium + cidade grande + sem concorrência direta = mínimo 83
  if (nbScore >= 9 && popScore >= 8 && (data.chargersIn200m || 0) === 0) {
    calibrated = Math.max(calibrated, 83);
  }

  const classification =
    calibrated >= 85
      ? "PREMIUM"
      : calibrated >= 70
        ? "ESTRATEGICO"
        : calibrated >= 55
          ? "VIAVEL"
          : calibrated >= 40
            ? "MARGINAL"
            : "REJEITADO";

  return { overallScore: calibrated, classification, variables: vars };
}
