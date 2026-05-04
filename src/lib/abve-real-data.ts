export interface CityABVEData {
  city: string;
  state: string;
  ac: number;          // carregadores AC
  dc: number;          // carregadores DC
  total: number;       // carregadores total
  evsSold?: number;    // total EVs vendidos (BEV + PHEV + HEV/MHEV) 2022-2026
  bev?: number;        // 100% elétricos
  phev?: number;       // híbridos plug-in
  evsSource?: string;  // 'ABVE' ou 'Estimativa'
}

export const ABVE_CHARGERS_DATA: CityABVEData[] = [
  // TOP CIDADES BRASIL - Eletropostos com dados ABVE de EVs (BEV/PHEV)
  { city: 'São Paulo', state: 'SP', ac: 2011, dc: 402, total: 2413, evsSold: 92065, bev: 26699, phev: 31302, evsSource: 'ABVE' },
  { city: 'Rio de Janeiro', state: 'RJ', ac: 802, dc: 131, total: 933, evsSold: 29691, bev: 8610, phev: 10095, evsSource: 'ABVE' },
  { city: 'Brasília', state: 'DF', ac: 460, dc: 361, total: 821, evsSold: 57447, bev: 16660, phev: 19532, evsSource: 'ABVE' },
  { city: 'Curitiba', state: 'PR', ac: 305, dc: 199, total: 504, evsSold: 21921, bev: 6357, phev: 7453, evsSource: 'ABVE' },
  { city: 'Goiânia', state: 'GO', ac: 242, dc: 150, total: 392, evsSold: 12336, bev: 3577, phev: 4194, evsSource: 'ABVE' },
  { city: 'Fortaleza', state: 'CE', ac: 230, dc: 146, total: 376, evsSold: 11070, bev: 3210, phev: 3764, evsSource: 'ABVE' },
  { city: 'Porto Alegre', state: 'RS', ac: 232, dc: 103, total: 335, evsSold: 12539, bev: 3636, phev: 4263, evsSource: 'ABVE' },
  { city: 'Belo Horizonte', state: 'MG', ac: 206, dc: 105, total: 311, evsSold: 37879, bev: 10985, phev: 12879, evsSource: 'ABVE' },
  { city: 'Recife', state: 'PE', ac: 188, dc: 107, total: 295, evsSold: 11119, bev: 3225, phev: 3780, evsSource: 'ABVE' },
  { city: 'Campinas', state: 'SP', ac: 213, dc: 81, total: 294 },
  { city: 'Salvador', state: 'BA', ac: 200, dc: 77, total: 277, evsSold: 13082, bev: 3794, phev: 4448, evsSource: 'ABVE' },
  { city: 'Florianópolis', state: 'SC', ac: 220, dc: 53, total: 273, evsSold: 8355, bev: 2423, phev: 2841, evsSource: 'ABVE' },
  { city: 'Ribeirão Preto', state: 'SP', ac: 123, dc: 45, total: 168, evsSold: 6054, bev: 1756, phev: 2058, evsSource: 'ABVE' },
  { city: 'Natal', state: 'RN', ac: 103, dc: 56, total: 159 },
  { city: 'Maceió', state: 'AL', ac: 99, dc: 54, total: 153, evsSold: 6804, bev: 1973, phev: 2313, evsSource: 'ABVE' },
  { city: 'João Pessoa', state: 'PB', ac: 69, dc: 80, total: 149 },
  { city: 'Barueri', state: 'SP', ac: 112, dc: 26, total: 138 },
  { city: 'Maringá', state: 'PR', ac: 91, dc: 45, total: 136 },
  { city: 'Manaus', state: 'AM', ac: 67, dc: 63, total: 130, evsSold: 7735, bev: 2243, phev: 2630, evsSource: 'ABVE' },
  { city: 'Aracaju', state: 'SE', ac: 77, dc: 44, total: 121 },
  { city: 'Cuiabá', state: 'MT', ac: 81, dc: 37, total: 118, evsSold: 5844, bev: 1695, phev: 1987, evsSource: 'ABVE' },
  { city: 'São José dos Campos', state: 'SP', ac: 70, dc: 46, total: 116 },
  { city: 'Gramado', state: 'RS', ac: 95, dc: 15, total: 110 },
  { city: 'Joinville', state: 'SC', ac: 78, dc: 32, total: 110 },
  { city: 'Campo Grande', state: 'MS', ac: 69, dc: 37, total: 106 },
  { city: 'Balneário Camboriú', state: 'SC', ac: 86, dc: 17, total: 103 },
  { city: 'Belém', state: 'PA', ac: 52, dc: 41, total: 93 },
  { city: 'Uberlândia', state: 'MG', ac: 49, dc: 44, total: 93 },
  { city: 'Caxias do Sul', state: 'RS', ac: 49, dc: 43, total: 92 },
  { city: 'São Bernardo do Campo', state: 'SP', ac: 65, dc: 26, total: 91 },
  { city: 'São Luís', state: 'MA', ac: 36, dc: 54, total: 90 },
  { city: 'São José do Rio Preto', state: 'SP', ac: 64, dc: 23, total: 87 },
  { city: 'São José dos Pinhais', state: 'PR', ac: 41, dc: 45, total: 86 },
  { city: 'Teresina', state: 'PI', ac: 46, dc: 39, total: 85 },
  { city: 'Londrina', state: 'PR', ac: 48, dc: 36, total: 84 },
  { city: 'Cascavel', state: 'PR', ac: 51, dc: 31, total: 82 },
  { city: 'Vitória', state: 'ES', ac: 57, dc: 24, total: 81 },
  { city: 'Guarulhos', state: 'SP', ac: 59, dc: 21, total: 80 },
  { city: 'Contagem', state: 'MG', ac: 54, dc: 22, total: 76 },
  { city: 'Campos do Jordão', state: 'SP', ac: 70, dc: 3, total: 73 },
  { city: 'Foz do Iguaçu', state: 'PR', ac: 54, dc: 19, total: 73 },
  { city: 'Santo André', state: 'SP', ac: 49, dc: 23, total: 72 },
  { city: 'Campina Grande', state: 'PB', ac: 50, dc: 18, total: 68 },
  { city: 'Jundiaí', state: 'SP', ac: 43, dc: 18, total: 61 },
  { city: 'Juiz de Fora', state: 'MG', ac: 44, dc: 16, total: 60 },
  { city: 'Mogi das Cruzes', state: 'SP', ac: 42, dc: 17, total: 59 },
  { city: 'Santa Maria', state: 'RS', ac: 29, dc: 29, total: 58 },
  { city: 'São José', state: 'SC', ac: 38, dc: 20, total: 58 },
  { city: 'Passo Fundo', state: 'RS', ac: 29, dc: 28, total: 57 },
  { city: 'Piracicaba', state: 'SP', ac: 37, dc: 20, total: 57 },
  { city: 'Serra', state: 'ES', ac: 24, dc: 32, total: 56 },
  { city: 'Chapecó', state: 'SC', ac: 40, dc: 14, total: 54 },
  { city: 'Mossoró', state: 'RN', ac: 24, dc: 30, total: 54 },
  { city: 'Sorocaba', state: 'SP', ac: 36, dc: 14, total: 50 },
  { city: 'Indaiatuba', state: 'SP', ac: 35, dc: 10, total: 45 },
  { city: 'São Roque', state: 'SP', ac: 40, dc: 5, total: 45 },
  { city: 'Ponta Grossa', state: 'PR', ac: 31, dc: 17, total: 48 },
  { city: 'Caruaru', state: 'PE', ac: 22, dc: 23, total: 45 },
  { city: 'Jaboatão dos Guararapes', state: 'PE', ac: 13, dc: 30, total: 43 },
  { city: 'Santana de Parnaíba', state: 'SP', ac: 35, dc: 4, total: 39 },
  { city: 'São Caetano do Sul', state: 'SP', ac: 29, dc: 8, total: 37 },
  { city: 'Guarujá', state: 'SP', ac: 28, dc: 7, total: 35 },
  { city: 'São Sebastião', state: 'SP', ac: 32, dc: 3, total: 35 },
  { city: 'Limeira', state: 'SP', ac: 22, dc: 12, total: 34 },
  { city: 'Bertioga', state: 'SP', ac: 22, dc: 11, total: 33 },
  { city: 'Cotia', state: 'SP', ac: 25, dc: 7, total: 32 },
  { city: 'Osasco', state: 'SP', ac: 24, dc: 7, total: 31 },
  { city: 'Guarapuava', state: 'PR', ac: 22, dc: 9, total: 31 },
  { city: 'Itu', state: 'SP', ac: 19, dc: 11, total: 30 },
  { city: 'Olímpia', state: 'SP', ac: 28, dc: 2, total: 30 },
  { city: 'Pato Branco', state: 'PR', ac: 20, dc: 6, total: 26 },
  { city: 'Ipojuca', state: 'PE', ac: 20, dc: 5, total: 25 },
  { city: 'Toledo', state: 'PR', ac: 19, dc: 4, total: 23 },
  { city: 'Petrolina', state: 'PE', ac: 5, dc: 16, total: 21 },
  { city: 'Garanhuns', state: 'PE', ac: 8, dc: 6, total: 14 },
  { city: 'Olinda', state: 'PE', ac: 4, dc: 10, total: 14 },
  { city: 'Campo Largo', state: 'PR', ac: 12, dc: 4, total: 16 },
  { city: 'Umuarama', state: 'PR', ac: 4, dc: 12, total: 16 },
  { city: 'Apucarana', state: 'PR', ac: 8, dc: 7, total: 15 },
  { city: 'Cabo de Santo Agostinho', state: 'PE', ac: 6, dc: 6, total: 12 },
  { city: 'Arcoverde', state: 'PE', ac: 8, dc: 2, total: 10 },
];

