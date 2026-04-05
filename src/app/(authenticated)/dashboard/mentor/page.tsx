"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como escolher o melhor ponto pra eletroposto?",
  "Quanto custa instalar um carregador DC 80kW?",
  "Como negociar com dono do ponto?",
  "Qual o payback de um eletroposto?",
  "Como precificar o kWh?",
  "Vale a pena usina solar?",
];

export default function MentorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    setError(null);
    const history = messages;
    const nextMessages: ChatMessage[] = [...history, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/mentor-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, lastMessage: question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao consultar o mentor.");
      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado.";
      setError(msg);
      setMessages(history);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Mentor IA</h1>
        <p className="mt-1 text-sm text-[#8B949E]">
          Converse com a mente do Guilherme Bento. Dúvidas sobre eletropostos, números, negociação e estratégia.
        </p>
      </div>

      {/* Chat container */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-[#30363D] bg-[#0D1117]">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b border-[#30363D] bg-[#161B22] px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#E4C368] to-[#C9A84C] text-base font-bold text-[#0D1117] shadow-[0_0_20px_rgba(201,168,76,0.3)]">
            GB
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">Guilherme Bento — Mentor IA BLEV</div>
            <div className="flex items-center gap-1.5 text-xs text-[#8B949E]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3FB950]" />
              Online • Responde em segundos
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
          {messages.length === 0 && (
            <div className="space-y-5">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E4C368] to-[#C9A84C] text-xs font-bold text-[#0D1117]">
                  GB
                </div>
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-[#161B22] px-4 py-3 text-sm leading-relaxed text-[#E6EDF3]">
                  E aí, tudo certo? Sou o Guilherme Bento. Pode mandar qualquer dúvida sobre eletroposto —
                  investimento, ponto, contrato, precificação, payback. Vou responder direto, sem enrolação.
                </div>
              </div>

              <div className="pl-12">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#8B949E]">
                  Sugestões pra começar
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={loading}
                      className="rounded-full border border-[#30363D] bg-[#161B22] px-3.5 py-1.5 text-xs text-[#E6EDF3] transition-colors hover:border-[#C9A84C] hover:bg-[#21262D] hover:text-[#C9A84C] disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E4C368] to-[#C9A84C] text-xs font-bold text-[#0D1117]">
                GB
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-[#161B22] px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8B949E] [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8B949E] [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8B949E]" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mx-auto max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-[#30363D] bg-[#161B22] px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Pergunta pro Guilherme..."
              rows={1}
              disabled={loading}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-[#30363D] bg-[#0D1117] px-4 py-2.5 text-sm text-white placeholder-[#6e7681] outline-none transition-colors focus:border-[#C9A84C] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C9A84C] text-[#0D1117] transition-all hover:bg-[#E4C368] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Enviar"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#1a3a4a] px-4 py-3 text-sm leading-relaxed text-[#E6EDF3]">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E4C368] to-[#C9A84C] text-xs font-bold text-[#0D1117]">
        GB
      </div>
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#161B22] px-4 py-3 text-sm leading-relaxed text-[#E6EDF3]">
        {message.content}
      </div>
    </div>
  );
}
