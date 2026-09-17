/**
 * Tipos compartilhados do gerador do Mapa de Calor.
 *
 * Tudo aqui é serializável (vai para o payload da API, para o cache e para o
 * HTML exportado), então nada de classes nem funções.
 */

export type LatLng = { lat: number; lng: number };

export type Bounds = { south: number; west: number; north: number; east: number };

export type LayerKey = "anchor" | "complementary" | "competitor";

/** "bairro" cobre também o modo região (até 3 bairros); "cidade" é o município inteiro. */
export type ScopeMode = "bairro" | "cidade";

/** De onde saiu o raio: `bounds` do geocoding ou fallback do config. */
export type RadiusSource = "bounds" | "fallback";

export interface ScopeArea {
  /** Nome como o usuário digitou. */
  requestedName: string;
  /** Nome devolvido pelo geocoding (componente de bairro ou município). */
  resolvedName: string;
  center: LatLng;
  radiusM: number;
  /** Meia-diagonal dos bounds antes de aplicar piso/teto; null quando não veio bounds. */
  rawRadiusM: number | null;
  radiusSource: RadiusSource;
  /** Limite do config aplicado ao raio (piso/teto do modo), ou null. */
  radiusClamp: "piso" | "teto" | null;
  /** % do retângulo do geocoding coberto pelo círculo de estudo; null quando não veio bounds. */
  boundsCoveragePct: number | null;
  geocodeTypes: string[];
}

export interface StudyScope {
  mode: ScopeMode;
  city: string;
  state: string;
  /** Rótulo para título e carimbo: "Morumbi · São Paulo/SP" ou "São Paulo/SP". */
  label: string;
  areas: ScopeArea[];
  /** Enquadramento do mapa: união dos círculos de estudo. */
  bounds: Bounds;
  /** Chave estável do escopo resolvido (usada no cache). */
  key: string;
}

export type DiscardReason =
  | "fora_do_raio"
  | "tipo_invalido"
  | "tipo_principal_divergente"
  | "ponto_de_onibus_sem_sinal_de_terminal"
  | "aeroporto_sem_porte"
  | "hospital_sem_porte"
  | "fechado_permanentemente"
  | "sem_nome"
  | "duplicata_place_id"
  | "duplicata_proximidade_nome"
  | "duplicata_nome_contido"
  | "duplicata_entre_camadas"
  | "complementar_sem_ancora_proxima"
  | "complementar_excedente_por_ancora";

export interface Discard {
  layer: LayerKey;
  typeKey: string;
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  /** Distância ao centro da área de estudo mais próxima. */
  distanceToCenterM: number;
  reason: DiscardReason;
  detail?: string;
}

export type ChargerKwSource = "google_ev_options" | "openchargemap";

/** Lugar normalizado, independente da API de origem. */
export interface CandidatePlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  types: string[];
  primaryType: string | null;
  businessStatus: string | null;
  userRatingCount: number;
  hasWebsite: boolean;
  hasPhone: boolean;
  hasOpeningHours: boolean;
  chargerMaxKw: number | null;
  chargerKwSource: ChargerKwSource | null;
  source: "google_places" | "openchargemap";
}

export interface Candidate {
  layer: LayerKey;
  typeKey: string;
  place: CandidatePlace;
}

export type ValidatedBy = "google_types" | "openchargemap_source";

interface PointOutBase {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  typeLabel: string;
  areaName: string;
  distanceToCenterM: number;
  validatedBy: ValidatedBy;
}

export interface AnchorOut extends PointOutBase {
  /** Complementares renderizados a até INFLUENCE_RULES.complementaryRadiusM. Aumenta a zona. */
  complementaryWithin300m: number;
  /** Concorrentes renderizados a até INFLUENCE_RULES.competitorRadiusM. Diminui a zona. */
  competitorsWithin1km: number;
  influenceInnerRadiusM: number;
}

export interface ComplementaryOut extends PointOutBase {
  nearAnchorPlaceId: string;
  nearAnchor: string;
  nearAnchorDist: number;
}

export type ChargerType = "DC" | "AC" | "unknown";

export interface CompetitorOut extends PointOutBase {
  charger_type: ChargerType;
  chargerMaxKw: number | null;
  chargerTypeSource: ChargerKwSource | null;
  source: CandidatePlace["source"];
}

export interface ScopeCounters {
  anchors: number;
  anchorsByType: Record<string, number>;
  complementary: number;
  competitors: number;
  competitorsDC: number;
  competitorsAC: number;
  competitorsUnknown: number;
}

export interface SourceStatus {
  name: string;
  status: "ok" | "indisponivel" | "erro";
  detail: string;
}

export interface SearchSummary {
  layer: LayerKey;
  typeKey: string;
  areaName: string;
  method: "searchText" | "searchNearby";
  query: string;
  pages: number;
  returned: number;
  /** Mesmo após subdividir, alguma célula continuou no teto da API: a camada pode estar incompleta. */
  truncated: boolean;
  error: string | null;
  /** Células buscadas (1 = sem subdivisão). */
  cells: number;
  /** Profundidade máxima de subdivisão alcançada (0 = área inteira). */
  maxDepth: number;
  /** Células que continuaram no teto sem poder subdividir mais. */
  cappedCells: number;
}

/** Indicadores do MUNICÍPIO — sempre rotulados como tal no relatório. */
export interface MunicipalIndicators {
  city: string;
  state: string;
  population: number | null;
  gdpPerCapita: number | null;
  totalEVs: number;
  bev: number;
  phev: number;
  bevPlusPHEV: number;
  dcChargers: number;
  acChargers: number;
  totalChargers: number;
  ratioEVperDC: number;
  evsSource: string;
  evsSourceTag: string;
  chargersSource: string;
  chargersSourceTag: string;
  cacheUpdatedAt: string | null;
}

export interface QaViolation {
  rule:
    | "ponto_fora_do_raio"
    | "place_id_duplicado"
    | "tipo_nao_validado"
    | "contador_divergente"
    | "enquadramento_divergente"
    | "referencia_inexistente"
    | "camada_incompleta"
    | "cobertura_incompleta";
  detail: string;
}

export interface QaReport {
  passed: boolean;
  checkedAt: string;
  violations: QaViolation[];
  rendered: { anchors: number; complementary: number; competitors: number };
  discardsByReason: Partial<Record<DiscardReason, number>>;
  discardsByLayer: Record<LayerKey, Partial<Record<DiscardReason, number>>>;
  maxDistanceM: { anchors: number; complementary: number; competitors: number };
}

export interface HeatmapPayload {
  generatorVersion: string;
  generatedAt: string;
  scope: StudyScope;
  anchors: AnchorOut[];
  complementary: ComplementaryOut[];
  competitors: CompetitorOut[];
  counters: ScopeCounters;
  discards: Discard[];
  searches: SearchSummary[];
  sources: SourceStatus[];
  municipal: MunicipalIndicators | null;
  qa: QaReport | null;
  googleQueries: number;
  fromCache?: boolean;
}