// Dados nacionais ABVE (acumulado 2022 — março/2026)
export const ABVE_NATIONAL = {
  lastUpdate: '2026-03',
  totalVehicles: 778502,
  totalBEV: 200592,
  totalPHEV: 237717,
  totalHEV: 59230,
  totalBEVPHEV: 438309,  // BEV + PHEV = os que carregam na tomada
  marketSharePct: 2.16,
  totalChargers: 21061,
  totalAC: 14582,
  totalDC: 6479,
  growthRate: 0.26,       // 26% ao ano
  growthQ1_2026: 0.90,    // 90% jan-fev 2026
  // Mantidos para compatibilidade
  totalEVs: 778502,
  topModels: [
    { model: 'Toyota Cross XRX Hybrid', qty: 53099 },
    { model: 'BYD Dolphin Mini', qty: 50975 },
    { model: 'BYD Song Plus', qty: 46010 },
    { model: 'BYD Dolphin GS 180EV', qty: 34126 },
    { model: 'BYD Song Pro', qty: 32386 },
  ],
};

// Proporções nacionais (BEV/PHEV/HEV) usadas como fallback de breakdown
export const ABVE_BEV_RATIO = ABVE_NATIONAL.totalBEV / ABVE_NATIONAL.totalVehicles;       // ~0.258
export const ABVE_PHEV_RATIO = ABVE_NATIONAL.totalPHEV / ABVE_NATIONAL.totalVehicles;     // ~0.305
export const ABVE_PLUGIN_RATIO = ABVE_NATIONAL.totalBEVPHEV / ABVE_NATIONAL.totalVehicles; // ~0.563

