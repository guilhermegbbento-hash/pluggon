/**
 * ÚNICO lugar com os parâmetros de escopo do Mapa de Calor.
 *
 * Raio por modo, tipos válidos por camada, regras de dedupe, sinal de terminal
 * e regra da zona de influência ficam aqui. Nenhuma camada define os próprios
 * limites. Nada aqui pode citar bairro, cidade ou lugar específico: as regras
 * valem para qualquer pesquisa no Brasil.
 */

import type { DiscardReason, LayerKey, ScopeMode } from "./types";

// ---------- Escopo ----------

export interface RadiusRule {
  minRadiusM: number;
  maxRadiusM: number;
  /** Só quando o geocoding não devolve `bounds` (resultado pontual). */
  fallbackRadiusM: number;
}

export const SCOPE_RULES: Record<ScopeMode, RadiusRule> = {
  // maxRadiusM no modo bairro é TETO DE SANIDADE, não corte: o raio cobre o
  // bairro inteiro (maior distância do centro aos cantos do retângulo) e, se
  // precisar de mais que isso, a análise aborta sugerindo o modo cidade.
  bairro: { minRadiusM: 1500, maxRadiusM: 15000, fallbackRadiusM: 2000 },
  cidade: { minRadiusM: 5000, maxRadiusM: 20000, fallbackRadiusM: 15000 },
};

export const MAX_AREAS = 3;

export const GEOCODE_RULES = {
  /** Tipos de resultado aceitos como bairro/região. */
  areaResultTypes: [
    "neighborhood",
    "sublocality",
    "sublocality_level_1",
    "sublocality_level_2",
    "sublocality_level_3",
    "sublocality_level_4",
    "sublocality_level_5",
  ],
  /** Aceitos só quando vêm com `bounds` reais (senão o centro é um ponto arbitrário). */
  areaResultTypesRequiringBounds: ["colloquial_area"],
  /** Tipos aceitos como município. */
  cityResultTypes: ["locality", "administrative_area_level_2"],
  /** Similaridade mínima entre o bairro pedido e o nome devolvido pelo geocoding. */
  minAreaNameSimilarity: 0.8,
};

// ---------- Camadas ----------

/** Sinal de equipamento de verdade (terminal, aeroporto) — não basta o tipo aparecer em `types`. */
export interface FacilitySignalRule {
  /** Porte: avaliações mínimas para contar sem outros sinais. */
  minUserRatingCount: number;
  /** Presença de qualquer um destes campos indica operação. Vazio = só porte vale. */
  operatorFields: ("website" | "phone" | "openingHours")[];
  /** Motivo registrado no relatório de descartes. */
  discardReason: DiscardReason;
}

export interface PlaceTypeSpec {
  key: string;
  layer: LayerKey;
  label: string;
  emoji: string;
  /** Tipo enviado à Places API (New) com strictTypeFiltering. */
  includedType: string;
  textQueries: string[];
  /** O ponto só entra se `types` contiver ao menos um destes. */
  validTypes: string[];
  /** Equipamentos grandes: dedupe por proximidade usa distância maior (sempre com nome similar). */
  largeFootprint: boolean;
  /** Complementa a busca por texto com searchNearby ordenado por distância. */
  useNearbySearch: boolean;
  /**
   * "obrigatoria": subdivide a busca em quadrantes até nenhuma célula voltar no
   * teto da API; se ainda assim alguma voltar cheia, o QA gate aborta o relatório.
   * "melhor_esforco" (padrão): uma busca por área, teto sinalizado no relatório.
   */
  completeness?: "obrigatoria" | "melhor_esforco";
  /** `primaryType` precisa estar em validTypes. */
  requirePrimaryType?: boolean;
  facilitySignal?: FacilitySignalRule;
  /** Campos extras no FieldMask, só para quem precisa. */
  extraFields?: string[];
}

