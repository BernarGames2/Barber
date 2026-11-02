# Banco de dados

PostgreSQL 16+. Schema em `packages/db/src/schema/*.ts` (Drizzle) e migrações SQL versionadas em
`packages/db/migrations/`. Extensões: `btree_gist` (anticonflito) e `pg_trgm` (busca por nome).

## Papéis

| Papel                           | Uso                                     | RLS                                            |
| ------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `barber_owner` (dono do schema) | migrações, seeds, scripts de plataforma | não se aplica (dono)                           |
| `barber_app` (aplicação)        | API em tempo de execução                | **sempre aplicado** (NOSUPERUSER, NOBYPASSRLS) |

O script de migração (`pnpm db:migrate`) aplica as migrações como dono e em seguida concede ao papel da
aplicação somente: DML nas tabelas, **sem** UPDATE/DELETE em `audit_logs`, **somente leitura** em `plans` e
nenhum acesso ao schema `drizzle`. Ele recusa conceder permissões a um papel com SUPERUSER ou BYPASSRLS.

## Convenções

- IDs `uuid` v7 gerados na aplicação (fallback `gen_random_uuid()`).
- Instantes em `timestamptz` (UTC). Horas semanais em `time` local. Dia da semana ISO (1 = segunda … 7 = domingo).
- Valores monetários em **centavos** (`integer`).
- Exclusões "lógicas" (`archived_at`) para serviços e profissionais referenciados pelo histórico.

## Tabelas

### Globais (sem RLS — acessadas por serviços com filtro explícito)

| Tabela          | Descrição                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`         | usuários (e-mail único em minúsculas, hash Argon2id, bloqueio por tentativas, papel de plataforma)                |
| `sessions`      | sessões opacas — só o **SHA-256** do token; expiração absoluta e por inatividade, revogação                       |
| `auth_tokens`   | tokens de uso único (confirmação de e-mail, redefinição de senha), guardados como hash                            |
| `organizations` | entidade comercial que assina o plano (1 ou mais unidades)                                                        |
| `tenants`       | estabelecimento: dados, endereço, fuso, regras de agenda, status, `is_demo`, `ai_enabled`                         |
| `memberships`   | vínculo usuário ↔ estabelecimento com papel (`OWNER`, `MANAGER`, `STAFF`) e status                                |
| `invitations`   | convites de equipe (token em hash) — endpoints pendentes                                                          |
| `plans`         | planos e franquias (`limits`, `features` em JSONB) — somente leitura para a aplicação                             |
| `subscriptions` | assinatura da organização (status, período, teste, Founding Partner, provedor de pagamento)                       |
| `audit_logs`    | trilha de auditoria (RLS: leitura do próprio estabelecimento; inserção apenas; sem FK para sobreviver à exclusão) |

### Operacionais (RLS por `tenant_id`)

| Tabela                       | Descrição                                                                         | Restrições principais                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `business_hours`             | faixas semanais de funcionamento (várias por dia)                                 | `weekday 1..7`, `start < end`                                                         |
| `closures`                   | feriados/fechamentos do estabelecimento                                           | `starts_at < ends_at`                                                                 |
| `services`                   | catálogo: duração, intervalo de limpeza, preço e tipo de preço, agendável pela IA | nome único por estabelecimento (sem arquivados), preço obrigatório salvo `ON_REQUEST` |
| `professionals`              | equipe que atende; `uses_business_hours` ou jornada própria                       | `UNIQUE (tenant_id, id)`                                                              |
| `professional_services`      | quem faz o quê, com duração/preço próprios                                        | FKs compostas para profissional e serviço                                             |
| `professional_working_hours` | jornada própria                                                                   | FK composta                                                                           |
| `time_off`                   | folgas, férias e bloqueios                                                        | FK composta, `starts_at < ends_at`                                                    |
| `customers`                  | CRM: contato, preferências autorizadas, contadores, anonimização                  | telefone E.164 único por estabelecimento (ativos)                                     |
| `consents`                   | histórico de consentimentos LGPD (somente inserção; o mais recente vale)          | FK composta                                                                           |
| `appointments`               | agendamentos                                                                      | ver abaixo                                                                            |
| `appointment_items`          | serviços do agendamento com preço/duração **congelados**                          | FKs compostas                                                                         |
| `waitlist_entries`           | lista de espera — endpoints pendentes (Fase 5)                                    | FKs compostas                                                                         |

### Voice Studio (migrações 0002–0003)

| Tabela                 | Descrição                                                                                                                                                                                                            | RLS                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `personas`             | personagens: `tenant_id` nulo = biblioteca da plataforma; preenchido = personagem própria. Definição completa em JSONB, `version` incrementada quando a biblioteca muda                                              | leitura: biblioteca + próprias; escrita: só as próprias (biblioteca apenas pelo papel dono) |
| `receptionist_configs` | uma por estabelecimento: personagem (+ versão escolhida), voz (quando houver provedor), formalidade, gírias, emojis, entusiasmo, descontração, uso do nome, saudação/despedida, expressões, vocabulário, orientações | isolamento por `tenant_id`                                                                  |

### `appointments` em detalhe

- `starts_at`, `ends_at` (fim do atendimento) e `blocked_until` (fim + intervalo de limpeza).
- `status`: `HELD` (reserva temporária com `hold_expires_at` obrigatório), `PENDING`, `CONFIRMED`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`, `EXPIRED`.
- **`appointments_no_overlap`** (migração 0001):
  ```sql
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, blocked_until, '[)') WITH &&)
  WHERE (status IN ('HELD','PENDING','CONFIRMED','COMPLETED') AND NOT is_overbook)
  ```
  Cancelados, faltas e expirados liberam o horário; encaixes deliberados (`is_overbook`) ficam fora da restrição.
- `idempotency_key` única por estabelecimento; `rescheduled_from_id` liga a remarcação ao original;
  `version` incrementa a cada mudança de status.
- FKs compostas para cliente e profissional; índices por `(tenant_id, starts_at)`,
  `(tenant_id, professional_id, starts_at)` e `(tenant_id, customer_id, starts_at)`.

## Row-Level Security

```sql
CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE POLICY tenant_isolation ON <tabela>
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
```

A aplicação define o contexto **por transação** (`set_config(..., true)`), compatível com poolers em modo
transação (PgBouncer). Testes em `packages/db/test/rls-and-integrity.test.ts` verificam leitura, escrita,
UPDATE/DELETE cruzados, ausência de vazamento entre transações na mesma conexão e as permissões do papel.

## Migrações

```bash
# alterou o schema em packages/db/src/schema → gere a migração
pnpm db:generate
# migração manual (SQL puro: políticas, constraints, extensões)
pnpm --filter @barber-voice/db exec drizzle-kit generate --custom --name=<nome>
# aplicar (como dono) + permissões do papel da aplicação
pnpm db:migrate
```

Regras: toda tabela nova de estabelecimento precisa de `tenant_id`, política RLS na mesma entrega e FKs
compostas quando referenciar outra tabela de estabelecimento. Migrações já aplicadas nunca são editadas.

## Backups e retenção

Ver [DEPLOYMENT.md](DEPLOYMENT.md#backups) e [SECURITY.md](SECURITY.md#retenção-de-dados).
