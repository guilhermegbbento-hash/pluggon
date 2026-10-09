# Levantamento — hospital no teto da API em Teresina/PI (2026-10-09)

Só números agregados; nenhum conteúdo do Google versionado. Custo: 73 requisições
Places + 1 geocoding (≈ US$ 2,60).

**Erro em produção:** `[camada_incompleta] âncoras: searchText "hospital" em Teresina continuou no teto da API em 1 célula(s) após subdividir até a profundidade 6`.

## Escopo e busca de produção

- Modo cidade, raio 20 km (teto do modo). Célula na profundidade 6: 625 m de lado, meia-diagonal 442 m.
- Busca de hospital (`includedType: hospital` + `strictTypeFiltering`): 41 células, 65 requisições, 305 lugares únicos, 1 célula no teto.
- A busca **não** casa por nome: tudo que volta tem `hospital` em `types`. O ruído vem de o Google pôr `hospital` em clínica, centro médico e consultório.

## A célula no teto (polo médico, centro-sul)

| | n |
|---|---|
| Resultados (3 páginas, 60 únicos, todos dentro do retângulo) | 60 |
| `primaryType = hospital` | 43 |
| outros `primaryType` (medical_center 13, general_hospital, medical_clinic, insurance_agency, health) | 17 |
| ≥ 200 avaliações | 11 |
| ≥ 200 avaliações **e** `primaryType = hospital` | 6 |

## Hipótese 1 — busca por popularidade (testada primeiro)

`searchNearby`, `includedTypes: [hospital]`, `rankPreference: POPULARITY`, círculo da célula, 20 resultados.

- 20º resultado: 70 avaliações; mínimo entre os 20: 42 → pela regra proposta, "completo".
- **Mas** um lugar com 381 avaliações, dentro da célula, ficou fora dos 20 — enquanto lugares com 42, 70 e 74 entraram.
- Popularidade do Google ≠ número de avaliações. **Refutada como prova de completude**: o critério "20º abaixo de 200" teria declarado completa uma camada que perdia um ponto acima do piso.

## Hipótese 2 — subir a profundidade

Profundidade 7 na célula: 15 / 12 / 3 / 9 resultados, **nenhuma** no teto (profundidade 8 nem foi necessária, 12 requisições).

- União das profundidades 6 + 7: os mesmos 60 lugares; nenhum novo, nenhum novo com ≥ 200 avaliações.
- Os quatro filhos juntos devolveram **39** dos 60 que a célula-mãe devolveu. A `searchText` não é exaustiva dentro do retângulo: em células menores ela devolve menos do que existe. "Célula fora do teto" não prova "camada completa".
- Maior aglomerado no mesmo ponto (~10 m): 3 lugares — não é prédio com dezenas de registros.

## Hipótese 3 — gerar com âncora incompleta e aviso

Implementada (v3.2.2): concorrente no teto aborta; âncora no teto gera o mapa com aviso
no relatório de execução. O gate de escopo e o de completude dos concorrentes rodam
antes de buscar âncoras, renda e complementares.

## Em aberto

- A `searchText` devolver menos em células menores afeta toda camada buscada só por
  ela (âncoras). Não dá para medir completude pelo teto de 60. Concorrente usa também
  `searchNearby` por distância, que não tem esse problema.
- Subir `maxDepth` para 7 teria tirado Teresina do teto ao custo de ~12 requisições,
  mas, pelo achado acima, isso apaga o sinal sem garantir completude.