export const PLACE_TYPE_SPECS: PlaceTypeSpec[] = [
  // Âncoras — mesma busca, mesmo raio e mesma validação em qualquer modo.
  {
    key: "gas_station",
    layer: "anchor",
    label: "Posto de combustível",
    emoji: "⛽",
    includedType: "gas_station",
    textQueries: ["posto de combustível"],
    validTypes: ["gas_station"],
    largeFootprint: false,
    useNearbySearch: false,
    // Âncora é o que o mapa promete apontar: escolher as melhores dentro de um
    // conjunto cortado pelo teto da API esconderia justamente o melhor ponto.
    completeness: "obrigatoria",
    // Piso baixo de propósito: quem derruba posto vazio é a régua, não ele.
    // Serve só para tirar registro fantasma — "Branca", "Raizen" sem nenhuma
    // avaliação, que na calibração apareceram às dezenas.
    facilitySignal: {
      minUserRatingCount: 3,
      operatorFields: [],
      discardReason: "posto_sem_porte",
    },
  },
  {
    key: "shopping_mall",
    layer: "anchor",
    label: "Shopping",
    emoji: "🏬",
    includedType: "shopping_mall",
    textQueries: ["shopping center"],
    validTypes: ["shopping_mall"],
    largeFootprint: true,
    useNearbySearch: false,
    completeness: "obrigatoria",
    // O Google tipa como shopping_mall qualquer galeria de rua, sala comercial
    // e quiosque. Shopping de verdade tem milhares de avaliações; a menor
    // galeria observada na calibração tinha 97. Com 100, nenhum shopping real
    // chegou perto de cair — o menor deles tinha mais de mil.
    facilitySignal: {
      minUserRatingCount: 100,
      operatorFields: [],
      discardReason: "shopping_sem_porte",
    },
  },
  {
    key: "bus_station",
    layer: "anchor",
    label: "Terminal rodoviário",
    emoji: "🚌",
    includedType: "bus_station",
    textQueries: ["terminal rodoviário"],
    validTypes: ["bus_station"],
    largeFootprint: true,
    useNearbySearch: false,
    completeness: "obrigatoria",
    // O Google tipa ponto de ônibus de rua como bus_station. Terminal de verdade
    // tem porte (avaliações) ou dados de operação; ponto de rua não tem nenhum.
    facilitySignal: {
      minUserRatingCount: 100,
      operatorFields: ["website", "phone", "openingHours"],
      discardReason: "ponto_de_onibus_sem_sinal_de_terminal",
    },
    extraFields: ["places.websiteUri", "places.nationalPhoneNumber", "places.regularOpeningHours"],
  },
  {
    key: "airport",
    layer: "anchor",
    label: "Aeroporto",
    emoji: "✈️",
    includedType: "airport",
    textQueries: ["aeroporto"],
    validTypes: ["airport", "international_airport"],
    largeFootprint: true,
    useNearbySearch: false,
    completeness: "obrigatoria",
    // O Google põe `airport` em types de heliporto, traslado, estacionamento e
    // loja de aeroporto. O tipo principal separa os primeiros; o porte, o resto.
    requirePrimaryType: true,
    facilitySignal: {
      minUserRatingCount: 100,
      operatorFields: [],
      discardReason: "aeroporto_sem_porte",
    },
  },
  {
    key: "hospital",
    layer: "anchor",
    label: "Hospital",
    emoji: "🏥",
    includedType: "hospital",
    textQueries: ["hospital"],
    validTypes: ["hospital"],
    largeFootprint: true,
    useNearbySearch: false,
    completeness: "obrigatoria",
    // O tipo `hospital` do Google engloba clínica, laboratório e consultório, que
    // aparecem às centenas em bairro denso. Hospital de verdade — carro parado
    // por horas, acompanhante, plantonista, visita — tem milhares de avaliações;
    // clínica de rua tem dezenas. Piso mais alto que o de rodoviária e aeroporto
    // (100) por isso. Número a calibrar com os dados da próxima regressão.
    facilitySignal: {
      minUserRatingCount: 200,
      operatorFields: [],
      discardReason: "hospital_sem_porte",
    },
  },

  // Complementares
  { key: "pharmacy", layer: "complementary", label: "Farmácia", emoji: "", includedType: "pharmacy", textQueries: ["farmácia"], validTypes: ["pharmacy", "drugstore"], largeFootprint: false, useNearbySearch: false },
  { key: "bakery", layer: "complementary", label: "Padaria", emoji: "", includedType: "bakery", textQueries: ["padaria"], validTypes: ["bakery"], largeFootprint: false, useNearbySearch: false },
  { key: "parking", layer: "complementary", label: "Estacionamento", emoji: "", includedType: "parking", textQueries: ["estacionamento"], validTypes: ["parking", "parking_lot", "parking_garage"], largeFootprint: false, useNearbySearch: false },
  { key: "supermarket", layer: "complementary", label: "Supermercado", emoji: "", includedType: "supermarket", textQueries: ["supermercado"], validTypes: ["supermarket", "hypermarket"], largeFootprint: false, useNearbySearch: false },
  { key: "restaurant", layer: "complementary", label: "Restaurante", emoji: "", includedType: "restaurant", textQueries: ["restaurante"], validTypes: ["restaurant"], largeFootprint: false, useNearbySearch: false },
  { key: "lodging", layer: "complementary", label: "Hotel", emoji: "", includedType: "lodging", textQueries: ["hotel"], validTypes: ["lodging", "hotel"], largeFootprint: false, useNearbySearch: false },
  { key: "university", layer: "complementary", label: "Universidade", emoji: "", includedType: "university", textQueries: ["universidade"], validTypes: ["university"], largeFootprint: false, useNearbySearch: false },
  { key: "convenience_store", layer: "complementary", label: "Loja de conveniência", emoji: "", includedType: "convenience_store", textQueries: ["loja de conveniência"], validTypes: ["convenience_store"], largeFootprint: false, useNearbySearch: false },
  { key: "gym", layer: "complementary", label: "Academia", emoji: "", includedType: "gym", textQueries: ["academia"], validTypes: ["gym", "fitness_center"], largeFootprint: false, useNearbySearch: false },

  // Concorrentes
  {
    key: "electric_vehicle_charging_station",
    layer: "competitor",
    label: "Eletroposto",
    emoji: "🔌",
    includedType: "electric_vehicle_charging_station",
    textQueries: ["eletroposto", "carregador de veículo elétrico"],
    validTypes: ["electric_vehicle_charging_station"],
    largeFootprint: false,
    // Busca por texto depende de relevância e perde eletroposto sem "eletroposto" no nome.
    useNearbySearch: true,
    // Camada cortada pelo teto da API vira praça falsamente vazia: completa ou não sai.
    completeness: "obrigatoria",
    extraFields: ["places.evChargeOptions"],
  },
];

