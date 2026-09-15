/**
 * Fonte única das URLs de basemap (tiles) usadas em todos os mapas do app.
 *
 * A CARTO encerrou o acesso anônimo aos basemaps: sem `?key=` os tiles voltam
 * com a marca d'água "API KEY REQUIRED" gravada na própria imagem.
 *
 * CHAVES (ver README, "HTML exportado para cliente"):
 *
 * - NEXT_PUBLIC_CARTO_API_KEY — mapas dentro do app web E, enquanto não houver
 *   chave própria de exportação, também a chave gravada nos HTML exportados.
 *
 * - NEXT_PUBLIC_CARTO_EXPORT_API_KEY — opcional. Se existir, é a chave gravada
 *   em todo HTML entregue a cliente (Mapa de Calor, score, inteligência de
 *   mercado); se não existir, os HTML usam NEXT_PUBLIC_CARTO_API_KEY.
 *
 * ⚠ A chave que vai para o HTML exportado NUNCA pode ser restrita por domínio
 *   nem rotacionada/revogada enquanto houver relatório em campo: o arquivo é
 *   aberto de file://, sem Referer, meses depois, e busca os tiles na hora.
 *   Hoje é uma chave só — então NENHUMA das duas pode ser restrita. Ao separar,
 *   a chave NOVA vai para o app (essa pode ser restrita); a atual continua como
 *   chave de exportação, porque já está dentro dos relatórios enviados.
 *
 * As referências a process.env.NEXT_PUBLIC_* precisam ser literais — o Next
 * substitui o valor durante o `next build`, então as chaves têm que estar
 * definidas no ambiente ANTES de buildar.
 */

const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "";
// Chave própria de exportação quando existir; senão, a do app. Nenhuma das duas → exportação bloqueada.
const CARTO_EXPORT_API_KEY =
  process.env.NEXT_PUBLIC_CARTO_EXPORT_API_KEY || process.env.NEXT_PUBLIC_CARTO_API_KEY || "";

/** Atribuição exigida pela licença da CARTO — precisa continuar visível no mapa. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function tileUrl(style: "dark_all" | "light_all", key: string): string {
  const base = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  return key ? `${base}?key=${key}` : base;
}

/** Tema escuro — mapas dentro do app (chave restringível). */
export const DARK_TILES = tileUrl("dark_all", CARTO_API_KEY);

/** Tema claro — página de impressão do score (dentro do app). */
export const LIGHT_TILES = tileUrl("light_all", CARTO_API_KEY);

/** Opções padrão do L.tileLayer, iguais em todos os mapas. */
export const TILE_OPTIONS = {
  attribution: TILE_ATTRIBUTION,
  maxZoom: 19,
};

export const HAS_CARTO_KEY = CARTO_API_KEY.length > 0;
export const HAS_CARTO_EXPORT_KEY = CARTO_EXPORT_API_KEY.length > 0;

export class ExportBasemapKeyError extends Error {
  constructor() {
    super(
      "Nenhuma chave do CARTO configurada (NEXT_PUBLIC_CARTO_EXPORT_API_KEY ou NEXT_PUBLIC_CARTO_API_KEY). " +
        "O HTML não foi gerado: sairia sem base cartográfica."
    );
    this.name = "ExportBasemapKeyError";
  }
}

/**
 * Tiles escuros para HTML ENTREGUE A CLIENTE. Sem nenhuma chave, lança erro —
 * nunca gera HTML sem base cartográfica.
 */
export function exportDarkTiles(): string {
  if (!CARTO_EXPORT_API_KEY) throw new ExportBasemapKeyError();
  return tileUrl("dark_all", CARTO_EXPORT_API_KEY);
}

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
