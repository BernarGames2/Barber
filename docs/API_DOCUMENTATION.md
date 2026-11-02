# API do Barber Voice

Base: `https://<api>/` (em desenvolvimento `http://localhost:4000`). O painel acessa a API pelo mesmo
domínio em `/api/*`. Todas as rotas versionadas ficam sob `/v1`.

## Convenções

- Corpo **somente JSON** (`Content-Type: application/json`); outros tipos → `415`.
- Datas/horas: instantes ISO 8601 **com fuso** (`2026-11-06T15:00:00-03:00`); datas locais `AAAA-MM-DD`;
  horas locais `HH:mm`. Valores monetários em **centavos**. Telefones devolvidos em E.164.
- Respostas de erro:
  ```json
  {
    "error": {
      "code": "SLOT_UNAVAILABLE",
      "message": "Este horário já está ocupado.",
      "details": { "reason": "CONFLICT" }
    }
  }
  ```
  Erros de validação (`400 VALIDATION_ERROR`) trazem `details: [{ "path": "phone", "message": "Telefone inválido. Inclua o DDD." }]`.
- Cabeçalhos: `x-request-id` em toda resposta; `cache-control: no-store`.

## Autenticação

Sessão por cookie `bv_session` (HttpOnly, SameSite=Lax, Secure em produção), emitido em cadastro/login.
Requisições mutáveis com cookie precisam vir de uma origem autorizada (`Origin`), senão `403 CSRF_REJECTED`.

