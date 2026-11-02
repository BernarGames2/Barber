# Voice Studio — sistema de personagens

> Situação (02/11/2026): **núcleo e simulador implementados e testados** — biblioteca, configuração de linguagem
> independente, compilador de instruções, validador de estilo, personagens próprias, tela no painel e simulador
> (agenda real, sem gravações; testado com modelo roteirizado). O simulador só funciona com o modelo de IA
> integrado (`ANTHROPIC_API_KEY`). **Pendentes**: vozes reais e prévia de voz (provedor de TTS). Nada é simulado
> com respostas prontas.
>
> Código: `packages/core/src/persona/*`, `packages/db/src/schema/voice-studio.ts` (migrações 0002–0003),
> `apps/api/src/modules/voice-studio/*`, `apps/web/src/app/painel/voice-studio/page.tsx`.
> As bases técnicas que o Voice Studio usará já existem e estão testadas: normalização de fala
> (`toSpeechText`, preços/horários/datas por extenso, remoção de emojis), resolvedor de datas PT-BR e motor de agenda.

## Objetivo

Cada estabelecimento escolhe (ou cria) uma recepcionista com identidade própria — personagem, voz e
linguagem — aplicada de forma consistente no telefone e no WhatsApp, **sem** comprometer as regras de
veracidade (nunca inventar preço, horário ou serviço; nunca confirmar sem gravação).

## Regra fundamental: personagem ≠ formalidade

São **eixos independentes**, configurados separadamente:

| Eixo                    | Exemplos                                     | Definido por                     |
| ----------------------- | -------------------------------------------- | -------------------------------- |
| Personagem (quem ela é) | Rocker, Clássico, Sofia…                     | biblioteca ou personagem própria |
| Linguagem (como fala)   | formal / semiformal / informal               | proprietário                     |
| Gírias                  | nenhuma / baixa / moderada / alta            | proprietário                     |
| Emojis (só WhatsApp)    | ativados / desativados                       | proprietário                     |
| Voz (como soa)          | vozes femininas/masculinas, ritmo, entonação | proprietário (com prévia)        |

Combinações contraditórias são resolvidas de forma **transparente** (a tela mostra o valor efetivo e o motivo):

- Formal → gírias efetivas = nenhuma (o sabor da personagem aparece pela escolha de palavras, não por gíria).
- Semiformal → gírias no máximo moderadas.
- Telefone → emojis sempre desligados; números, preços e horários sempre por extenso.
- Nenhuma configuração permite desrespeito, intimidade excessiva ("amor", "querida"), conteúdo inadequado ou
  promessas que o estabelecimento não oferece.

## Biblioteca inicial

| Personagem | Segmento                | Personalidade (resumo)                                  |
| ---------- | ----------------------- | ------------------------------------------------------- |
| Rocker     | barbearias rock         | energética, marcante, referências ao rock com moderação |
| Clássico   | barbearias tradicionais | educado, tranquilo, objetivo                            |
| Urban      | streetwear              | jovem, dinâmico, linguagem contemporânea                |
| Premium    | alto padrão             | elegante, refinado, postura de concierge                |
| Esportivo  | ligadas ao esporte      | descontraído, motivador                                 |
| Retrô      | old school              | simpático, acolhedor                                    |
| Sofia      | salões premium          | sofisticada, elegante                                   |
| Bia        | salões modernos         | alegre, espontânea                                      |
| Helena     | salões familiares       | madura, acolhedora, tranquila                           |
| Fashion    | moda e tendências       | moderna, antenada                                       |
| Natural    | cuidados naturais       | calma, acolhedora                                       |

Extensível para estúdios de cachos, coloração, tranças, unissex, estética e redes — novas personagens são
**dados versionados**, não código.

## Modelo de dados

