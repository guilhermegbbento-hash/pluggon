/**
 * Ingestão de renda por setor censitário (Censo 2022 do IBGE), POR MUNICÍPIO.
 *
 * Comando de OPERAÇÃO, rodado sob demanda — nunca dentro da geração de um mapa:
 * o IBGE publica a malha por estado (São Paulo tem 170 MB) e nenhum cliente pode
 * esperar esse download. A geração do mapa só lê o que já está no banco.
 *
 *   npm run ingerir-renda -- --municipios 4106902,4205407
 *   npm run ingerir-renda -- --uf SC --lat -27.5923 --lng -48.5490 --raio 9768
 *
 * A segunda forma carrega TODOS os municípios que o raio de estudo toca, não só
 * o do escopo: se o entorno entra no mapa, ele precisa ser classificado igual.
 *
 * Tamanho medido (geometria): São Paulo capital 16,1 MB · Florianópolis 2,6 MB ·
 * Curitiba 1,4 MB · cidade média ~0,4 MB · município mediano ~0,08 MB.
 *
 * Pré-requisito: rodar supabase-migrations.sql (seção 6) no editor SQL do painel.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const IBGE_MALHA =
  "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/gpkg/UF";
const IBGE_RENDA =
  "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip";

/** Casas decimais no WKT: 6 ≈ 11 cm, e corta ~40% do tamanho do texto enviado. */
const CASAS = 6;
const LOTE = 150;

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const sqlite = process.env.SQLITE3_PATH ?? "sqlite3";
const cacheDir = process.env.CENSO_CACHE_DIR ?? path.join(process.cwd(), ".censo-cache");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ausentes (rode com --env-file=.env.local)");

// ---------- download com cache ----------

async function baixar(url: string, destino: string): Promise<string> {
  mkdirSync(path.dirname(destino), { recursive: true });
  if (existsSync(destino)) {
    console.log(`  cache: ${path.basename(destino)} (${(statSync(destino).size / 1024 / 1024).toFixed(1)} MB)`);
    return destino;
  }
  console.log(`  baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou: HTTP ${res.status} em ${url}`);
  writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  console.log(`  salvo: ${path.basename(destino)} (${(statSync(destino).size / 1024 / 1024).toFixed(1)} MB)`);
  return destino;
}

// ---------- GeoPackage (é um SQLite) ----------

function consultar(arquivo: string, sql: string): string[] {
  const saida = execFileSync(sqlite, [arquivo, sql], { maxBuffer: 1024 * 1024 * 1024 }).toString();
  return saida.split(/\r?\n/).filter(Boolean);
}

interface Anel {
  pontos: [number, number][];
}

/** Envelope do cabeçalho GeoPackage (bytes 8..40), quando presente. */
function envelope(buf: Buffer): { minx: number; maxx: number; miny: number; maxy: number } | null {
  const tipo = (buf[3] >> 1) & 0x07;
  if (tipo === 0) return null;
  return { minx: buf.readDoubleLE(8), maxx: buf.readDoubleLE(16), miny: buf.readDoubleLE(24), maxy: buf.readDoubleLE(32) };
}

/** GeoPackage = cabeçalho próprio + WKB padrão. Devolve polígonos (anéis externos e buracos). */
function lerPoligonos(buf: Buffer): Anel[][] {
  const tipoEnv = (buf[3] >> 1) & 0x07;
  let p = 8 + ([0, 32, 48, 48, 64][tipoEnv] ?? 0);
  const poligonos: Anel[][] = [];

  const lerPoligono = (le: boolean) => {
    const nAneis = le ? buf.readUInt32LE(p) : buf.readUInt32BE(p);
    p += 4;
    const aneis: Anel[] = [];
    for (let i = 0; i < nAneis; i++) {
      const nPontos = le ? buf.readUInt32LE(p) : buf.readUInt32BE(p);
      p += 4;
      const pontos: [number, number][] = [];
      for (let j = 0; j < nPontos; j++) {
        const x = le ? buf.readDoubleLE(p) : buf.readDoubleBE(p);
        const y = le ? buf.readDoubleLE(p + 8) : buf.readDoubleBE(p + 8);
        p += 16;
        pontos.push([x, y]);
      }
      aneis.push({ pontos });
    }
    poligonos.push(aneis);
  };

  const lerGeom = () => {
    const le = buf[p] === 1;
    p += 1;
    const tipo = (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p)) % 1000;
    p += 4;
    if (tipo === 3) lerPoligono(le);
    else if (tipo === 6) {
      const n = le ? buf.readUInt32LE(p) : buf.readUInt32BE(p);
      p += 4;
      for (let i = 0; i < n; i++) lerGeom();
    } else throw new Error(`geometria inesperada no GeoPackage: tipo ${tipo}`);
  };

  lerGeom();
  return poligonos;
}