// Dados por estado
export const ABVE_STATES: Record<string, { ac: number, dc: number, total: number, evsSold: number }> = {
  'SP': { ac: 4606, dc: 1270, total: 5876, evsSold: 92065 },
  'PR': { ac: 965, dc: 635, total: 1600, evsSold: 21921 },
  'PE': { ac: 360, dc: 257, total: 617, evsSold: 11119 },
};

// Buscar dados de uma cidade
export function getABVEData(city: string, state: string): CityABVEData | null {
  if (!city || !state) return null;

  // Normalizar input
  const normalizeStr = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const inputCity = normalizeStr(city);
  const inputState = state.trim().toUpperCase();

  // Se state veio como nome completo, converter pra sigla
  const stateMap: Record<string, string> = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
    'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO',
    'roraima': 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP',
    'sergipe': 'SE', 'tocantins': 'TO',
  };

  const normalizedStateName = normalizeStr(state);
  const stateCode = stateMap[normalizedStateName] || inputState.substring(0, 2);

  console.log('=== ABVE LOOKUP ===', 'city:', inputCity, 'state:', stateCode);

  const result = ABVE_CHARGERS_DATA.find(d => {
    const dCity = normalizeStr(d.city);
    const dState = d.state.toUpperCase();
    return dCity === inputCity && dState === stateCode;
  });

  if (result) {
    console.log('=== ABVE FOUND ===', result.city, result.state, 'DC:', result.dc, 'Total:', result.total);
    return result;
  }

  console.log('=== ABVE NOT FOUND ===', city, state, '- tentando busca parcial');

  // Busca parcial: se a cidade contém o input ou vice-versa
  const partial = ABVE_CHARGERS_DATA.find(d => {
    const dCity = normalizeStr(d.city);
    const dState = d.state.toUpperCase();
    return dState === stateCode && (dCity.includes(inputCity) || inputCity.includes(dCity));
  });

  if (partial) {
    console.log('=== ABVE PARTIAL MATCH ===', partial.city, partial.state);
    return partial;
  }

  return null;
}