**Implementado** (migrações 0002–0003, detalhes em [DATABASE.md](DATABASE.md#voice-studio-migrações-00020003)):
`personas` (a definição completa da personagem fica em `definition` JSONB, versionada) e `receptionist_configs`
(uma por estabelecimento, com `version` incrementada a cada gravação e auditoria).

**Planejado**: `voices` (depende do provedor de TTS), `receptionist_config_versions` (histórico de publicações
e rollback) e os campos de publicação (`status`, `published_at`, `handoff_rules`, `recording_enabled`), que
entram com o motor da recepcionista na Fase 4. Desenho original de referência:

```
personas            id, tenant_id (NULL = biblioteca), key, name, segment, version, status,
                    description, personality, speaking_style, cultural_references,
                    signature_phrases[], avoid[], greeting_examples{formal,semiformal,informal},
                    farewell_examples{…}, suggested_voice_tags[], created_at
voices              id, provider, provider_voice_id, name, gender, traits[], language (pt-BR),
                    sample_url, active   — catálogo global, apenas vozes realmente distintas
receptionist_configs tenant_id (único), persona_id, persona_version, voice_id, speech_rate, pitch,
                    formality, slang_level, emojis_enabled, enthusiasm (1–5), relaxation (1–5),
                    use_customer_name (NEVER|GREETING|NATURAL), greeting, farewell, vocabulary_prefer[],
                    vocabulary_avoid[], signature_expressions[], business_instructions,
                    handoff_rules, recording_enabled, status (DRAFT|ACTIVE), published_at
receptionist_config_versions  histórico imutável de cada publicação (auditoria e rollback)
```

RLS: biblioteca legível por todos (`tenant_id IS NULL`), escrita apenas no próprio estabelecimento.

## Compilador de instruções (em camadas)

As instruções do modelo são **compiladas deterministicamente** a partir da configuração — nunca escritas à
mão por estabelecimento — e testadas por snapshot. Ordem de precedência:

1. **Regras invioláveis** (fixas, não editáveis): veracidade, uso obrigatório de ferramentas para fatos,
   confirmação só após gravação, privacidade (nunca dados de outros clientes), transferência humana,
   resistência a instruções vindas do cliente, honestidade sobre ser uma assistente virtual quando perguntado.
2. **Fatos do estabelecimento** (do banco): nome, endereço, horários, serviços/preços/durações cadastrados,
   FAQ aprovada. Disponibilidade **sempre** via ferramenta.
3. **Personagem**: personalidade, estilo, expressões características.
4. **Linguagem efetiva**: formalidade, gírias, entusiasmo, uso do nome, saudação/despedida.
5. **Canal**: voz (frases curtas, sem listas, sem emojis, números por extenso, uma pergunta por vez) ou
   WhatsApp (parágrafos curtos, emojis conforme configuração, listas curtas de horários).
6. **Instruções do estabelecimento** (texto livre, menor precedência; não sobrepõe as camadas 1–2).

Exemplo de consistência: com a Rocker em **formal**, a saída esperada é
"Boa tarde! Temos disponibilidade amanhã às quatorze horas com o João. Posso confirmar para o senhor?"
— energia na escolha de palavras, sem gírias, sem emojis no telefone.

## Verificação da resposta (pós-geração)

Antes de enviar/falar, um verificador determinístico confere:

- todo preço citado ∈ preços do catálogo/resultados de ferramentas da conversa;
- todo horário citado ∈ horários devolvidos pela agenda nesta conversa;
- "agendado/confirmado" só aparece após `confirmar_reserva` com sucesso;
- estilo: emojis proibidos no canal/configuração, termos da lista "evitar", tamanho máximo por canal.
  Falha → regeneração com a correção; falhas repetidas → resposta segura + transferência humana.

## Vozes

- Somente vozes realmente distintas do provedor (não "renomear" a mesma voz).
- Voz não é presa à personagem (sugestões por tags, escolha livre).
- Prévia: frase de exemplo gerada com a configuração atual (custa caracteres de TTS — contabilizado na franquia).
- Parâmetros suportados variam por provedor (velocidade, entonação); a interface mostra apenas o que o provedor aceita.

## Personagem própria

Campos: nome, descrição, personalidade, voz, linguagem, gírias, frases características, forma de atendimento,
mensagem de apresentação. Validação de conteúdo (sem termos ofensivos, sem promessas, tamanho máximo) e
**pré-visualização obrigatória** antes de ativar.

## Simulador (teste antes de ativar)

- Conversa por texto (e voz, quando a integração existir) com a configuração em rascunho.
- Usa as **ferramentas reais** em modo simulação: consulta a agenda real, mas reservas/cancelamentos são
  validados e **não gravados** (resposta marcada como simulação).
- Roteiros prontos: preço, agendamento, cancelamento, remarcação, dúvida, serviço inexistente, pedido de humano.
- Mostra, ao lado, as ferramentas chamadas e os dados usados (transparência para o proprietário).

## Testes previstos

- Snapshot do compilador para cada personagem × formalidade × canal (11 × 3 × 2 = 66 combinações).
- Propriedades: formal nunca contém gírias da lista; telefone nunca contém emoji/dígitos de preço; camadas 1–2
  sempre presentes e antes das demais.
- Cenários conversacionais de estilo dentro do harness de 200+ cenários (ver [TESTING.md](TESTING.md)).