| Método | Rota                       | Descrição                                                                                                 |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/signup`          | `{ name, email, password, acceptTerms: true }` → `201` + cookie + perfil                                  |
| POST   | `/v1/auth/login`           | `{ email, password }` → perfil + cookie. Falha: `401 INVALID_CREDENTIALS`; bloqueio: `429 ACCOUNT_LOCKED` |
| POST   | `/v1/auth/logout`          | revoga a sessão → `204`                                                                                   |
| GET    | `/v1/auth/me`              | `{ user, memberships[] }`                                                                                 |
| POST   | `/v1/auth/password/forgot` | `{ email }` → sempre `202` (não revela se a conta existe)                                                 |
| POST   | `/v1/auth/password/reset`  | `{ token, password }` → encerra todas as sessões                                                          |
| POST   | `/v1/auth/password/change` | `{ currentPassword, newPassword }` → encerra as outras sessões                                            |
| POST   | `/v1/auth/email/verify`    | `{ token }`                                                                                               |
| POST   | `/v1/auth/email/resend`    | reenvia confirmação                                                                                       |
| GET    | `/v1/auth/sessions`        | sessões ativas (`current` marca a atual)                                                                  |
| DELETE | `/v1/auth/sessions/:id`    | encerra uma sessão                                                                                        |

Senha: mínimo de 10 caracteres com letras e números. Rate limit por IP: signup 5/min, login 10/min,
forgot 5/min; bloqueio da conta após 10 falhas por 15 min.

## Públicas

| Método | Rota       | Descrição                                     |
| ------ | ---------- | --------------------------------------------- |
| GET    | `/health`  | processo vivo                                 |
| GET    | `/ready`   | banco respondendo (`503` se não)              |
| GET    | `/v1/meta` | categorias, fusos do Brasil e planos públicos |

## Estabelecimentos

| Método  | Rota                    | Permissão          | Descrição                                                                                                                    |
| ------- | ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| POST    | `/v1/tenants`           | autenticado        | cria estabelecimento (usuário vira Proprietário; teste gratuito com franquia)                                                |
| GET     | `/v1/tenants/:tenantId` | qualquer papel     | dados do estabelecimento                                                                                                     |
| PATCH   | `/v1/tenants/:tenantId` | gerente+           | dados, endereço, fuso e regras (`slotIntervalMin`, `minBookingNoticeMin`, `maxBookingDaysAhead`, `cancellationMinNoticeMin`) |
| GET/PUT | `…/business-hours`      | leitura / gerente+ | `{ intervals: [{ weekday: 1, start: "09:00", end: "12:00" }] }`                                                              |
| GET     | `…/closures?all=true`   | qualquer           | fechamentos (padrão: futuros)                                                                                                |
| POST    | `…/closures`            | gerente+           | `{ kind: "HOLIDAY", title, startsAt, endsAt, allDay }`                                                                       |
| DELETE  | `…/closures/:id`        | gerente+           | remove                                                                                                                       |
| GET     | `…/onboarding`          | qualquer           | etapas e se pode concluir                                                                                                    |
| POST    | `…/onboarding/complete` | gerente+           | conclui (`422 ONBOARDING_INCOMPLETE` com `missing`)                                                                          |

Sem vínculo ativo com o estabelecimento → `404` (não revela existência). Estabelecimento suspenso → só `GET`
(`403 TENANT_SUSPENDED`).

## Catálogo

| Método         | Rota                                   | Permissão | Descrição                                                                                                                                         |
| -------------- | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET            | `…/services?active=true`               | qualquer  | serviços (sem arquivados)                                                                                                                         |
| POST           | `…/services`                           | gerente+  | `{ name, durationMin, priceType: "FIXED"\|"STARTING_AT"\|"ON_REQUEST", priceCents, bufferAfterMin, bookableByAi, … }` (`409 SERVICE_NAME_EXISTS`) |
| PATCH / DELETE | `…/services/:id`                       | gerente+  | atualiza / arquiva                                                                                                                                |
| GET            | `…/professionals`                      | qualquer  | com `workingHours` (null = horário da casa) e `services`                                                                                          |
| POST           | `…/professionals`                      | gerente+  | `{ name, serviceIds[], workingHours?: [...] \| null, color, … }`                                                                                  |
| PATCH          | `…/professionals/:id`                  | gerente+  | dados básicos                                                                                                                                     |
| PUT            | `…/professionals/:id/schedule`         | gerente+  | `{ workingHours: [...] \| null }`                                                                                                                 |
| PUT            | `…/professionals/:id/services`         | gerente+  | `{ services: [{ serviceId, durationMin?, priceCents? }] }`                                                                                        |
| DELETE         | `…/professionals/:id`                  | gerente+  | arquiva (`409 PROFESSIONAL_HAS_UPCOMING_APPOINTMENTS`)                                                                                            |
| GET            | `…/time-off?from=&to=&professionalId=` | qualquer  | folgas no período (instantes ISO)                                                                                                                 |
| POST           | `…/time-off?force=true`                | gerente+  | `{ professionalId, kind, reason, startsAt, endsAt }`; com agendamentos no período → `409 TIME_OFF_CONFLICTS` (lista) a menos que `force=true`     |
| DELETE         | `…/time-off/:id`                       | gerente+  | remove                                                                                                                                            |

## Agenda

### Disponibilidade

`GET …/availability?serviceIds=<id>,<id>&from=2026-11-03&to=2026-11-03[&professionalId=][&timeFrom=13:00&timeTo=15:00][&excludeAppointmentId=]`

```json
{
  "timezone": "America/Sao_Paulo",
  "durationByProfessional": { "<profId>": 40 },
  "slots": [
    {
      "start": "2026-11-03T13:00:00.000Z",
      "end": "2026-11-03T13:40:00.000Z",
      "professionalIds": ["<menos ocupado>", "<outro>"]
    }
  ]
}
```

Máximo de 31 dias por consulta. `professionalIds` vem ordenado para distribuição (preferido → menor carga).

### Agendamentos

| Método | Rota                                                                               | Descrição                                                                           |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `…/appointments?from=&to=[&professionalId=][&customerId=][&includeCancelled=true]` | por data local (máx. 62 dias)                                                       |
| GET    | `…/appointments/:id`                                                               | detalhe com itens, cliente e profissional                                           |
| POST   | `…/appointments`                                                                   | cria (ver abaixo)                                                                   |
| POST   | `…/appointments/:id/cancel`                                                        | `{ reason?, cancelledBy: "CUSTOMER"\|"STAFF" }`                                     |
| POST   | `…/appointments/:id/reschedule`                                                    | `{ startsAt, professionalId?, isOverbook?, allowOutsideHours? }` — atômico          |
| POST   | `…/appointments/:id/status`                                                        | `{ status: "CONFIRMED"\|"COMPLETED"\|"NO_SHOW" }` (concluir/falta só após o início) |
| PATCH  | `…/appointments/:id`                                                               | `{ notes }`                                                                         |

Criação:

```http
POST /v1/tenants/:tenantId/appointments
Idempotency-Key: 6f1c…   (recomendado — repetir a mesma chave devolve a mesma reserva, status 200)
```

```json
{
  "newCustomer": { "name": "Carlos Lima", "phone": "(11) 99999-1111" },
  "serviceIds": ["<corte>", "<barba>"],
  "professionalId": "<opcional — omitido = qualquer profissional>",
  "startsAt": "2026-11-03T10:00:00-03:00",
  "notes": "opcional",
  "isOverbook": false,
  "allowOutsideHours": false,
  "allowPast": false
}
```

- `customerId` **ou** `newCustomer` (telefone existente reaproveita o cadastro).
- `201` com o agendamento; `409 SLOT_UNAVAILABLE` com `details.reason`:
  `IN_PAST`, `TOO_SOON`, `TOO_FAR`, `CROSSES_MIDNIGHT`, `CLOSED`, `OUTSIDE_WORKING_HOURS`, `TIME_OFF`,
  `CONFLICT`, `NO_PROFESSIONAL_AVAILABLE`.
- `allowOutsideHours` exige gerente+; `isOverbook` (encaixe) é permitido à equipe e fica auditado.
- Pelo painel não há antecedência mínima (a equipe pode marcar em cima da hora); a política do cliente vale
  para a disponibilidade e para a recepcionista de IA.

## Clientes

| Método | Rota                            | Permissão | Descrição                                                               |
| ------ | ------------------------------- | --------- | ----------------------------------------------------------------------- |
| GET    | `…/customers?q=&limit=&offset=` | qualquer  | busca por nome ou parte do telefone                                     |
| GET    | `…/customers/:id`               | qualquer  | ficha + 30 últimos agendamentos + consentimentos atuais                 |
| POST   | `…/customers`                   | qualquer  | cria (`409 CUSTOMER_PHONE_EXISTS` com `details.customerId`)             |
| PATCH  | `…/customers/:id`               | qualquer  | atualiza                                                                |
| POST   | `…/customers/:id/consents`      | qualquer  | `{ purpose, granted, channel, evidence? }` — histórico somente-inserção |
| POST   | `…/customers/:id/anonymize`     | gerente+  | LGPD, irreversível (`409` se houver agendamento futuro)                 |

## Voice Studio

| Método | Rota                      | Permissão | Descrição                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `…/voice-studio`          | qualquer  | biblioteca + personagens próprias, configuração atual, linguagem efetiva por canal (com ajustes e motivos), recursos do plano e integrações pendentes                                                                                                                                                                                                  |
| PUT    | `…/voice-studio/config`   | gerente+  | `{ personaId, formality, slangLevel, emojisEnabled, enthusiasm, relaxation, useCustomerName, receptionistName?, greeting?, farewell?, signatureExpressions[], vocabularyPrefer[], vocabularyAvoid[], businessInstructions? }` — campos avançados exigem o recurso do plano (`403 PLAN_FEATURE_REQUIRED`); personagem invisível → `422 INVALID_PERSONA` |
| POST   | `…/voice-studio/preview`  | gerente+  | mesma estrutura + `channel: "PHONE"\|"WHATSAPP"` → seções das instruções compiladas com os dados reais, `hash` e ajustes (nada é salvo)                                                                                                                                                                                                                |
| POST   | `…/voice-studio/personas` | gerente+  | personagem própria a partir de uma da biblioteca: `{ basePersonaId, name, tagline, personality, speakingStyle, signaturePhrases[], presentation }` (requer plano com personagens próprias)                                                                                                                                                             |

## Recepcionista e conversas

Conversas contêm dados de clientes: leitura com a permissão do CRM (`customers:read`, inclusive equipe),
ações com `customers:write`; o simulador exige `ai:configure` (proprietário/gerente).

| Método | Rota                                                                   | Descrição                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `…/receptionist/status`                                                | `{ llm: { configured, provider, model }, receptionistConfigured }` — o painel mostra "não integrado" quando `configured` é falso                                                                                                           |
| GET    | `…/conversations?status=OPEN\|HANDOFF\|CLOSED&simulations=true\|false` | até 100 conversas mais recentes (resumo, contato, cliente vinculado, última mensagem)                                                                                                                                                      |
| GET    | `…/conversations/:id`                                                  | conversa com a linha do tempo: mensagens do cliente/recepcionista/equipe, ações das ferramentas (`toolName`, `toolError`) e marcações do verificador (`verification.rejected`, `fallback`)                                                 |
| POST   | `…/conversations/:id/take-over`                                        | a equipe assume (a recepcionista para de responder)                                                                                                                                                                                        |
| POST   | `…/conversations/:id/return-to-ai`                                     | devolve à recepcionista (`503 AI_NOT_CONFIGURED` sem provedor)                                                                                                                                                                             |
| POST   | `…/conversations/:id/close`                                            | encerra                                                                                                                                                                                                                                    |
| POST   | `…/simulator/conversations`                                            | `{ channel: "WHATSAPP"\|"PHONE", contactPhone?, contactName? }` → conversa de simulação com as instruções da configuração **salva** (congeladas). `503 AI_NOT_CONFIGURED` sem provedor; `409 RECEPTIONIST_NOT_CONFIGURED` sem configuração |
| POST   | `…/simulator/conversations/:id/messages`                               | `{ text }` → `{ reply, speech, status, handoffReason, conversation }`. Agenda real consultada; reservas/cancelamentos/remarcações **não gravados**. Conversas reais recusam (`403`): mensagens de clientes só chegam pelos canais          |

Cada mensagem do simulador chama o modelo de IA (custo de uso). `speech` é a versão para fala (ligações).

## Dashboard

`GET …/dashboard/summary[?date=AAAA-MM-DD]` — indicadores reais (ver `DashboardSummaryDto` em
`packages/contracts/src/dashboard.ts`). `channels.phone`/`channels.whatsapp` são `null` enquanto não houver integração.

## Códigos de erro frequentes

| HTTP | code                                                                                                                                     | Quando                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`                                                                                                                       | dados inválidos (com `details`)                        |
| 401  | `UNAUTHORIZED`, `INVALID_CREDENTIALS`                                                                                                    | sem sessão / login inválido                            |
| 403  | `FORBIDDEN`, `CSRF_REJECTED`, `TENANT_SUSPENDED`                                                                                         | sem permissão / origem não autorizada / conta suspensa |
| 404  | `NOT_FOUND`                                                                                                                              | inexistente **ou** de outro estabelecimento            |
| 409  | `SLOT_UNAVAILABLE`, `EMAIL_IN_USE`, `INVALID_STATUS_TRANSITION`, `HOLD_EXPIRED`, `RECEPTIONIST_NOT_CONFIGURED`, `CONVERSATION_CLOSED`, … | conflitos de estado                                    |
| 422  | `SERVICE_UNAVAILABLE`, `PROFESSIONAL_CANNOT_PERFORM`, `ONBOARDING_INCOMPLETE`, …                                                         | regra de negócio                                       |
| 429  | `RATE_LIMITED`, `ACCOUNT_LOCKED`                                                                                                         | limites                                                |
| 503  | `AI_NOT_CONFIGURED`                                                                                                                      | recepcionista de IA sem provedor configurado           |
