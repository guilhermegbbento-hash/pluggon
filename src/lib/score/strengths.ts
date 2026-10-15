import type Anthropic from "@anthropic-ai/sdk";
import { ScoreDataError } from "./errors";

/**
 * Pontos fortes do Claude. Sem eles o score final não é entregue: antes, uma
 * falha virava lista vazia e o relatório saía sem a seção, calado.
 */
export function parseStrengths(message: Anthropic.Message): string[] {
  if (message.stop_reason === "refusal") {
    throw new ScoreDataError("pontos_fortes", "o Claude recusou a solicitação");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ScoreDataError("pontos_fortes", "resposta do Claude cortada no limite de tokens");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ScoreDataError("pontos_fortes", "o Claude não devolveu texto");
  }

  let raw = textBlock.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = raw.indexOf("{");
  if (start > 0) raw = raw.substring(start);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ScoreDataError("pontos_fortes", `JSON inválido na resposta do Claude: ${raw.slice(0, 120)}`);
  }
  const strengths = (parsed as { strengths?: unknown }).strengths;
  if (!Array.isArray(strengths)) {
    throw new ScoreDataError("pontos_fortes", "a resposta do Claude não tem a lista de pontos fortes");
  }
  const clean = strengths.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (clean.length === 0) {
    throw new ScoreDataError("pontos_fortes", "o Claude devolveu a lista de pontos fortes vazia");
  }
  return clean;
}
