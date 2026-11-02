# Implantação

> Publicar em produção, contratar infraestrutura ou alterar serviços externos **exige autorização do
> proprietário do projeto**. Este guia descreve o procedimento; nada foi publicado até o momento.

## Opção A — Vercel com serviços (`vercel.json`)

Um único projeto Vercel, um domínio, dois serviços construídos separadamente:

| Serviço | Pasta      | Framework | Rota pública           | Ponto de entrada                                                 |
| ------- | ---------- | --------- | ---------------------- | ---------------------------------------------------------------- |
| `api`   | `apps/api` | fastify   | `/api/*`               | `src/vercel.ts` (handler `(req, res)` sobre a instância Fastify) |
| `web`   | `apps/web` | nextjs    | todo o resto (`/(.*)`) | Next.js (App Router)                                             |

- **Sem chamadas internas entre serviços**: o navegador chama `/api/*` no mesmo domínio (cookie de sessão
  first-party); nenhum serviço chama o outro pelo servidor, então não há _bindings_. O painel só encaminha
  `/api/*` por conta própria fora da Vercel (`next.config.ts`).
- **Caminho recebido pela API**: a Vercel entrega o caminho público (`/api/v1/...`); a API remove o prefixo
  configurado em `API_PATH_PREFIX` (padrão `/api`) e também responde sem ele (health checks).
- **Origem confiável**: além de `WEB_ORIGIN`, a API aceita `https://$VERCEL_URL` (domínio da implantação,
  inclusive previews). Domínios próprios e aliases de branch precisam estar em `WEB_ORIGIN`.
- **Variáveis** (no projeto Vercel, valem para os dois serviços): `DATABASE_URL` (de preferência a URL com
  _pooler_), `DB_POOL_MAX` baixo (ex.: 3 — cada instância da função tem seu pool), `ENCRYPTION_KEY`,
  `COOKIE_SECURE=true`, `WEB_ORIGIN`, `PUBLIC_WEB_URL`, `REDIS_URL` (rate limit compartilhado entre
  instâncias), `MAIL_PROVIDER` e, quando autorizado, `ANTHROPIC_API_KEY`.
- **Migrações não rodam no deploy da Vercel**: execute `pnpm db:migrate` (com `DATABASE_ADMIN_URL`) como etapa
  separada, antes de promover a nova versão.

**Limitações conhecidas desta opção** (verificar antes de produção):

- Funções não são processos persistentes: o gateway de **voz em tempo real** (WebSocket com a telefonia, Fase 4)
  não roda como função — precisará de um serviço em contêiner (o formato de serviços aceita `runtime: "container"`
  com Dockerfile) ou de outro host.
- Turnos da recepcionista com várias chamadas ao modelo podem passar do tempo padrão de execução da função —
  medir e, se preciso, aumentar a duração máxima do serviço `api`.
- A ordem das mensagens por conversa é garantida por instância; com várias instâncias, depende da fila por
  contato (Fase 4b).
- `TRUST_PROXY`: confirmar no primeiro deploy que `request.ip` reflete o IP do cliente (rate limit por IP).
- **Não verificado neste ambiente**: `vercel build`, `vercel dev` e o deploy em si (sem acesso à Vercel daqui). O
  `vercel.json` foi validado com o código oficial de resolução de serviços (`@vercel/fs-detectors` 7.11.4 e
  `@vercel/routing-utils` 6.6.1), e o handler `src/vercel.ts` foi testado servindo os caminhos públicos.

## Opção B — Painel e API em hosts separados (contêiner)

### Topologia recomendada

| Componente          | Sugestão                                                        | Observações                                                          |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Painel (`apps/web`) | Vercel (ou qualquer host Node.js)                               | `API_INTERNAL_URL` aponta para a API; o painel faz proxy de `/api/*` |
| API (`apps/api`)    | Contêiner (Fly.io, Railway, Render, AWS ECS/Fargate, Cloud Run) | processo persistente; WebSocket de voz na Fase 4                     |
| PostgreSQL 16+      | Gerenciado (Neon, Supabase, RDS, Crunchy…)                      | precisa das extensões `btree_gist` e `pg_trgm`; backups com PITR     |
| Redis 7             | Gerenciado (Upstash, Redis Cloud, ElastiCache)                  | rate limit distribuído agora; filas na Fase 4                        |
| Observabilidade     | Agregador de logs JSON + Sentry + monitor de disponibilidade    | ver abaixo                                                           |

Domínios sugeridos: `app.barbervoice.com.br` (painel) e um domínio interno/privado para a API. Como o painel
encaminha `/api/*` (mantendo o prefixo) para `API_INTERNAL_URL`, a API não precisa ficar exposta ao navegador —
apenas ao painel e, na Fase 4, aos webhooks dos provedores.

## 1. Banco de dados

Crie os papéis com senhas fortes (exemplo; ajuste nomes conforme o provedor):

