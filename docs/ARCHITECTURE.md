# Arquitetura

## Visão geral

```mermaid
flowchart LR
  subgraph Clientes do estabelecimento
    TEL[Ligação telefônica]
    WA[WhatsApp]
  end
  subgraph Equipe
    WEB[Painel web / celular]
  end

  WEB -- "/api/* (mesmo domínio)" --> NEXT[Next.js<br/>apps/web]
  NEXT -- rewrite --> API[API Fastify<br/>apps/api]
  TEL -. Fase 4 .-> VOICE[Gateway de voz<br/>WebSocket de mídia]
  WA -. Fase 4 .-> HOOK[Webhooks WhatsApp]
  VOICE -.-> AGENT[Motor da recepcionista]
  HOOK -.-> AGENT
  AGENT -. ferramentas .-> API
  API --> CORE[(packages/core<br/>motor de agenda,<br/>datas PT-BR, fala)]
  API --> PG[(PostgreSQL<br/>RLS + exclusion constraint)]
  API --> REDIS[(Redis<br/>rate limit / filas)]
```

- **apps/web** — Next.js 16 (App Router). Painel, onboarding, landing. Fala com a API pelo **mesmo
  domínio** (`/api/*` → rewrite), então o cookie de sessão é first-party e nenhuma URL interna ou segredo
  vai para o navegador.
- **apps/api** — Fastify 5, modular por domínio (`modules/auth`, `tenants`, `catalog`, `customers`,
  `appointments`, `dashboard`). Na Fase 4 ganha os pontos de entrada do gateway de voz (WebSocket) e de
  workers (filas), reaproveitando os mesmos serviços.
- **packages/core** — regras de domínio puras e determinísticas (sem I/O). É onde vivem as decisões que
  a IA **não** pode tomar "de cabeça": disponibilidade, validação de horário, interpretação de datas.
- **packages/db** — schema, migrações e utilitários (`withTenant`, lock por profissional, mapeamento de erros).
- **packages/contracts** — schemas Zod compartilhados: a mesma validação no formulário e na API.

### Por que a API não roda na Vercel?

Voz em tempo real exige conexões persistentes (WebSocket de mídia com o provedor de telefonia), filas e
workers. O painel pode ficar na Vercel; a API, o gateway de voz e os workers rodam em contêineres
(Fly.io, Railway, Render, ECS, Cloud Run com WebSocket etc.) — ver [DEPLOYMENT.md](DEPLOYMENT.md).

## Decisões técnicas

| #   | Decisão                                                       | Motivo                                                                                            |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Monorepo pnpm + Turborepo                                     | Contratos e domínio compartilhados sem publicar pacotes; builds incrementais                      |
| 2   | TypeScript 6 (não o 7 nativo)                                 | O TS 7 (port em Go) ainda pode quebrar ferramentas que usam a API JS do compilador                |
| 3   | Fastify + Zod "na mão" (sem type provider)                    | Validação explícita e mensagens em PT-BR; menos acoplamento a plugins                             |
| 4   | Drizzle ORM (em vez de Prisma)                                | SQL explícito, transações com `set_config` para RLS, sem engine binária                           |
| 5   | Multi-tenant em banco compartilhado com `tenant_id` + **RLS** | Escala para milhares de estabelecimentos com custo baixo; RLS é a 2ª camada contra bugs de filtro |
| 6   | FKs compostas `(tenant_id, id)`                               | FKs ignoram RLS; a FK composta garante que relações nunca cruzam estabelecimentos                 |
| 7   | Exclusion constraint `btree_gist` na agenda                   | Garantia atômica contra reservas simultâneas, independente do caminho de escrita                  |
| 8   | Lock consultivo por profissional                              | Serializa reserva × bloqueio × remarcação na mesma agenda (a constraint não cobre folgas)         |
| 9   | Sessões opacas no banco (não JWT)                             | Revogação imediata (logout, troca de senha, desligamento de funcionário)                          |
| 10  | Autenticação própria com Argon2id                             | Controle total, sem custo externo; parâmetros OWASP                                               |
| 11  | UUID v7                                                       | IDs ordenados no tempo, melhor localidade de índice que UUID v4                                   |
| 12  | Valores em centavos (inteiros)                                | Sem erros de ponto flutuante em preços e faturamento                                              |
| 13  | Horários em UTC + fuso IANA do estabelecimento                | Correto em todos os fusos do Brasil e resiliente a mudanças de horário de verão                   |

## Isolamento multi-tenant (defesa em profundidade)

1. **Rota**: tudo de estabelecimento fica sob `/v1/tenants/:tenantId/*`. O pré-handler `resolveTenant`
   exige sessão válida + vínculo **ativo** com aquele estabelecimento; sem vínculo → **404** (não revela existência).
2. **Permissão**: matriz por papel (`lib/permissions.ts`) — Equipe agenda e consulta; Gerente gerencia catálogo
   e agenda; Proprietário também gerencia equipe e cobrança.
