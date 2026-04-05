import Anthropic from "@anthropic-ai/sdk";
import { MENTOR_SYSTEM_PROMPT } from "@/lib/mentor-knowledge";

export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
    const lastMessage: string = typeof body.lastMessage === "string" ? body.lastMessage : "";

    if (!lastMessage.trim()) {
      return Response.json({ error: "Pergunta vazia." }, { status: 400 });
    }

    const history: ChatMessage[] = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content }));

    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: [
        {
          type: "text",
          text: MENTOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        ...history,
        { role: "user", content: lastMessage },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const reply = textBlock && textBlock.type === "text" ? textBlock.text : "Não consegui gerar resposta.";

    return Response.json({ reply });
  } catch (err) {
    console.error("Mentor chat error:", err);
    return Response.json(
      { error: "Erro ao consultar o mentor. Tente novamente." },
      { status: 500 }
    );
  }
}
