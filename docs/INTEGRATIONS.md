# Integrações externas

> Situação: **nenhuma integração externa está ativa**. O adaptador da Anthropic está implementado (SDK oficial)
> e fica inativo sem `ANTHROPIC_API_KEY` — **nenhuma chamada real foi feita** até agora. Antes de implementar
> cada integração, a documentação oficial atualizada é consultada — endpoints, parâmetros e limites não são
> presumidos. Contratar qualquer serviço pago exige autorização do proprietário do projeto.

## O que o proprietário do projeto precisa contratar/criar

| #   | Serviço                                                        | Para quê                                      | Conta / credenciais necessárias                                                                                                                                                                  | Fase |
| --- | -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | **Anthropic (API Claude)** — código pronto                     | cérebro da recepcionista e do Copilot         | conta de organização, `ANTHROPIC_API_KEY`, limites de gasto configurados                                                                                                                         | 3–4  |
| 2   | **Reconhecimento de fala (STT)** em streaming, pt-BR           | entender ligações e áudios do WhatsApp        | conta e chave do provedor escolhido                                                                                                                                                              | 4    |
| 3   | **Síntese de voz (TTS)** pt-BR                                 | voz da recepcionista; prévias no Voice Studio | conta e chave; licença comercial das vozes                                                                                                                                                       | 3–4  |
| 4   | **Telefonia SIP/VoIP**                                         | receber ligações, transferir para a equipe    | conta no provedor, números brasileiros (com documentação regulatória), credenciais SIP/API, URL de webhook                                                                                       | 4    |
| 5   | **WhatsApp Business Platform (Meta — Cloud API)**              | mensagens oficiais                            | Meta Business verificado, app Meta, WABA por estabelecimento (Embedded Signup como provedor de tecnologia), token de usuário de sistema, app secret, verify token, modelos de mensagem aprovados | 4    |
| 6   | **Pagamentos** (Mercado Pago ou Stripe)                        | assinaturas dos planos                        | conta empresarial, chaves de API, segredo de webhook                                                                                                                                             | 6    |
| 7   | **E-mail transacional** (Resend, Amazon SES, Postmark ou SMTP) | confirmação de e-mail, redefinição de senha   | domínio com SPF/DKIM/DMARC, chave da API                                                                                                                                                         | 2/6  |
| 8   | Hospedagem e dados                                             | ver [DEPLOYMENT.md](DEPLOYMENT.md)            | contas na nuvem escolhida                                                                                                                                                                        | —    |
| 9   | Monitoramento (ex.: Sentry)                                    | erros e desempenho                            | DSN do projeto                                                                                                                                                                                   | —    |

### Notas por integração

**Modelo de linguagem (implementado, inativo)** — `apps/api/src/modules/receptionist/llm.ts`, SDK
`@anthropic-ai/sdk` 1.3.0, Messages API com ferramentas definidas pela plataforma e laço manual. Configuração no
servidor: `ANTHROPIC_API_KEY` (obrigatória para ativar; nunca enviada ao painel), `ANTHROPIC_MODEL` (padrão
`claude-opus-5-5`), `ANTHROPIC_EFFORT` (`low`/`medium`/`high`, padrão `medium`). A requisição usa raciocínio
adaptativo, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`: em recusa de segurança a própria API
tenta o modelo de contingência), `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta
`thinking-binding-controls-2026-08-01`) e cache automático de prompt. O modelo e o esforço para voz (latência) e
para WhatsApp devem ser escolhidos **medindo** qualidade, latência e custo com o simulador e os cenários — essa
medição gera custo e depende de autorização. Limites de gasto por estabelecimento seguirão as franquias dos planos.

**Voz (STT/TTS)** — critérios de escolha: naturalidade em português do Brasil (vozes femininas e masculinas
**realmente distintas**), latência do primeiro áudio, streaming, estabilidade com áudio telefônico (8 kHz),
custo por minuto/caractere e licença comercial. Recomenda-se teste cego com os Founding Partners antes de decidir.

**Decisões do proprietário (02/11/2026)** — cada barbearia usa o **próprio número**: no WhatsApp, conecta o
número dela à plataforma (fluxo oficial da Meta para provedores de tecnologia; avaliar a coexistência com o app
WhatsApp Business); nas ligações, ativa o desvio na operadora para um número virtual da plataforma (um por
barbearia, invisível ao cliente). Padrão: a recepcionista **atende sempre** (desvio incondicional); "só quando a
equipe não atende" ficará como opção por barbearia.

**Telefonia** — opções a avaliar: provedores programáveis com streaming de mídia por WebSocket (ex.: Twilio,
Telnyx, Vonage) ou operadoras VoIP brasileiras com tronco SIP conectado a um servidor SIP próprio. Para o piloto,
o caminho mais simples costuma ser **desvio de chamadas** do número atual do estabelecimento para o número da
plataforma (sempre, ou quando ocupado/sem resposta), sem portabilidade. Ligações telefônicas convencionais e
chamadas de voz dentro do WhatsApp são canais diferentes.

**WhatsApp** — somente a plataforma oficial da Meta (nada de soluções não oficiais que arriscam o número).
Regras que o produto vai respeitar: janela de atendimento de 24 h iniciada pelo cliente; fora dela, apenas
**modelos aprovados** (lembretes = utilidade; campanhas = marketing, com consentimento); opt-out respeitado;
verificação de assinatura dos webhooks. Avaliar a disponibilidade da coexistência (mesmo número no app
WhatsApp Business e na Cloud API) para estabelecimentos que não querem trocar de número.

**Pagamentos** — nenhuma cobrança sem autorização explícita do cliente; teste gratuito não captura cartão por
padrão; inadimplência leva a suspensão em etapas (aviso → somente leitura), nunca a perda de dados.

## Custos

Os preços dos provedores mudam com frequência e **não foram cotados** nesta etapa. O modelo abaixo deve ser
preenchido com cotações atuais antes de confirmar preços e franquias dos planos.

**Custo por minuto de ligação atendida pela IA**

```
custo_min = telefonia_entrada_min
          + stt_min
          + (tokens_entrada_min × preço_entrada + tokens_saída_min × preço_saída)   # modelo
          + tts_caracteres_min × preço_caractere
```

**Custo por estabelecimento/mês** = `minutos × custo_min` + `mensagens_modelo × preço_por_modelo` (WhatsApp)

- `conversas_IA × custo_médio_LLM` + número telefônico + armazenamento (gravações, se habilitadas).

Fatores que reduzem custo: cache de prompt, respostas curtas por voz, ferramentas determinísticas (o resolvedor
de datas e o motor de agenda rodam localmente, sem tokens), transferência para humano em casos fora do escopo.

As franquias atuais dos planos (`packages/db/src/seed-plans.ts`) são **conservadoras e provisórias**: teste
gratuito 30 min de voz/200 mensagens; Founding Partner 400 min/3.000 mensagens; Start 200 min; Pro 500 min;
Enterprise 1.500 min. Devem ser recalculadas com o custo real por minuto.

Onde cotar: páginas oficiais de preços da Anthropic, do provedor de voz escolhido, do provedor de telefonia
(tarifas de entrada para números do Brasil + mensalidade do número) e a tabela de preços por país da WhatsApp
Business Platform (Meta).
