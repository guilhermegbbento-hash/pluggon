import { createClient } from "@/lib/supabase/server";
import { upsertCityEVCache, type ManualCityEVInput } from "@/lib/abve-real-data";
import { logUsage } from "@/lib/usage-logger";
import { APP_VERSION } from "@/lib/version";
import { generateHeatmap, HeatmapGenerationError } from "@/lib/heatmap/generate";
import { normalizeText } from "@/lib/heatmap/geo";
import { loadMunicipalIndicators } from "@/lib/heatmap/municipal";
import { formatQaReport, QaGateError, runQaGate } from "@/lib/heatmap/qa-gate";
import { ScopeError } from "@/lib/heatmap/scope";
import { MAX_AREAS } from "@/lib/heatmap/config";
import type { HeatmapPayload } from "@/lib/heatmap/types";

export const maxDuration = 300;

/**
 * A versão do gerador faz parte da chave: toda entrada gerada por outra versão
 * simplesmente não é encontrada e expira sozinha no deploy.
 */
function cacheStatusFor(city: string, state: string, regions: string[]): string {
  const regionsKey = regions.map(normalizeText).filter(Boolean).sort().join("+");
  return `heatmap:v${APP_VERSION}:${normalizeText(city)}|${state}|${regionsKey}`;
}

export async function POST(req: Request) {
  let body: {
    city?: string;
    state?: string;
    forceRefresh?: boolean;
    manualData?: ManualCityEVInput;
    regions?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const city = (body.city || "").trim();
  const state = (body.state || "").trim().toUpperCase();
  const forceRefresh = Boolean(body.forceRefresh);
  const manualData: ManualCityEVInput | null = body.manualData ?? null;
  const hasManualInput =
    !!manualData &&
    ((manualData.bev ?? 0) > 0 ||
      (manualData.phev ?? 0) > 0 ||
      (manualData.chargersAC ?? 0) > 0 ||
      (manualData.chargersDC ?? 0) > 0);
  if (!city || !state) {
    return Response.json({ error: "city e state são obrigatórios" }, { status: 400 });
  }

  const regions = (body.regions ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (regions.length > MAX_AREAS) {
    return Response.json({ error: `Máximo ${MAX_AREAS} regiões por análise` }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "GOOGLE_MAPS_API_KEY ausente" }, { status: 500 });
  }

  const supabase = await createClient();
  const cacheStatus = cacheStatusFor(city, state, regions);

  // Persistir manualData antes de tudo, para análises seguintes da cidade já usarem o valor.
  if (hasManualInput) {
    let userEmail: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userEmail = user?.email ?? null;
    } catch {}
    await upsertCityEVCache(supabase as never, city, state, manualData, userEmail);
  }

  // Cache (7 dias) — ignorado com forceRefresh ou manualData.
  if (!forceRefresh && !hasManualInput) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: cached } = await supabase
        .from("city_analyses")
        .select("points_json, created_at")
        .eq("city", city)
        .eq("state", state)
        .eq("status", cacheStatus)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached?.points_json) {
        const payload = (
          typeof cached.points_json === "string" ? JSON.parse(cached.points_json) : cached.points_json
        ) as HeatmapPayload;
        // Rede de segurança: mesmo com a versão na chave, o cache passa pelo gate de novo.
        const qa = payload.generatorVersion === APP_VERSION ? runQaGate(payload) : null;
        if (qa?.passed) {
          console.log(`heatmap CACHE HIT: ${cacheStatus}`);
          return Response.json({ ...payload, qa, fromCache: true });
        }
        console.warn(`heatmap cache descartado (${cacheStatus}): ${qa ? formatQaReport(qa) : "versão divergente"}`);
      }
    } catch (err) {
      console.error("heatmap cache lookup erro:", err);
    }
  }

  let payload: HeatmapPayload;
  try {
    payload = await generateHeatmap(
      { city, state, regions },
      {
        googleApiKey: apiKey,
        ocmApiKey: process.env.OPENCHARGEMAP_API_KEY ?? null,
        loadMunicipal: (scope) =>
          loadMunicipalIndicators(scope.city, scope.state, { manualData, supabase: supabase as never }),
      }
    );
  } catch (err) {
    if (err instanceof ScopeError) {
      return Response.json({ error: err.message, code: err.code, details: err.details }, { status: 422 });
    }
    if (err instanceof HeatmapGenerationError) {
      return Response.json({ error: err.message, details: err.details }, { status: 502 });
    }
    if (err instanceof QaGateError) {
      console.error(formatQaReport(err.report));
      return Response.json(
        {
          error: "Relatório reprovado no QA gate — não foi gerado.",
          details: err.report.violations.map((v) => `[${v.rule}] ${v.detail}`),
          qa: err.report,
        },
        { status: 500 }
      );
    }
    console.error("heatmap erro inesperado:", err);
    return Response.json({ error: "Erro inesperado ao gerar o mapa" }, { status: 500 });
  }

  console.log(`=== HEATMAP ${payload.scope.label} (v${APP_VERSION}) ===`);
  console.log(formatQaReport(payload.qa!));
  for (const s of payload.sources) console.log(`Fonte ${s.name}: ${s.status} — ${s.detail}`);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("city_analyses").delete().eq("city", city).eq("state", state).eq("status", cacheStatus);
      await supabase.from("city_analyses").insert({
        user_id: user.id,
        city,
        state,
        population: payload.municipal?.population ?? null,
        gdp_per_capita: payload.municipal?.gdpPerCapita ?? null,
        charger_count: payload.municipal?.totalChargers ?? null,
        dc_charger_count: payload.municipal?.dcChargers ?? null,
        ev_count: payload.municipal?.totalEVs ?? null,
        points_json: payload,
        status: cacheStatus,
      });
    }
  } catch (err) {
    console.error("heatmap cache save erro:", err);
  }

  await logUsage({
    module: "heatmap",
    city: `${city}/${state}`,
    googlePlacesQueries: payload.googleQueries,
  });

  return Response.json(payload);
}
