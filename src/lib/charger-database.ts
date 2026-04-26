import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Tipos
// ============================================================

export type ChargerType = "DC" | "AC" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface ChargerRow {
  id?: number;
  city: string;
  state: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  power_kw: number;
  charger_type: ChargerType;
  connector?: string;
  operator?: string;
  source: string;
  verified: boolean;
}

export interface ChargersNearPoint {
  in200m: ChargerRow[];
  in500m: ChargerRow[];
  in1km: ChargerRow[];
  in2km: ChargerRow[];
  in5km: ChargerRow[];
  dcIn200m: number;
  dcIn500m: number;
  dcIn1km: number;
  dcIn2km: number;
  dcInCity: number;
  totalInCity: number;
}

// ============================================================
// Classificação AC vs DC pelo nome
// ============================================================

export function classifyChargerType(
  name: string,
  operator?: string
): { type: ChargerType; estimatedPower: number; confidence: Confidence } {
  const text = (name + " " + (operator || "")).toLowerCase();

  const dcHighKeywords = [
    "supercharger",
    "supercarregador",
    "ultra rapid",
    "ultra-rapid",
    "hpc",
    "150kw",
    "120kw",
    "100kw",
    "80kw",
    "60kw",
    "50kw",
    "ccs2",
    "chademo",
    "dc fast",
    "carregador rápido",
    "carregamento rápido",
    "fast charge",
    "rapid",
  ];
  if (dcHighKeywords.some((k) => text.includes(k))) {
    return { type: "DC", estimatedPower: 60, confidence: "high" };
  }

  const dcMediumKeywords = [
    "shell recharge",
    "zletric",
    "ezvolt",
    "tupinambá",
    "tupinamba",
    "neocharge",
    "voltbras",
    "raízen",
    "raizen",
    "ipiranga",
    "vibra",
    "copel eletrovia",
    "cpfl",
    "edp",
    "enel x",
    "abb",
    "weg charge",
  ];
  if (dcMediumKeywords.some((k) => text.includes(k))) {
    return { type: "DC", estimatedPower: 60, confidence: "medium" };
  }

  const acHighKeywords = [
    "wallbox",
    "wall box",
    "7kw",
    "7.4kw",
    "22kw",
    "tipo 2",
    "type 2",
    "level 2",
    "nível 2",
    "lento",
    "slow",
    "ac charger",
  ];
  if (acHighKeywords.some((k) => text.includes(k))) {
    return { type: "AC", estimatedPower: 7, confidence: "high" };
  }

  const acMediumKeywords = [
    "bmw",
    "volvo",
    "audi",
    "porsche",
    "mercedes",
    "jaguar",
    "concessionária",
    "concessionaria",
    "shopping",
    "mall",
    "estacionamento",
    "condor",
    "pátio",
    "patio",
  ];
  if (acMediumKeywords.some((k) => text.includes(k))) {
    return { type: "AC", estimatedPower: 7, confidence: "medium" };
  }

  return { type: "unknown", estimatedPower: 0, confidence: "low" };
}

// ============================================================
// Helpers
// ============================================================

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function upsertCharger(
  supabase: SupabaseClient,
  charger: Omit<ChargerRow, "id">
) {
  try {
    await supabase
      .from("ev_chargers")
      .upsert(charger, { onConflict: "lat,lng,name", ignoreDuplicates: false });
  } catch (e) {
    console.error("upsertCharger error:", e);
  }
}

// ============================================================
// FONTE 1: Google Places (popular o banco)
// ============================================================

