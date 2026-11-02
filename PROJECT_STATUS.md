# Barber Voice — Status do projeto

> Atualizado em **02/11/2026**. Este arquivo é a fonte de verdade sobre o que está pronto, o que foi
> testado e o que falta. Nada aqui é declarado pronto sem teste executado.

## Resumo

| Fase              | Escopo                                                                    | Situação                                                         |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **1 — Fundação**  | Arquitetura, banco, autenticação, multi-tenancy, design system, estrutura | ✅ Concluída                                                     |
| **2 — Operação**  | Cadastro/onboarding, serviços, profissionais, agenda, clientes            | ✅ Concluída (com pendências menores listadas abaixo)            |
| 3 — Voice Studio  | Personagens, vozes, linguagem, simulador                                  | ⏳ Não iniciada (tela informativa no painel)                     |
| 4 — Atendimento   | Motor de IA, telefonia, WhatsApp, transferência, central de conversas     | ⏳ Não iniciada                                                  |
| 5 — Inteligência  | CRM avançado, Copilot, inteligência comercial, recuperação                | ⏳ Não iniciada (dashboard básico real já existe)                |
| 6 — Administração | Superadmin, planos, pagamentos, custos                                    | ⏳ Estrutura de planos/assinatura no banco; sem telas/pagamentos |
| 7 — Qualidade     | 200 cenários conversacionais, segurança, performance, piloto              | ⏳ Base de testes criada; cenários de IA dependem da Fase 4      |

**O produto ainda NÃO está pronto para piloto**: a recepcionista de IA, a telefonia e o WhatsApp
(critérios centrais de aprovação) dependem das Fases 3 e 4. A agenda, o CRM e o painel já
funcionam de ponta a ponta e podem ser usados manualmente.

---

## Funcionalidades concluídas

### Fundação (Fase 1)