export interface CityEVData {
  totalEVs: number;       // Total acumulado (BEV + PHEV + HEV/MHEV) ou estimativa
  bev: number;            // 100% elétricos
  phev: number;           // Híbridos plug-in
  bevPlusPHEV: number;    // BEV + PHEV = mercado real de eletropostos
  source: string;         // Origem do dado
  ratioEVperDC: number;   // BEV+PHEV por carregador DC (ideal IEA/AFIR: 10)
  dcChargers: number;     // DC ABVE (0 se cidade não está na base)
}

export function getCityEVData(
  city: string,
  state: string,
  population: number,
  gdpPerCapita: number
): CityEVData {
  const abve = getABVEData(city, state);

  if (abve && abve.evsSold) {
    const bev = abve.bev ?? Math.round(abve.evsSold * ABVE_BEV_RATIO);
    const phev = abve.phev ?? Math.round(abve.evsSold * ABVE_PHEV_RATIO);
    const bevPlusPHEV = bev + phev;
    return {
      totalEVs: abve.evsSold,
      bev,
      phev,
      bevPlusPHEV,
      source: 'ABVE fev/2026',
      ratioEVperDC: abve.dc > 0 ? Math.round(bevPlusPHEV / abve.dc) : 0,
      dcChargers: abve.dc,
    };
  }

  // Estimativa pra cidades sem dados ABVE (penetração total = BEV+PHEV+HEV)
  const penetration =
    gdpPerCapita > 60000 ? 0.006 :
    gdpPerCapita > 40000 ? 0.004 :
    gdpPerCapita > 25000 ? 0.002 : 0.001;
  const estimated = Math.round(population * penetration);
  const bev = Math.round(estimated * ABVE_BEV_RATIO);
  const phev = Math.round(estimated * ABVE_PHEV_RATIO);
  const bevPlusPHEV = bev + phev;
  const dc = abve ? abve.dc : 0;

  return {
    totalEVs: estimated,
    bev,
    phev,
    bevPlusPHEV,
    source: 'Estimativa baseada em população e PIB',
    ratioEVperDC: dc > 0 ? Math.round(bevPlusPHEV / dc) : 0,
    dcChargers: dc,
  };
}

// Teste de boot — confirma que SJC é encontrada na base
if (process.env.NODE_ENV !== 'production') {
  console.log(
    '=== TESTE SJC ===',
    ABVE_CHARGERS_DATA.find(
      d =>
        d.city.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() ===
          'sao jose dos campos' && d.state === 'SP'
    ) ?? null
  );
}
