import { fetchChargers, classifyChargers } from "@/lib/openchargemap";
import type { ChargerStation } from "@/lib/openchargemap";

export const maxDuration = 300;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// ---------- Google Places fallback ----------

async function fetchChargersGoogle(
  city: string,
  state: string,
  lat: number,
  lng: number
): Promise<ChargerStation[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const query = 'eletroposto OR carregador elétrico OR ev charging';
    const url = `https://places.googleapis.com/v1/places:searchText`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        textQuery: `${query} em ${city} ${state}`,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 50000,
          },
        },
        maxResultCount: 20,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.places || []).map((p: any) => ({
      name: p.displayName?.text || 'Sem nome',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      address: p.formattedAddress || '',
      city,
      state,
      operator: 'Google Places',
      powerKW: 0,
      connectionType: 'Não identificado',
      level: 0,
      levelName: 'Não identificado',
      isFastCharge: false,
      isOperational: true,
      totalConnections: 0,
      usageCost: 'Não informado',
      dateLastVerified: null,
    }));
  } catch {
    return [];
  }
}

async function geocodeCity(
  city: string,
  state: string
): Promise<{ lat: number; lng: number }> {
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        `${city}, ${state}, Brasil`
      )}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
      const geoRes = await fetch(geoUrl);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results?.length) {
          return {
            lat: geoData.results[0].geometry.location.lat,
            lng: geoData.results[0].geometry.location.lng,
          };
        }
      }
    } catch {
      // fallback
    }
  }
  return { lat: -15.78, lng: -47.93 };
}

export async function POST(request: Request) {
  try {
    const { city, state } = await request.json();

    if (!city || !state) {
      return Response.json(
        { error: "Cidade e estado são obrigatórios" },
        { status: 400 }
      );
    }

    const { lat, lng } = await geocodeCity(city, state);
    let allChargers = await fetchChargers(lat, lng, 50);
    console.log('chargers endpoint: OpenChargeMap retornou', allChargers.length);

    // Fallback Google Places se OpenChargeMap retornou 0
    if (allChargers.length === 0) {
      console.log('chargers endpoint: tentando Google Places fallback...');
      allChargers = await fetchChargersGoogle(city, state, lat, lng);
      console.log('chargers endpoint: Google Places retornou', allChargers.length);
    }

    const info = classifyChargers(allChargers);

    // Mapear para o formato esperado pelo frontend (com campos extras do OpenChargeMap)
    const chargers = allChargers.map((c) => ({
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      operator: c.operator,
      powerKW: c.powerKW,
      connectionType: c.connectionType,
      isFastCharge: c.isFastCharge,
      isOperational: c.isOperational,
      totalConnections: c.totalConnections,
      usageCost: c.usageCost,
      levelName: c.levelName,
    }));

    return Response.json({
      chargers,
      summary: {
        total: info.total,
        dc: info.dc,
        ac: info.ac,
        operational: info.operational,
        operators: info.operators,
      },
    });
  } catch (err: unknown) {
    console.error("analyze-city/chargers: erro:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
