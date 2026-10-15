// Modelo do Claude e preço num lugar só. O nome repetido em cada rota fez o
// claude-sonnet-4-20250514 ser aposentado (15/06/2026) sem ninguém trocar: as
// rotas ficaram quatro meses chamando um modelo que respondia 404.
//
// O Sonnet 5.5 pensa por padrão e o raciocínio conta dentro do max_tokens —
// cada rota dimensiona max_tokens e effort para o JSON/texto não sair cortado.

export const CLAUDE_MODEL = "claude-sonnet-5-5";

// Claude Sonnet 5.5: US$ 2 por milhão de tokens de entrada, US$ 10 de saída.
export const CLAUDE_INPUT_COST_PER_TOKEN = 2 / 1_000_000;
export const CLAUDE_OUTPUT_COST_PER_TOKEN = 10 / 1_000_000;
