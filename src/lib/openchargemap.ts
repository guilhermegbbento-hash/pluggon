export interface ChargerStation {
  name: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  state: string;
  operator: string;
  powerKW: number;
  connectionType: string;
  level: number;
  levelName: string;
  isOperational: boolean;
  isFastCharge: boolean;
  totalConnections: number;
  usageCost: string;
  dateLastVerified: string | null;
}

export async function fetchChargers(
  lat: number,
  lng: number,
  radiusKm: number = 50
): Promise<ChargerStation[]> {
  const apiKey = process.env.OPENCHARGEMAP_API_KEY || "";
  const keyParam = apiKey ? `&key=${apiKey}` : "";
  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&latitude=${lat}&longitude=${lng}&distance=${radiusKm}&distanceunit=KM&maxresults=500&compact=true&verbose=false${keyParam}`;
  console.log(`OpenChargeMap: buscando carregadores em (${lat}, ${lng}) raio ${radiusKm}km${apiKey ? " [com API key]" : " [SEM API key - pode falhar]"}`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BLEV-Intelligence/1.0" },
    });
    if (!res.ok) {
      console.error(`OpenChargeMap: HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    console.log(`OpenChargeMap: ${data.length} resultados brutos recebidos`);
    return data.map((station: any) => ({
      name: station.AddressInfo?.Title || "Sem nome",
      lat: station.AddressInfo?.Latitude,
      lng: station.AddressInfo?.Longitude,
      address: station.AddressInfo?.AddressLine1 || "",
      city: station.AddressInfo?.Town || "",
      state: station.AddressInfo?.StateOrProvince || "",
      operator: station.OperatorInfo?.Title || "Desconhecido",
      powerKW: station.Connections?.[0]?.PowerKW || 0,
      connectionType:
        station.Connections?.[0]?.ConnectionType?.Title || "Desconhecido",
      level: station.Connections?.[0]?.LevelID || 0,
      levelName: station.Connections?.[0]?.Level?.Title || "Desconhecido",
      isOperational: station.StatusType?.IsOperational ?? true,
      isFastCharge: (station.Connections?.[0]?.PowerKW || 0) >= 40,
      totalConnections: station.NumberOfPoints || 1,
      usageCost: station.UsageCost || "Não informado",
      dateLastVerified: station.DateLastVerified || null,
    }));
  } catch (err) {
    console.error('OpenChargeMap: erro na requisição:', err);
    return [];
  }
}

export function classifyChargers(chargers: ChargerStation[]) {
  const total = chargers.length;
  const dc = chargers.filter((c) => c.isFastCharge).length;
  const ac = total - dc;
  const operational = chargers.filter((c) => c.isOperational).length;
  const operators = [...new Set(chargers.map((c) => c.operator))];
  return { total, dc, ac, operational, operators, chargers };
}

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

export function filterChargersByRadius(
  chargers: ChargerStation[],
  lat: number,
  lng: number,
  radiusKm: number
): ChargerStation[] {
  const radiusM = radiusKm * 1000;
  return chargers.filter(
    (c) => haversineDistance(lat, lng, c.lat, c.lng) <= radiusM
  );
}