/** A coluna é MultiPolygon: polígono simples entra embrulhado, equivalente a ST_Multi. */
function paraWkt(poligonos: Anel[][]): string {
  const n = (v: number) => v.toFixed(CASAS);
  const corpo = poligonos
    .map((aneis) => `(${aneis.map((a) => `(${a.pontos.map(([x, y]) => `${n(x)} ${n(y)}`).join(",")})`).join(",")})`)
    .join(",");
  return `SRID=4326;MULTIPOLYGON(${corpo})`;
}

// ---------- renda (CSV do Censo) ----------

interface Renda {
  media: number | null;
  mediana: number | null;
  responsaveis: number | null;
}

async function carregarRenda(): Promise<Map<string, Renda>> {
  const zip = await baixar(IBGE_RENDA, path.join(cacheDir, "renda.zip"));
  const csv = path.join(cacheDir, "Agregados_por_setores_renda_responsavel_BR.csv");
  if (!existsSync(csv)) {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${cacheDir}' -Force`]);
  }
  const mapa = new Map<string, Renda>();
  const num = (s: string) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  for (const linha of readFileSync(csv, "utf8").split(/\r?\n/).slice(1)) {
    if (!linha) continue;
    const c = linha.split(";").map((x) => x.replace(/"/g, ""));
    mapa.set(c[0], { responsaveis: num(c[1]), media: num(c[4]), mediana: num(c[6]) });
  }
  return mapa;
}

// ---------- Supabase ----------

async function enviar(tabela: string, linhas: unknown[], conflito: string): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${tabela}?on_conflict=${conflito}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey!,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(linhas),
  });
  if (!res.ok) {
    const detalhe = await res.text();
    throw new Error(`gravação em ${tabela} falhou: HTTP ${res.status} ${detalhe.slice(0, 400)}`);
  }
}

// ---------- municípios tocados pelo raio ----------

function municipiosNoRaio(arquivo: string, tabela: string, lat: number, lng: number, raioM: number): string[] {
  const grauLat = raioM / 111_320;
  const grauLng = raioM / (111_320 * Math.cos((lat * Math.PI) / 180));
  // O envelope do setor está no cabeçalho binário da geometria, que o SQL não
  // sabe comparar: lê tudo do estado uma vez e filtra em memória.
  const todos = consultar(arquivo, `select CD_MUN, NM_MUN, hex(geom) from "${tabela}";`);
  const bbox = { minx: lng - grauLng, maxx: lng + grauLng, miny: lat - grauLat, maxy: lat + grauLat };
  const encontrados = new Map<string, string>();
  for (const linha of todos) {
    const [cd, nome, hex] = linha.split("|");
    if (!hex || encontrados.has(cd)) continue;
    const env = envelope(Buffer.from(hex, "hex"));
    if (!env) continue;
    if (env.maxx < bbox.minx || env.minx > bbox.maxx || env.maxy < bbox.miny || env.miny > bbox.maxy) continue;
    encontrados.set(cd, nome);
  }
  for (const [cd, nome] of encontrados) console.log(`  raio toca ${nome} (${cd})`);
  return [...encontrados.keys()];
}

// ---------- ingestão ----------