export async function populateChargersFromGoogle(
  city: string,
  state: string,
  lat: number,
  lng: number,
  supabase: SupabaseClient
): Promise<number> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return 0;

  const queries = [
    "eletroposto",
    "carregador veículo elétrico",
    "ev charging station",
    "estação recarga",
    "ponto recarga",
  ];

  const seen = new Set<string>();
  let googleQueries = 0;

  for (const query of queries) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${lat},${lng}&radius=50000` +
        `&keyword=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetch(url);
      googleQueries++;
      if (!res.ok) continue;
      const data = await res.json();
      for (const place of (data.results || []) as Array<{
        name?: string;
        vicinity?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>) {
        const plat = place.geometry?.location?.lat;
        const plng = place.geometry?.location?.lng;
        if (typeof plat !== "number" || typeof plng !== "number") continue;
        const key = `${plat.toFixed(5)},${plng.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const classification = classifyChargerType(place.name || "");
        await upsertCharger(supabase, {
          city,
          state,
          name: place.name || "",
          address: place.vicinity || place.formatted_address || "",
          lat: plat,
          lng: plng,
          power_kw: classification.estimatedPower,
          charger_type: classification.type,
          operator: "",
          source: "google_places",
          verified: classification.confidence === "high",
        });
      }
    } catch (e) {
      console.error("Google query error:", e);
    }
  }

  return googleQueries;
}

// ============================================================
// FONTE 2: OpenChargeMap (grátis, com potência real)
// ============================================================

export async function enrichWithOpenChargeMap(
  city: string,
  lat: number,
  lng: number,
  supabase: SupabaseClient
): Promise<void> {
  try {
    const url =
      `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR` +
      `&latitude=${lat}&longitude=${lng}&distance=50&distanceunit=KM` +
      `&maxresults=500&compact=true&verbose=false` +
      `&key=e7aff4db-e534-4269-8329-00440329ed09`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = (await res.json()) as Array<{
      AddressInfo?: {
        Title?: string;
        AddressLine1?: string;
        StateOrProvince?: string;
        Latitude?: number;
        Longitude?: number;
      };
      Connections?: Array<{ PowerKW?: number; ConnectionType?: { Title?: string } }>;
      OperatorInfo?: { Title?: string };
    }>;
    if (!Array.isArray(data)) return;

    for (const station of data) {
      const ai = station.AddressInfo;
      if (!ai || typeof ai.Latitude !== "number" || typeof ai.Longitude !== "number") {
        continue;
      }
      const conns = station.Connections || [];
      const maxPower = conns.reduce(
        (acc, c) => Math.max(acc, c.PowerKW ?? 0),
        0
      );
      const isDC = maxPower >= 20;

      await upsertCharger(supabase, {
        city,
        state: ai.StateOrProvince || "",
        name: ai.Title || "",
        address: ai.AddressLine1 || "",
        lat: ai.Latitude,
        lng: ai.Longitude,
        power_kw: maxPower,
        charger_type: isDC ? "DC" : maxPower > 0 ? "AC" : "unknown",
        connector: conns
          .map((c) => c.ConnectionType?.Title)
          .filter((t): t is string => Boolean(t))
          .join(", "),
        operator: station.OperatorInfo?.Title || "",
        source: "openchargemap",
        verified: true,
      });
    }
  } catch (e) {
    console.error("OpenChargeMap error:", e);
  }
}

// ============================================================
// FONTE 3: carregados.com.br (scrape, best effort)
// ============================================================

const STATE_SLUGS: Record<string, string> = {
  PR: "paraná+(pr)",
  SP: "são+paulo+(sp)",
  RJ: "rio+de+janeiro+(rj)",
  MG: "minas+gerais+(mg)",
  RS: "rio+grande+do+sul+(rs)",
  SC: "santa+catarina+(sc)",
  BA: "bahia+(ba)",
  PE: "pernambuco+(pe)",
  CE: "ceará+(ce)",
  GO: "goiás+(go)",
  DF: "distrito+federal+(df)",
  PA: "pará+(pa)",
  AM: "amazonas+(am)",
  MT: "mato+grosso+(mt)",
  MS: "mato+grosso+do+sul+(ms)",
  ES: "espírito+santo+(es)",
  PB: "paraíba+(pb)",
  RN: "rio+grande+do+norte+(rn)",
  AL: "alagoas+(al)",
  PI: "piauí+(pi)",
  SE: "sergipe+(se)",
  MA: "maranhão+(ma)",
};

export async function enrichWithCarregados(
  city: string,
  state: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _supabase: SupabaseClient
): Promise<void> {
  try {
    const stateSlug = STATE_SLUGS[state] || state.toLowerCase();
    const citySlug = city
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "+");
    const url = `https://carregados.com.br/estacoes?cidade=${citySlug}&estado=${stateSlug}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return;
    const html = await res.text();

    const totalMatch = html.match(
      /(\d+)\s*(?:eletropostos?|estações?|resultados?)/i
    );
    if (totalMatch) {
      console.log("carregados.com.br total para", city, ":", totalMatch[1]);
    }

    // Extrai pares lat/lng se houver no HTML (best effort)
    const coordsRegex =
      /lat['":\s]+([-\d.]+)[\s,'"]+(?:lng|lon|longitude)['":\s]+([-\d.]+)/gi;
    let match;
    while ((match = coordsRegex.exec(html)) !== null) {
      console.log("carregados coord:", match[1], match[2]);
    }
  } catch (e) {
    console.log("carregados.com.br indisponível (ignorando):", e);
  }
}