- Monorepo pnpm + Turborepo, TypeScript 6 estrito em todos os pacotes.
- `packages/core`: regras de domínio puras e testadas.
  - Motor de disponibilidade (grade configurável, horários colados ao término, intervalo de limpeza,
    jornadas por profissional ∩ horário de funcionamento, folgas, feriados, antecedência mínima,
    limite de dias, fuso IANA com caminho rápido e fallback correto em dias de horário de verão).
  - Validação de horário individual com motivo (`IN_PAST`, `TOO_SOON`, `CLOSED`, `CONFLICT`…).
  - Resolvedor de expressões temporais em PT-BR ("sexta no final do dia", "amanhã depois do almoço",
    "às 3 e meia", "quinze pras cinco", "semana que vem na quinta", "o primeiro horário", "mesmo horário
    da última vez"), com sinalização de ambiguidades para a IA confirmar.
  - Preparação de texto para voz (preços, horários, datas e durações por extenso; remoção de emojis/markdown).
  - Telefones E.164 (incl. variantes do nono dígito do WhatsApp), dinheiro em centavos, UUID v7.
- `packages/db`: schema Drizzle + migrações SQL versionadas.
  - **Row-Level Security** em todas as tabelas operacionais; papel da aplicação sem BYPASSRLS.
  - **FKs compostas `(tenant_id, id)`**: o banco impede referências entre estabelecimentos.
  - **Exclusion constraint (`btree_gist`)**: impossível gravar dois agendamentos sobrepostos do mesmo profissional.
  - Auditoria somente-inserção para a aplicação; planos somente-leitura.
- Autenticação própria: sessões opacas (hash SHA-256 no banco), cookie HttpOnly/SameSite=Lax,
  Argon2id, bloqueio após 10 falhas, redefinição de senha de uso único (1 h), confirmação de e-mail,
  listagem/revogação de sessões, troca de senha encerrando as demais sessões.
- Segurança HTTP: helmet, CORS restrito, verificação CSRF (Origin/Sec-Fetch-Site), rate limit global
  e por rota (Redis opcional), somente JSON, limite de corpo, `no-store`, request id.
- Multi-tenant: vínculo usuário↔estabelecimento com papéis (Proprietário, Gerente, Equipe), matriz de
  permissões, respostas 404 sem revelar existência, estabelecimento suspenso somente leitura.
- Identidade visual própria (tinta + latão, Geist + Instrument Serif, marca "onda/poste de barbeiro"),
  design system (botões, campos, diálogos responsivos/bottom sheet, cards, badges, switches…).

### Operação (Fase 2)

- Onboarding guiado: estabelecimento → horários → serviços (sugestões de nome/duração, **nunca de preço**)
  → profissionais → revisão/conclusão. Teste gratuito com franquia finita criado automaticamente.
- Serviços: preço fixo / "a partir de" / "sob consulta", duração, intervalo de limpeza, ativo, "agendável pela IA".
- Profissionais: serviços que realiza com duração/preço próprios, jornada própria ou herdada, folgas e
  bloqueios (com alerta e confirmação quando há agendamentos no período), cor na agenda.
- Agenda: grade diária por profissional (desktop) e lista (celular), horários livres reais da API,
  "qualquer profissional" com distribuição por carga do dia, encaixe deliberado, exceção de horário
  (somente gestores), cancelamento, **remarcação atômica**, confirmação, conclusão e falta, idempotência.
- Reservas temporárias (HELD) com expiração — base para a IA segurar um horário enquanto confirma dados.
- Clientes (CRM): busca por nome/telefone, ficha com histórico, preferências e observações autorizadas,
  profissional preferido, consentimentos LGPD com histórico (data/canal), anonimização.
- Dashboard com dados reais: agendamentos (dia/semana/mês), faturamento **registrado** (somente concluídos),
  ocupação da semana, clientes novos/recorrentes, cancelamentos, faltas, serviços e profissionais mais
  procurados, horários de pico. Canais não integrados aparecem como "não integrado" — sem números fictícios.
- Configurações: dados do estabelecimento, horário de funcionamento, feriados/fechamentos, regras de agenda,
  segurança da conta (senha e sessões).
- Landing page, termos de uso e política de privacidade (versões preliminares, sinalizadas como tal).
- Seed de demonstração (`is_demo`, aviso permanente no painel) e script de superadmin via CLI.

---

## Testes executados (02/11/2026)

| Suíte                                        | O que cobre                                                                                                                                                                                                                                                                                                           | Resultado           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `packages/core`                              | motor de agenda, fuzz de 300 cenários aleatórios (equivalência com validação individual), DST, desempenho (7 dias × 10 profissionais < 50 ms), ~110 expressões temporais PT-BR, fala, telefone, dinheiro, UUID                                                                                                        | **143/143 ✅**      |
| `packages/db`                                | RLS (leitura, escrita, UPDATE/DELETE cruzados, vazamento de contexto entre transações), FKs compostas, exclusion constraint, **20 inserções concorrentes → 1 aceita**, permissões do papel da aplicação                                                                                                               | **14/14 ✅**        |
| `packages/contracts`                         | validações compartilhadas painel↔API                                                                                                                                                                                                                                                                                  | **7/7 ✅**          |
| `apps/api`                                   | autenticação e proteções HTTP, isolamento entre estabelecimentos via API, papéis, onboarding, catálogo, CRM/LGPD, disponibilidade, reservas, **15 reservas HTTP simultâneas → 1 confirmada**, "qualquer profissional" concorrente, idempotência (inclusive concorrente), remarcação atômica, HELD expirado, dashboard | **70/70 ✅**        |
| E2E (`e2e/smoke.mjs`, Chromium real)         | cadastro → onboarding → agendamento com horário real → recusa do mesmo horário → CRM → dashboard → mobile → logout                                                                                                                                                                                                    | **15/15 etapas ✅** |
| Typecheck (5 pacotes) e build (API + painel) | —                                                                                                                                                                                                                                                                                                                     | **✅**              |

**Total: 234 testes automatizados + 15 etapas E2E, todos aprovados.**

### Problemas encontrados pelos testes e corrigidos

1. Idempotência sob concorrência: 5 repetições simultâneas com a mesma chave geravam 1 reserva + 4 erros 409
   (o certo é devolver a mesma reserva). Corrigido verificando a chave após o lock do profissional.
2. Fuzz test do motor excedia 5 s: conversões de fuso via Luxon lentas. Criado caminho rápido com cache de
   offset por dia (fallback exato em dias de horário de verão) — suíte inteira caiu para ~1,3 s.
3. Onboarding: a revisão mostrava etapas "pendentes" por usar status em cache — corrigido (refetch sempre).
4. Logo sem as barras no celular: `id` de gradiente SVG repetido apontava para um SVG oculto — ids únicos.
5. Gráfico de horários sem barras (altura percentual em item flex) e rótulos desalinhando a linha de base.
6. `toSpeechText` removia o ponto final após "min."; bundle da API não encontrava dependência transitiva.

### Ainda não testado

- Imagem Docker da API (`apps/api/Dockerfile`): **não foi construída neste ambiente** (sem daemon Docker).
- Rate limit com Redis (testado apenas em memória).
- Navegadores além do Chromium; leitores de tela (atributos ARIA aplicados, sem auditoria formal).
- Carga/performance da API sob muitos estabelecimentos simultâneos.

---

## Pendências conhecidas (Fases 1–2)

- Convites de equipe por e-mail (tabela `invitations` existe; faltam endpoints/telas).
- Lista de espera: tabela `waitlist_entries` pronta; endpoints, telas e oferta automática pendentes (Fase 5).
- Envio real de e-mails (hoje: log em desenvolvimento) — escolher provedor (ver INTEGRATIONS.md).
- Aviso ao alterar jornada/horário quando já existem agendamentos fora da nova jornada.
- Agendamentos recorrentes; visão semanal da agenda; arrastar-e-soltar para remarcar.
- MFA (TOTP) obrigatório para superadmin; telas de superadmin.
- Revisão jurídica dos termos e da política de privacidade.
- Lint (ESLint 10 flat config) ainda não configurado — hoje a barreira é o typecheck estrito.

## Integrações que precisam de credenciais (nenhuma ativa)

| Integração                                       | Uso                               | Credenciais                                          |
| ------------------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| Modelo de linguagem (Anthropic Claude)           | recepcionista, Copilot            | `ANTHROPIC_API_KEY`                                  |
| Voz — STT e TTS (provedor a definir na Fase 3/4) | ligações, áudios, prévia de vozes | chave do provedor                                    |
| Telefonia SIP/VoIP (provedor a definir)          | ligações                          | conta, número, credenciais SIP/API                   |
| WhatsApp Business Platform (Meta, Cloud API)     | mensagens                         | app Meta, WABA, número verificado, token, app secret |
| Pagamentos (Mercado Pago ou Stripe)              | assinaturas                       | access token / chaves + webhook secret               |
| E-mail transacional                              | senha, confirmação                | chave do provedor                                    |

## Custos externos previstos

Estimativas preliminares **a validar com cotações atuais** antes de fixar preços e franquias (detalhes e
premissas em [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#custos)). O custo por minuto de ligação atendida
pela IA (telefonia + reconhecimento de fala + modelo + síntese de voz) é o principal fator de margem; as
franquias dos planos (`packages/db/src/seed-plans.ts`) foram definidas de forma conservadora até essa validação.

## Próximas etapas

1. **Fase 3 — Voice Studio**: biblioteca de personagens versionada no banco, configuração de linguagem
   independente da personagem, compilador de instruções em camadas (segurança > fatos > persona > estilo > canal)
   com testes, catálogo de vozes, prévia de voz (TTS) e simulador.
2. **Fase 4 — Atendimento**: motor da recepcionista com ferramentas sobre a agenda real (usando o motor e o
   resolvedor de datas já prontos), verificação de afirmações (preço/horário/confirmação) antes de responder,
   integração oficial de WhatsApp, gateway de voz em tempo real, transferência humana e central de conversas.
3. Harness dos **200+ cenários conversacionais** (Fase 7) a partir do resolvedor PT-BR e do motor de agenda.
4. Decidir provedores (telefonia, voz, e-mail, pagamentos) com cotações reais — **requer autorização** por gerar custos.