```sql
CREATE ROLE barber_owner LOGIN PASSWORD '<senha forte>';
CREATE ROLE barber_app   LOGIN PASSWORD '<senha forte>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE barber_voice OWNER barber_owner;
```

- `DATABASE_ADMIN_URL` → `barber_owner` (somente para migrações e scripts administrativos).
- `DATABASE_URL` → `barber_app` (usado pela API; sempre sujeito a RLS).
- Em poolers (PgBouncer) use **modo transação**: o contexto do RLS é definido por transação.

## 2. Migrações (etapa própria do deploy, antes da nova versão da API)

```bash
DATABASE_ADMIN_URL=... DB_APP_ROLE=barber_app pnpm db:migrate
DATABASE_ADMIN_URL=... pnpm db:seed          # planos (idempotente)
```

O script aplica as migrações pendentes e reaplica as permissões mínimas do papel da aplicação.
Migrações devem ser compatíveis com a versão anterior da API durante o rollout (expandir → migrar → contrair).

## 3. API

```bash
docker build -f apps/api/Dockerfile -t barber-voice-api .
```

> O Dockerfile ainda **não foi construído** no ambiente de desenvolvimento usado até aqui (sem Docker);
> valide o build no pipeline antes do primeiro deploy.

Variáveis obrigatórias em produção (a API **recusa iniciar** com configuração insegura):

| Variável                               | Exemplo / regra                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                             | `production`                                                                                                                                                |
| `DATABASE_URL`                         | papel `barber_app` com senha forte                                                                                                                          |
| `WEB_ORIGIN`                           | `https://app.barbervoice.com.br` (vírgula para várias)                                                                                                      |
| `PUBLIC_WEB_URL`                       | `https://app.barbervoice.com.br`                                                                                                                            |
| `COOKIE_SECURE`                        | `true`                                                                                                                                                      |
| `ENCRYPTION_KEY`                       | `openssl rand -base64 32` (guardar no cofre de segredos)                                                                                                    |
| `TRUST_PROXY`                          | IPs/CIDRs do balanceador ou `true` se a plataforma garantir o cabeçalho                                                                                     |
| `REDIS_URL`                            | recomendado com mais de uma instância                                                                                                                       |
| `MAIL_PROVIDER`                        | provedor real (ver INTEGRATIONS.md) — `console` em produção não envia e-mails                                                                               |
| `ANTHROPIC_API_KEY`                    | ativa a recepcionista de IA (cofre de segredos; **gera custo por uso** — exige autorização). Sem ela, atendimento por IA e simulador ficam "não integrados" |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | padrão `claude-opus-5-5` / `medium`; ajustar após medir qualidade, latência e custo                                                                         |

Health checks: **liveness** `GET /health`, **readiness** `GET /ready` (verifica o banco). Encerramento gracioso
em `SIGTERM`.

## 4. Painel

```bash
pnpm --filter @barber-voice/web build
API_INTERNAL_URL=https://<api-interna> pnpm --filter @barber-voice/web start
```

Na Vercel: diretório raiz `apps/web`, comando de build `cd ../.. && pnpm turbo run build --filter=@barber-voice/web`,
variável `API_INTERNAL_URL`. Nenhum segredo vai em variáveis `NEXT_PUBLIC_*`.

## 5. Primeiro acesso administrativo

```bash
DATABASE_ADMIN_URL=... pnpm --filter @barber-voice/db make-superadmin voce@empresa.com.br
```

## Observabilidade e alertas

- Logs estruturados (pino/JSON) com `x-request-id`; cookies, senhas e tokens são redigidos.
- Alertas mínimos: `/ready` falhando, taxa de 5xx > 1% em 5 min, latência p95 da API > 1 s, erros de
  `SLOT_UNAVAILABLE` anormais (pode indicar problema de sincronização), falhas de login em massa (ataque).
- Na Fase 4: métricas por etapa de voz (STT, LLM, TTS, latência percebida) e saúde de cada integração.

## Backups

- PostgreSQL com **PITR** (point-in-time recovery) e retenção mínima de 14 dias; cópia diária para outra região.
- Teste de restauração mensal em ambiente isolado, com registro do tempo de recuperação.
- Redis não guarda dados críticos (pode ser recriado).

## Checklist de produção

- [ ] Papéis criados com senhas fortes; `barber_app` sem BYPASSRLS (o migrate verifica)
- [ ] `pnpm db:migrate` e `pnpm db:seed` executados
- [ ] HTTPS em todos os domínios; `COOKIE_SECURE=true`; `WEB_ORIGIN` correto
- [ ] `ENCRYPTION_KEY` no cofre de segredos; backup da chave fora do provedor
- [ ] Provedor de e-mail configurado (redefinição de senha funcionando)
- [ ] Backups e PITR ativos; restauração testada
- [ ] Monitor de `/ready` e alertas configurados
- [ ] Termos e política de privacidade revisados juridicamente