// ============================================================
// FONTE 4: PlugShare (best effort via embed público)
// ============================================================

export async function enrichWithPlugShare(
  city: string,
  lat: number,
  lng: number,
  supabase: SupabaseClient
): Promise<void> {
  try {
    const url =
      `https://www.plugshare.com/api/locations/region` +
      `?count=500&latitude=${lat}&longitude=${lng}&spanLat=0.5&spanLng=0.5` +
      `&outlets=[{%22connector%22:7}]`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as Array<{
      latitude?: number;
      longitude?: number;
      name?: string;
      address?: string;
      kilowatts?: number;
    }>;
    console.log("PlugShare encontrou", data?.length || 0, "estações para", city);
    for (const station of data || []) {
      if (typeof station.latitude !== "number" || typeof station.longitude !== "number") {
        continue;
      }
      const power = station.kilowatts || 0;
      await upsertCharger(supabase, {
        city,
        state: "",
        name: station.name || "PlugShare Station",
        address: station.address || "",
        lat: station.latitude,
        lng: station.longitude,
        power_kw: power,
        charger_type: power >= 20 ? "DC" : power > 0 ? "AC" : "unknown",
        source: "plugshare",
        verified: true,
      });
    }
  } catch (e) {
    console.log("PlugShare indisponível (ignorando):", e);
  }
}

// ============================================================
// Verificar se a cidade já tem dados frescos no banco
// ============================================================

export async function cityHasFreshChargers(
  city: string,
  supabase: SupabaseClient,
  maxAgeDays = 7
): Promise<boolean> {
  try {
    const cutoff = new Date(
      Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const { count } = await supabase
      .from("ev_chargers")
      .select("id", { count: "exact", head: true })
      .eq("city", city)
      .gte("updated_at", cutoff);
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

// ============================================================
// Buscar carregadores próximos a um ponto (do banco)
// ============================================================

export async function getChargersNearPoint(
  lat: number,
  lng: number,
  city: string,
  supabase: SupabaseClient
): Promise<ChargersNearPoint> {
  const empty: ChargersNearPoint = {
    in200m: [],
    in500m: [],
    in1km: [],
    in2km: [],
    in5km: [],
    dcIn200m: 0,
    dcIn500m: 0,
    dcIn1km: 0,
    dcIn2km: 0,
    dcInCity: 0,
    totalInCity: 0,
  };

  try {
    const { data: cityChargers } = await supabase
      .from("ev_chargers")
      .select("*")
      .eq("city", city);

    const chargers = (cityChargers || []) as ChargerRow[];

    const withDistance = chargers.map((c) => ({
      ...c,
      distance: haversine(lat, lng, Number(c.lat), Number(c.lng)),
    }));

    const in200m = withDistance.filter((c) => c.distance <= 200);
    const in500m = withDistance.filter((c) => c.distance <= 500);
    const in1km = withDistance.filter((c) => c.distance <= 1000);
    const in2km = withDistance.filter((c) => c.distance <= 2000);
    const in5km = withDistance.filter((c) => c.distance <= 5000);

    return {
      in200m,
      in500m,
      in1km,
      in2km,
      in5km,
      dcIn200m: in200m.filter((c) => c.charger_type === "DC").length,
      dcIn500m: in500m.filter((c) => c.charger_type === "DC").length,
      dcIn1km: in1km.filter((c) => c.charger_type === "DC").length,
      dcIn2km: in2km.filter((c) => c.charger_type === "DC").length,
      dcInCity: chargers.filter((c) => c.charger_type === "DC").length,
      totalInCity: chargers.length,
    };
  } catch (e) {
    console.error("getChargersNearPoint error:", e);
    return empty;
  }
}
