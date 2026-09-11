/**
 * Fonte única das URLs de basemap (tiles) usadas em todos os mapas do app.
 *
 * A CARTO encerrou o acesso anônimo aos basemaps: sem `?key=` os tiles voltam
 * com a marca d'água "API KEY REQUIRED" gravada na própria imagem. A chave é
 * gratuita (carto.com/basemaps/apikey) e precisa estar em NEXT_PUBLIC_CARTO_API_KEY.
 *
 * A referência a process.env.NEXT_PUBLIC_CARTO_API_KEY precisa ser literal —
 * o Next substitui esse trecho pelo valor durante o `next build`, então a chave
 * é congelada no bundle e tem que estar definida no ambiente ANTES de buildar.
 */

const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "";

/** Atribuição exigida pela licença da CARTO — precisa continuar visível no mapa. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function tileUrl(style: "dark_all" | "light_all"): string {
  const base = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  return CARTO_API_KEY ? `${base}?key=${CARTO_API_KEY}` : base;
}

/** Tema escuro — mapa de calor, score de ponto, inteligência de mercado. */
export const DARK_TILES = tileUrl("dark_all");

/** Tema claro — página de impressão do score. */
export const LIGHT_TILES = tileUrl("light_all");

/** Opções padrão do L.tileLayer, iguais em todos os mapas. */
export const TILE_OPTIONS = {
  attribution: TILE_ATTRIBUTION,
  maxZoom: 19,
};

export const HAS_CARTO_KEY = CARTO_API_KEY.length > 0;

/**
 * Avisa uma única vez no console quando a chave não está configurada — sem ela
 * o mapa até carrega, mas vem todo marcado com "API KEY REQUIRED".
 */
let warned = false;
export function warnIfMissingKey(): void {
  if (HAS_CARTO_KEY || warned || typeof window === "undefined") return;
  warned = true;
  console.warn(
    "[basemap] NEXT_PUBLIC_CARTO_API_KEY não configurada — os tiles da CARTO " +
      "virão com marca d'água. Pegue uma chave grátis em https://carto.com/basemaps/apikey"
  );
}