export function specsForLayer(layer: LayerKey): PlaceTypeSpec[] {
  return PLACE_TYPE_SPECS.filter((s) => s.layer === layer);
}

export function specByKey(key: string): PlaceTypeSpec | undefined {
  return PLACE_TYPE_SPECS.find((s) => s.key === key);
}

export const SEARCH_RULES = {
  pageSize: 20,
  /** 3 páginas = 60 resultados, o máximo da searchText. Além disso marca `truncated`. */
  maxPagesPerQuery: 3,
  /** searchNearby não pagina: 20 é o teto da API. */
  nearbyMaxResults: 20,
  /** Subdivisão em quadrantes (specs obrigatórias) enquanto uma célula voltar no teto. */
  subdivision: { maxDepth: 6, minCellHalfDiagonalM: 100 },
  languageCode: "pt-BR",
  regionCode: "BR",
  baseFields: [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.types",
    "places.primaryType",
    "places.businessStatus",
    "places.userRatingCount",
  ],
};

// ---------- Dedupe ----------

export const DEDUPE_RULES = {
  distanceM: 50,
  /** Só para specs com largeFootprint — e SEMPRE junto com nome similar, nunca distância pura. */
  largeFootprintDistanceM: 300,
  /**
   * Nome de um contido no do outro (todas as palavras do núcleo do menor
   * aparecem no maior) a até esta distância, dentro da mesma camada. Pega
   * registro por plataforma do mesmo terminal.
   */
  containmentDistanceM: 50,
  /**
   * Trigram Dice sobre o núcleo do nome (sem acento, preposições e palavras de
   * categoria). Calibrado em 2026-09-14: dois shoppings distintos a 93 m
   * deram 0,50 (precisam sobreviver); três registros do mesmo terminal a
   * 110–206 m deram 1,00 (precisam colapsar).
   */
  nameSimilarityThreshold: 0.8,
  /** Na colisão entre camadas, fica a de maior prioridade. */
  layerPriority: ["competitor", "anchor", "complementary"] as LayerKey[],
  stopwords: ["de", "do", "da", "dos", "das", "e", "o", "a", "os", "as", "em", "no", "na"],
  /** Palavras genéricas de categoria, removidas antes de comparar nomes. */
  categoryWords: [
    "shopping", "center", "centre", "mall",
    "terminal", "term", "rodoviario", "rodoviaria", "rodoferroviaria", "estacao", "onibus",
    "aeroporto", "internacional", "interestadual", "intermunicipal",
    "posto", "auto",
  ],
};

