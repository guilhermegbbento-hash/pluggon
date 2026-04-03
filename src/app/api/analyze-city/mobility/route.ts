import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";

export const maxDuration = 120;

interface MobilityZone {
  name: string;
  lat: number;
  lng: number;
  address: string;
  type: string;
  typeLabel: string;
}

const MOBILITY_QUERIES: { query: string; type: string; typeLabel: string }[] = [
  { query: "ponto de taxi", type: "taxi", typeLabel: "Ponto de Táxi" },
  { query: "aeroporto", type: "aeroporto", typeLabel: "Aeroporto" },
  { query: "rodoviária terminal rodoviário", type: "rodoviaria", typeLabel: "Rodoviária" },
  { query: "shopping center", type: "shopping", typeLabel: "Shopping" },
  { query: "hospital", type: "hospital", typeLabel: "Hospital" },
  { query: "universidade faculdade", type: "universidade", typeLabel: "Universidade" },
  { query: "centro de distribuição logística", type: "logistica", typeLabel: "Centro Logístico" },
  { query: "posto GNV gás natural veicular", type: "gnv", typeLabel: "Posto GNV" },
];

async function fetchMobilityZones(
  city: string,
  state: string
): Promise<MobilityZone[]> {
  const allResults = await Promise.all(
    MOBILITY_QUERIES.map(async ({ query, type, typeLabel }) => {
      const places = await searchPlaces(query, city, state, 10);
      return places.map((p) => ({
        ...p,
        type,
        typeLabel,
      }));
    })
  );
  return deduplicatePlaces(allResults);
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

    const mobilityZones = await fetchMobilityZones(city, state);
    return Response.json({ mobilityZones });
  } catch (err: unknown) {
    console.error("analyze-city/mobility: erro:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
