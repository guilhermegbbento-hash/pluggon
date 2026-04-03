import { searchPlaces, deduplicatePlaces } from "@/lib/google-places";
import type { PlaceResult } from "@/lib/google-places";

export const maxDuration = 120;

interface ChargerResult extends PlaceResult {
  operator: string;
}

function extractOperator(name: string): string {
  const lower = name.toLowerCase();
  const operators = [
    "tupinambá", "tupinamba", "zletric", "ezvolt", "shell recharge",
    "byd", "volvo", "bmw", "neocharge", "wayra", "celesc", "cpfl",
    "enel", "raízen", "raizen", "ipiranga",
  ];
  for (const op of operators) {
    if (lower.includes(op)) return op.charAt(0).toUpperCase() + op.slice(1);
  }
  return "";
}

async function fetchExistingChargers(
  city: string,
  state: string
): Promise<ChargerResult[]> {
  const queries = [
    "eletroposto carregador elétrico veículos",
    "ev charging station",
    "carregador elétrico carro",
  ];
  const allResults = await Promise.all(
    queries.map((q) => searchPlaces(q, city, state))
  );
  return deduplicatePlaces(allResults).map((p) => ({
    ...p,
    operator: extractOperator(p.name),
  }));
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

    const chargers = await fetchExistingChargers(city, state);
    return Response.json({ chargers });
  } catch (err: unknown) {
    console.error("analyze-city/chargers: erro:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return Response.json({ error: message }, { status: 500 });
  }
}