// ---------- Seleção de complementares e zona de influência ----------

export const COMPLEMENTARY_SELECTION = {
  maxDistanceToAnchorM: 500,
  maxPerAnchor: 5,
};

export const INFLUENCE_RULES = {
  outerRings: [
    { radiusM: 500, opacity: 0.06 },
    { radiusM: 350, opacity: 0.12 },
  ],
  innerOpacity: 0.25,
  baseInnerM: 250,
  /** Complementar próximo AUMENTA a zona. */
  complementaryRadiusM: 300,
  perComplementaryM: 15,
  maxComplementaryBonusM: 100,
  /** Concorrente próximo DIMINUI a zona. */
  competitorRadiusM: 1000,
  perCompetitorM: 25,
  maxCompetitorPenaltyM: 100,
  minInnerM: 150,
  maxInnerM: 350,
};

// ---------- Régua de qualidade das âncoras ----------

/**
 * A régua julga o LUGAR EM SI: tipo e volume de avaliações. Complementar saiu
 * (é consequência, não critério — e buscá-lo antes de cortar custaria caro),
 * concorrente tem peso zero e proximidade do centro saiu de vez: aeroporto e
 * rodoviária são longe por definição e isso não os torna piores.
 *
 * Calibrada em 22/09/2026 sobre 1.728 âncoras completas de quatro escopos
 * (Morumbi, Batel, Centro/Florianópolis, Curitiba cidade), conferindo nome a
 * nome. Com estes números, aeroporto, rodoviária, shopping e hospital com mais
 * de mil avaliações ficam em TODOS os casos, e galeria de bairro chamada
 * "shopping" cai.
 */
export const RANKING_RULES = {
  /** Média de V32 (adequação), V33 (operação contínua) e V34 (permanência) do motor de score. */
  tipoScore: { airport: 10, bus_station: 10, hospital: 9, shopping_mall: 9, gas_station: 8 } as Record<string, number>,
  tipoScorePadrao: 5,
  pesoTipo: 3,
  pesoAvaliacoes: 3,
  /** log10(1+avaliações)/3 × 10: mil avaliações = nota 10. */
  divisorLogAvaliacoes: 3,
  /** Nota mínima em região de renda alta, média-alta, média ou sem dado. */
  corteNormal: 6.0,
  /**
   * Nota mínima em região de renda baixa. Mais alto que o normal porque ali a
   * frota elétrica é menor — mas não 8,0, que derrubava posto de avenida de
   * passagem com 200+ avaliações. Carga rápida é sobre passagem, não sobre
   * quem mora no quarteirão.
   */
  corteRendaBaixa: 7.0,
};

// ---------- Renda por setor censitário (Censo 2022) ----------

export type RendaFaixa = "alta" | "média-alta" | "média" | "baixa" | "sem dado";

export const RENDA_RULES = {
  /**
   * Os valores do Censo 2022 estão em REAIS DE 2022: a faixa é calculada em
   * múltiplos do salário mínimo DO ANO DO DADO, senão toda região desce de
   * faixa sozinha conforme o mínimo sobe.
   */
  salarioMinimoDoDado: 1212,
  /** Piso de cada faixa, em salários mínimos do ano do dado. */
  faixas: [
    { nome: "alta" as const, minSM: 4 },
    { nome: "média-alta" as const, minSM: 2.5 },
    { nome: "média" as const, minSM: 1.7 },
    { nome: "baixa" as const, minSM: 0 },
  ],
};

export const COMPETITOR_ZONE_RADIUS_M = 300;

/** Concorrentes a menos desta distância na tela viram um ponto com contador — nenhum fica escondido. */
export const COMPETITOR_OVERLAP_PX = 14;

export const CHARGER_RULES = {
  dcMinKw: 40,
  /** Distância para casar um ponto do OpenChargeMap com um eletroposto do Google. */
  ocmMatchDistanceM: 50,
};