3. **Serviço**: toda operação usa `withTenant(db, tenantId, tx => …)`, que abre transação e executa
   `set_config('app.tenant_id', …, true)`.
4. **Banco**: políticas RLS `tenant_id = app_current_tenant()` em leitura **e** escrita. Sem contexto, zero linhas.
5. **Integridade**: FKs compostas impedem que um agendamento aponte para cliente/profissional de outro estabelecimento.

O papel **dono** do schema (migrações, rotinas de plataforma) não é afetado pelo RLS e é usado apenas em
scripts administrativos — nunca nos handlers comuns.

## Fluxo de reserva (o caminho mais crítico)

```mermaid
sequenceDiagram
  participant C as Painel / Recepcionista
  participant A as API (booking.ts)
  participant P as PostgreSQL
  C->>A: POST /appointments (Idempotency-Key)
  A->>P: chave já usada? → devolve a mesma reserva
  A->>P: BEGIN; set_config(app.tenant_id)
  A->>P: pg_advisory_xact_lock(profissional)
  A->>P: chave gravada enquanto esperava o lock? → devolve
  A->>P: expira reservas temporárias vencidas
  A->>P: carrega jornada, folgas, fechamentos e agenda ATUAIS
  A->>A: validateSlot() — mesmo motor que gerou os horários
  A->>P: INSERT (exclusion constraint = garantia final)
  P-->>A: OK  ou  23P01 (conflito) → 409 SLOT_UNAVAILABLE
  A->>P: itens + auditoria; COMMIT
  A-->>C: 201 somente após o COMMIT
```

- "Qualquer profissional": a API ranqueia os profissionais livres (preferido do cliente → menor carga no dia
  → ordem de exibição) e, se alguém ocupar o escolhido no meio do caminho, tenta o próximo.
- Remarcação: cancela o antigo e grava o novo **na mesma transação** — se o novo horário falhar, o original permanece.
- Reserva temporária (`HELD`): a IA poderá segurar um horário por alguns minutos enquanto confirma dados; ela
  bloqueia a agenda até expirar e é limpa automaticamente na próxima reserva daquele profissional.

## Motor de disponibilidade

`computeAvailability()` recebe dados já carregados (jornadas, folgas, ocupações, fechamentos) e devolve
horários por profissional. `validateSlot()` responde se um horário específico pode ser reservado e por quê.
As duas funções têm semântica idêntica — o teste de propriedade com 300 cenários aleatórios verifica que o
conjunto de horários calculados é **exatamente** o conjunto aprovado pela validação individual.

Regras: jornada efetiva = jornada do profissional ∩ horário de funcionamento; o atendimento ocupa
`[início, fim + intervalo de limpeza)`; o intervalo pode ultrapassar o fechamento; antecedência mínima e limite
de dias valem para o cliente (o painel pode marcar em cima da hora); horários fora da grade são oferecidos
quando colados ao término de outro atendimento (menos buracos na agenda).

## Desenho previsto para a recepcionista (Fases 3–4)

- **Ferramentas, não memória**: a IA chama ferramentas sobre os serviços existentes — `resolver_data`
  (resolvedor PT-BR), `listar_servicos`, `consultar_horarios`, `reservar_temporariamente`, `confirmar_reserva`,
  `cancelar`, `remarcar`, `transferir_para_humano`. Toda informação factual vem dessas respostas.
- **Verificação antes de falar**: preços, horários e frases de confirmação na resposta são conferidos contra os
  resultados das ferramentas daquela conversa; "está agendado" só é permitido após `confirmar_reserva` com sucesso.
- **Instruções em camadas** (Voice Studio): segurança/veracidade > fatos do estabelecimento > personagem >
  estilo de linguagem > adaptação ao canal (voz sem emojis e com números por extenso via `toSpeechText`).
- **Voz em tempo real**: provedor SIP/VoIP → WebSocket de mídia → reconhecimento de fala em streaming →
  modelo com streaming → síntese em frases curtas → áudio de volta, com interrupção ("barge-in"). Latências de
  cada etapa serão medidas separadamente (meta inicial de ~1 s percebido em condições favoráveis).
- **Provedores intercambiáveis**: interfaces para LLM, STT, TTS e telefonia, com adaptadores por fornecedor.

## Escalabilidade

- API sem estado (sessão no banco, rate limit no Redis) → escala horizontal.
- Índices por `(tenant_id, …)` em todas as consultas quentes; disponibilidade calculada em memória
  (7 dias × 10 profissionais < 50 ms no motor).
- Organização → várias unidades (tenants): base pronta para redes (Enterprise).
- Próximos passos de escala: réplicas de leitura para relatórios, filas (BullMQ/Redis) para lembretes e
  campanhas, particionamento de mensagens/ligações por tempo quando o volume justificar.
