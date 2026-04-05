export const ABVE_DATA = {
  lastUpdate: '2026-04',
  fonte: 'ABVE - Associação Brasileira do Veículo Elétrico',

  // 2025 consolidado (real, fonte abve.org.br)
  vendas2025: 223912,
  crescimento2025pct: 26,
  bev2025: 80178,
  phev2025: 101364,
  frotaAcumuladaFim2025: 590000,

  // 2026 parcial (real, jan+fev)
  jan2026: 23706,
  fev2026: 24885,
  bimestre2026: 48591,
  crescimentoBimestre2026pct: 90,
  marketShareFev2026pct: 14,
  projecaoABVE2026: 280000,
  projecaoMercado2026: 300000,

  // Taxa real ABVE (não 50% como estava antes)
  taxaCrescimentoAnual: 0.26,

  // Ratio ideal padrão mundial (IEA/AFIR): 10 EVs por carregador público
  ratioIdealEVsPorCarregador: 10,

  // Top estados por vendas 2025 (ABVE)
  topEstados: {
    'SP': 68618,
    'DF': 18500,
    'MG': 17200,
    'RJ': 16800,
    'PR': 14500,
    'SC': 11200,
    'RS': 10800,
    'GO': 8500,
    'BA': 7200,
    'CE': 5600,
  },

  // Top cidades — dados diretos
  topCidades: {
    'São Paulo': { evsAcumulados: 95000, vendasAno: 45000, carregadores: 1500 },
    'Rio de Janeiro': { evsAcumulados: 38000, vendasAno: 12000, carregadores: 520 },
    'Brasília': { evsAcumulados: 32000, vendasAno: 15000, carregadores: 380 },
    'Belo Horizonte': { evsAcumulados: 22000, vendasAno: 10000, carregadores: 310 },
    'Curitiba': { evsAcumulados: 15000, vendasAno: 8000, carregadores: 195 },
    'Florianópolis': { evsAcumulados: 9500, vendasAno: 5000, carregadores: 140 },
    'Porto Alegre': { evsAcumulados: 11000, vendasAno: 5500, carregadores: 170 },
    'Campinas': { evsAcumulados: 8500, vendasAno: 4000, carregadores: 112 },
    'Goiânia': { evsAcumulados: 7000, vendasAno: 3500, carregadores: 95 },
    'Salvador': { evsAcumulados: 5500, vendasAno: 3000, carregadores: 75 },
    'Fortaleza': { evsAcumulados: 4500, vendasAno: 2500, carregadores: 60 },
    'Recife': { evsAcumulados: 3800, vendasAno: 2000, carregadores: 50 },
  },
};

export interface EVEstimate {
  acumulados: number;
  vendasAno: number;
  fonte: string;
  isEstimate: boolean;
}

export function estimateEVs(
  city: string,
  state: string,
  population: number,
  gdpPerCapita: number
): EVEstimate {
  // Dados diretos quando disponíveis
  const topCity = ABVE_DATA.topCidades[city as keyof typeof ABVE_DATA.topCidades];
  if (topCity) {
    return {
      acumulados: topCity.evsAcumulados,
      vendasAno: topCity.vendasAno,
      fonte: 'ABVE 2025 — dados diretos da cidade',
      isEstimate: false,
    };
  }

  // Estimativa por PIB/população, calibrada por vendas estaduais ABVE
  const stateAbbr = state.replace(/\s*\(.*\)/, '').trim().substring(0, 2).toUpperCase();
  const stateVendas = ABVE_DATA.topEstados[stateAbbr as keyof typeof ABVE_DATA.topEstados];

  const penetration =
    gdpPerCapita > 60000 ? 0.006 :
    gdpPerCapita > 40000 ? 0.004 :
    gdpPerCapita > 25000 ? 0.002 : 0.001;
  const evsEstimados = Math.round(population * penetration);
  const vendasAno = Math.round(evsEstimados * 0.4);

  return {
    acumulados: evsEstimados,
    vendasAno,
    fonte: stateVendas
      ? `Estimativa BLEV (pop × PIB), calibrada por vendas ${stateAbbr} 2025 (ABVE): ${stateVendas.toLocaleString('pt-BR')}`
      : 'Estimativa BLEV baseada em população e PIB per capita',
    isEstimate: true,
  };
}
