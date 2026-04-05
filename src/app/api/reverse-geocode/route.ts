const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng || !GOOGLE_MAPS_API_KEY) {
    return Response.json({ address: null });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
    const res = await fetch(url);
    if (!res.ok) return Response.json({ address: null });

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) {
      return Response.json({ address: null });
    }

    return Response.json({ address: data.results[0].formatted_address });
  } catch {
    return Response.json({ address: null });
  }
}
