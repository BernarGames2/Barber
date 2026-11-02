# Barber Voice

Plataforma SaaS de **recepcionistas de inteligência artificial** para barbearias e salões de beleza:
atendimento por telefone e WhatsApp com a personalidade do estabelecimento, agenda inteligente sem
conflitos, CRM e inteligência comercial.

> Situação atual: Fases 1 e 2 concluídas; Voice Studio (Fase 3) com núcleo e simulador; Fase 4 com o motor da
> recepcionista (ferramentas sobre a agenda real, verificador de afirmações, conversas) pronto e testado com modelo
> roteirizado. Ainda **sem** chamada real ao modelo de IA (exige chave) e sem WhatsApp/telefonia conectados.
> Detalhes em [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Princípios

- A IA **nunca** inventa horários, preços ou serviços: usa somente dados cadastrados e a agenda real.
- Nenhum agendamento é confirmado sem gravação bem-sucedida no banco — e o próprio banco impede conflitos.
- Cada estabelecimento é isolado dos demais na aplicação **e** no banco (Row-Level Security).
- Personalidade da recepcionista e formalidade da linguagem são configurações independentes.
- Nada de números fictícios: integrações não configuradas aparecem como "não integrado".

## Stack

| Camada   | Tecnologia                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------- |
| Painel   | Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, Radix UI                     |
| API      | Node.js 22, Fastify 5, Zod 4, sessões opacas + Argon2id                                         |
| Dados    | PostgreSQL 16 (RLS, btree_gist, pg_trgm), Drizzle ORM, Redis (rate limit; filas na Fase 4)      |
| Domínio  | `packages/core` — motor de agenda, datas em PT-BR, fala, personagens, verificador de afirmações |
| IA       | SDK oficial da Anthropic (inativo sem `ANTHROPIC_API_KEY`), ferramentas próprias sobre a agenda |
| Testes   | Vitest com PostgreSQL real, Playwright (E2E)                                                    |
| Monorepo | pnpm workspaces + Turborepo                                                                     |

## Estrutura

```
apps/
  api/          API Fastify (auth, multi-tenant, agenda, CRM, dashboard) — futuro gateway de voz e workers
  web/          Painel Next.js (landing, autenticação, onboarding, agenda, clientes, configurações)
packages/
  core/         Regras de domínio puras: disponibilidade, datas PT-BR, fala, telefone, dinheiro
  db/           Schema Drizzle, migrações SQL, RLS, utilitários multi-tenant, seed de planos
  contracts/    Schemas Zod e tipos compartilhados entre painel e API (mensagens em PT-BR)
e2e/            Teste de fumaça em navegador real
infra/          Inicialização do PostgreSQL local (papéis e bancos)
docs/           Documentação técnica
```

## Como rodar localmente

Pré-requisitos: Node.js 22+, pnpm 10, PostgreSQL 16 e (opcional) Redis 7 — ou Docker.

```bash
# 1. Dependências
pnpm install

# 2. Infraestrutura local (PostgreSQL + Redis com papéis já criados)
docker compose up -d
#    sem Docker: crie os papéis com infra/postgres/init/01-roles.sql (psql) ou
#    POSTGRES_SUPERUSER_URL=postgres://... pnpm db:bootstrap

# 3. Variáveis de ambiente
cp .env.example .env
#    gere ENCRYPTION_KEY: openssl rand -base64 32

# 4. Banco: migrações + planos (+ demonstração opcional)
pnpm db:migrate
pnpm db:seed
pnpm --filter @barber-voice/api seed:demo   # opcional: demo@barbervoice.dev / demonstracao2026

# 5. Desenvolvimento (API em :4000, painel em :3000)
pnpm dev
```

Acesse <http://localhost:3000>. Em desenvolvimento, e-mails (confirmação, redefinição de senha) são
impressos no log da API.

## Scripts

| Comando                                                  | Descrição                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                                               | API + painel em modo desenvolvimento                              |
| `pnpm typecheck`                                         | Verificação de tipos de todos os pacotes                          |
| `pnpm test`                                              | Todos os testes (usa `TEST_DATABASE_*`, recria o banco de testes) |
| `pnpm build`                                             | Build de produção (bundle da API e Next.js)                       |
| `pnpm db:generate`                                       | Gera migração a partir de mudanças no schema                      |
| `pnpm db:migrate`                                        | Aplica migrações e permissões do papel da aplicação               |
| `pnpm db:seed`                                           | Insere/atualiza os planos                                         |
| `node e2e/smoke.mjs`                                     | E2E com navegador (requer API e painel rodando)                   |
| `pnpm --filter @barber-voice/db make-superadmin <email>` | Concede acesso de superadmin (somente via servidor)               |

## Documentação

- [PROJECT_STATUS.md](PROJECT_STATUS.md) — andamento, testes, pendências, custos e próximos passos
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitetura e decisões técnicas
- [docs/DATABASE.md](docs/DATABASE.md) — modelo de dados, RLS e restrições
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) — endpoints, erros, autenticação
- [docs/SECURITY.md](docs/SECURITY.md) — controles de segurança e LGPD
- [docs/TESTING.md](docs/TESTING.md) — estratégia e execução de testes
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — implantação: servidor único econômico (`deploy/`), Vercel com serviços (`vercel.json`) ou contêineres
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — contas externas, credenciais e custos
- [docs/VOICE_STUDIO.md](docs/VOICE_STUDIO.md) — projeto do sistema de personagens