async function ingerirMunicipio(uf: string, cdMun: string, renda: Map<string, Renda>): Promise<void> {
  const arquivo = path.join(cacheDir, `${uf}_setores_CD2022.gpkg`);
  const tabela = `${uf}_setores_CD2022`;
  const linhas = consultar(arquivo, `select CD_SETOR, NM_MUN, SITUACAO, hex(geom) from "${tabela}" where CD_MUN = '${cdMun}';`);
  if (linhas.length === 0) throw new Error(`nenhum setor para o município ${cdMun} em ${uf}`);

  let bytes = 0;
  let semRenda = 0;
  const registros: Record<string, unknown>[] = [];
  let nomeMun = "";
  for (const linha of linhas) {
    const [cdSetor, nmMun, situacao, hex] = linha.split("|");
    nomeMun = nmMun;
    const buf = Buffer.from(hex, "hex");
    bytes += buf.length;
    const r = renda.get(cdSetor) ?? { media: null, mediana: null, responsaveis: null };
    if (r.mediana === null) semRenda++;
    registros.push({
      cd_setor: cdSetor,
      cd_mun: cdMun,
      nm_mun: nmMun,
      uf,
      situacao,
      geom: paraWkt(lerPoligonos(buf)),
      renda_media: r.media,
      renda_mediana: r.mediana,
      responsaveis: r.responsaveis,
      ano_dado: 2022,
    });
  }

  for (let i = 0; i < registros.length; i += LOTE) {
    await enviar("censo_setores", registros.slice(i, i + LOTE), "cd_setor");
    process.stdout.write(`\r  ${nomeMun}: ${Math.min(i + LOTE, registros.length)}/${registros.length} setores`);
  }
  await enviar(
    "censo_municipios_carregados",
    [{ cd_mun: cdMun, nm_mun: nomeMun, uf, setores: registros.length, bytes_geom: bytes, ano_dado: 2022 }],
    "cd_mun"
  );
  console.log(
    `\r  ${nomeMun} (${cdMun}): ${registros.length} setores, ${(bytes / 1024 / 1024).toFixed(2)} MB de geometria` +
      (semRenda ? `, ${semRenda} sem renda (setor sem domicílio — não penaliza)` : "")
  );
}

async function main() {
  const uf = arg("uf")?.toUpperCase();
  const municipiosArg = arg("municipios");
  const lat = arg("lat") ? Number(arg("lat")) : null;
  const lng = arg("lng") ? Number(arg("lng")) : null;
  const raio = arg("raio") ? Number(arg("raio")) : null;

  if (!municipiosArg && !(uf && lat !== null && lng !== null && raio !== null)) {
    throw new Error(
      "uso: --municipios 4106902,4205407  |  --uf SC --lat -27.59 --lng -48.55 --raio 9768\n" +
        "(a segunda forma carrega todos os municípios que o raio toca)"
    );
  }

  const renda = await carregarRenda();
  console.log(`renda: ${renda.size} setores no Censo 2022 (valores em R$ de 2022)`);

  let alvos: { uf: string; cd: string }[] = [];
  if (municipiosArg) {
    const porUf = new Map<string, string[]>();
    for (const cd of municipiosArg.split(",").map((s) => s.trim())) {
      const sigla = UF_POR_CODIGO[cd.slice(0, 2)];
      if (!sigla) throw new Error(`código de UF desconhecido no município ${cd}`);
      porUf.set(sigla, [...(porUf.get(sigla) ?? []), cd]);
    }
    for (const [sigla, cds] of porUf) {
      await baixar(`${IBGE_MALHA}/${sigla}/${sigla}_setores_CD2022.gpkg`, path.join(cacheDir, `${sigla}_setores_CD2022.gpkg`));
      alvos.push(...cds.map((cd) => ({ uf: sigla, cd })));
    }
  } else {
    const arquivo = await baixar(`${IBGE_MALHA}/${uf}/${uf}_setores_CD2022.gpkg`, path.join(cacheDir, `${uf}_setores_CD2022.gpkg`));
    const cds = municipiosNoRaio(arquivo, `${uf}_setores_CD2022`, lat!, lng!, raio!);
    alvos = cds.map((cd) => ({ uf: uf!, cd }));
  }

  for (const alvo of alvos) await ingerirMunicipio(alvo.uf, alvo.cd, renda);
  console.log(`\nok: ${alvos.length} município(s) ingerido(s).`);
}

const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

main().catch((err) => {
  console.error(`\nFALHOU: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
