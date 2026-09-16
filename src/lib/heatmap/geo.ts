import { DEDUPE_RULES } from "./config";
import type { Bounds, LatLng, ScopeArea } from "./types";

const EARTH_RADIUS_M = 6371000;
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Retângulo que contém o círculo (usado em locationRestriction e no fitBounds). */
export function circleBounds(center: LatLng, radiusM: number): Bounds {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

export function unionBounds(list: Bounds[]): Bounds {
  return list.reduce((acc, b) => ({
    south: Math.min(acc.south, b.south),
    west: Math.min(acc.west, b.west),
    north: Math.max(acc.north, b.north),
    east: Math.max(acc.east, b.east),
  }));
}

export function scopeBoundsFor(areas: Pick<ScopeArea, "center" | "radiusM">[]): Bounds {
  return unionBounds(areas.map((a) => circleBounds(a.center, a.radiusM)));
}

/** Meia-diagonal do retângulo. Usada nas células de busca, NÃO no raio do estudo. */
export function boundsHalfDiagonalM(b: Bounds): number {
  return haversineM({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east }) / 2;
}

/**
 * Raio que cobre o retângulo INTEIRO a partir do centro dado. O centro do
 * estudo é o `location` do geocoding, que quase nunca é o meio do retângulo:
 * usar a meia-diagonal deixaria parte do bairro fora do mapa.
 */
export function radiusToCoverBounds(center: LatLng, b: Bounds): number {
  const corners: LatLng[] = [
    { lat: b.south, lng: b.west },
    { lat: b.south, lng: b.east },
    { lat: b.north, lng: b.west },
    { lat: b.north, lng: b.east },
  ];
  return Math.max(...corners.map((c) => haversineM(center, c)));
}

export interface AreaMatch {
  area: ScopeArea;
  distanceM: number;
  inside: boolean;
}

/** Área que contém o ponto (a mais central, se houver sobreposição) ou a mais próxima. */
export function matchArea(point: LatLng, areas: ScopeArea[]): AreaMatch {
  let best: AreaMatch | null = null;
  let bestRatio = Infinity;
  for (const area of areas) {
    const distanceM = haversineM(point, area.center);
    const ratio = distanceM / area.radiusM;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = { area, distanceM, inside: distanceM <= area.radiusM };
    }
  }
  if (!best) throw new Error("matchArea: escopo sem áreas");
  return best;
}

// ---------- Nomes ----------

export function normalizeText(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(DEDUPE_RULES.stopwords);
const CATEGORY_WORDS = new Set(DEDUPE_RULES.categoryWords);

/** Nome sem preposições e sem palavras de categoria; se sobrar nada, mantém as palavras de categoria. */
export function nameCore(s: string): string {
  const tokens = normalizeText(s).split(" ").filter((t) => t && !STOPWORDS.has(t));
  const core = tokens.filter((t) => !CATEGORY_WORDS.has(t));
  return (core.length > 0 ? core : tokens).join(" ");
}

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

export function trigramDice(a: string, b: string): number {
  if (!a && !b) return 1;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    inter += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}

export function nameSimilarity(a: string, b: string): number {
  return trigramDice(nameCore(a), nameCore(b));
}

/** Todas as palavras do núcleo do nome mais curto aparecem no núcleo do mais longo. */
export function nameContained(a: string, b: string): boolean {
  const ta = nameCore(a).split(" ").filter(Boolean);
  const tb = nameCore(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const words = new Set(long);
  return short.every((t) => words.has(t));
}

// ---------- Células de busca ----------

export function boundsCenter(b: Bounds): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

export function splitBounds(b: Bounds): Bounds[] {
  const { lat, lng } = boundsCenter(b);
  return [
    { south: b.south, west: b.west, north: lat, east: lng },
    { south: b.south, west: lng, north: lat, east: b.east },
    { south: lat, west: b.west, north: b.north, east: lng },
    { south: lat, west: lng, north: b.north, east: b.east },
  ];
}

export function boundsIntersectCircle(b: Bounds, center: LatLng, radiusM: number): boolean {
  const nearest = {
    lat: Math.min(b.north, Math.max(b.south, center.lat)),
    lng: Math.min(b.east, Math.max(b.west, center.lng)),
  };
  return haversineM(center, nearest) <= radiusM;
}

/** Fração do retângulo coberta pelo círculo (amostragem em grade). */
export function rectCoverageByCircle(b: Bounds, center: LatLng, radiusM: number, n = 60): number {
  let inside = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = {
        lat: b.south + ((i + 0.5) / n) * (b.north - b.south),
        lng: b.west + ((j + 0.5) / n) * (b.east - b.west),
      };
      if (haversineM(center, p) <= radiusM) inside++;
    }
  }
  return inside / (n * n);
}
