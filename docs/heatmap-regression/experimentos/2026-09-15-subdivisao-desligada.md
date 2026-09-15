# Experimento — subdivisão desligada × dedupe atual

Rodado em 2026-09-15T20:29:43.277Z · gerador v3.2.1 · código df52cd8bf97a86de · ~206 requisições Google.

- **A — antes** (regressão 2026-09-14T22:24:12.181Z): sem subdivisão, dedupe anterior.
- **B — este experimento**: subdivisão desligada (`maxDepth = 0`), dedupe atual, sem QA gate.
- **C — com subdivisão** (regressão 2026-09-15T20:29:06.909Z): subdivisão ligada, dedupe atual.
- **Efeito da dedupe = B − A. Efeito da subdivisão = C − B.** A e C são rodadas em horários diferentes: o Google muda um pouco entre elas, então diferenças de ±2 são ruído.

| Caso | A antes | B sem subdivisão | C com subdivisão | Dedupe (B−A) | Subdivisão (C−B) | Busca B: células / no teto | Busca C: células / no teto |
|---|---|---|---|---|---|---|---|
| a) Morumbi — São Paulo/SP | 11 (2/5/4) | 11 (2/5/4) | 11 (2/5/4) | +0 | +0 | 3 / 0 | 3 / 0 |
| b) Itaim Bibi — São Paulo/SP | 59 (1/42/16) | 46 (1/31/14) | 134 (4/88/42) | -13 | +88 | 3 / 1 | 42 / 0 |
| c) Batel — Curitiba/PR | 28 (2/16/10) | 28 (2/16/10) | 43 (6/20/17) | +0 | +15 | 3 / 1 | 15 / 0 |
| d) Centro — Florianópolis/SC | 40 (7/28/5) | 39 (6/28/5) | 71 (11/46/14) | -1 | +32 | 3 / 1 | 27 / 0 |
| e) Jardim Ângela — São Paulo/SP | 0 (0/0/0) | 0 (0/0/0) | 0 (0/0/0) | +0 | +0 | 3 / 0 | 3 / 0 |
| f) Curitiba/PR (cidade inteira) | 88 (14/48/26) | 91 (13/49/29) | 252 (47/113/92) | +3 | +161 | 3 / 2 | 95 / 0 |

Concorrentes em (DC/AC/não informado). "No teto" = células que voltaram cheias da API sem poder subdividir — em B, cada uma é concorrência possivelmente cortada.
