import { createClient } from "@/lib/supabase/server";

interface UsageLogParams {
  module: "heatmap" | "score" | "bp" | "market" | "mentor";
  city?: string;
  claudeTokensIn?: number;
  claudeTokensOut?: number;
  googlePlacesQueries?: number;
}

// Sonnet pricing: $3/M input, $15/M output
const CLAUDE_INPUT_COST_PER_TOKEN = 0.003 / 1000;
const CLAUDE_OUTPUT_COST_PER_TOKEN = 0.015 / 1000;
const GOOGLE_PLACES_COST_PER_QUERY = 0.032;

export async function logUsage(params: UsageLogParams) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const claudeCost =
      (params.claudeTokensIn || 0) * CLAUDE_INPUT_COST_PER_TOKEN +
      (params.claudeTokensOut || 0) * CLAUDE_OUTPUT_COST_PER_TOKEN;
    const googleCost =
      (params.googlePlacesQueries || 0) * GOOGLE_PLACES_COST_PER_QUERY;

    await supabase.from("usage_logs").insert({
      user_id: user?.id || null,
      module: params.module,
      city: params.city || null,
      claude_tokens_in: params.claudeTokensIn || 0,
      claude_tokens_out: params.claudeTokensOut || 0,
      claude_cost_usd: claudeCost,
      google_places_queries: params.googlePlacesQueries || 0,
      google_places_cost_usd: googleCost,
      total_cost_usd: claudeCost + googleCost,
    });
  } catch (err) {
    console.error("usage-logger: erro ao salvar:", err);
  }
}
