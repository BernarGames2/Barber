# Barber Voice — Status do projeto

> Atualizado em **02/11/2026**. Este arquivo é a fonte de verdade sobre o que está pronto, o que foi
> testado e o que falta. Nada aqui é declarado pronto sem teste executado.

## Resumo

| Fase              | Escopo                                                                    | Situação                                                                          |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **1 — Fundação**  | Arquitetura, banco, autenticação, multi-tenancy, design system, estrutura | ✅ Concluída                                                                      |
| **2 — Operação**  | Cadastro/onboarding, serviços, profissionais, agenda, clientes            | ✅ Concluída (com pendências menores listadas abaixo)                             |
| 3 — Voice Studio  | Personagens, vozes, linguagem, simulador                                  | 🟡 Núcleo e simulador prontos; vozes dependem de provedor de TTS                  |
| 4 — Atendimento   | Motor de IA, telefonia, WhatsApp, transferência, central de conversas     | 🟡 Motor, ferramentas, verificador e conversas prontos; canais dependem de contas |
| 5 — Inteligência  | CRM avançado, Copilot, inteligência comercial, recuperação                | ⏳ Não iniciada (dashboard básico real já existe)                                 |
| 6 — Administração | Superadmin, planos, pagamentos, custos                                    | ⏳ Estrutura de planos/assinatura no banco; sem telas/pagamentos                  |
| 7 — Qualidade     | 200 cenários conversacionais, segurança, performance, piloto              | ⏳ Base de testes criada; cenários de IA dependem da Fase 4                       |

**O produto ainda NÃO está pronto para piloto**: o motor da recepcionista está pronto e testado, mas
**nunca conversou com um modelo de IA real** (não há `ANTHROPIC_API_KEY` neste ambiente) e os canais
WhatsApp/telefone ainda não estão conectados — ambos exigem contas e autorização de custos. A agenda, o CRM,
o Voice Studio e o painel funcionam de ponta a ponta e podem ser usados manualmente.

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

### Voice Studio (Fase 3 — núcleo concluído)

- Biblioteca de 11 personagens versionada no banco (Rocker, Clássico, Urban, Premium, Esportivo, Retrô, Sofia,
  Bia, Helena, Fashion, Natural), com exemplos por formalidade escritos sem presumir gênero de cliente,
  profissional ou recepcionista (verificado por teste).
- Personagem e linguagem **independentes**: formalidade, gírias, emojis (só WhatsApp), entusiasmo, descontração,
  uso do nome, nome da recepcionista; combinações contraditórias resolvidas com ajuste **visível** ao proprietário.
- Compilador determinístico de instruções em camadas (regras invioláveis → dados reais do estabelecimento →
  personagem → linguagem → canal → orientações livres), com prévia transparente no painel.
- Validador de estilo das respostas (emojis, dígitos/markdown na voz, tamanho, intimidade, gírias em linguagem formal).
- Personagens próprias (plano com o recurso) e personalização avançada controlada pelo plano no servidor.
- Simulador: conversa com a recepcionista usando a configuração salva e a agenda real em modo simulação
  (reservas, cancelamentos e remarcações são validados e **não gravados**); mostra as ferramentas usadas, as
  correções do verificador e, para ligações, como a resposta seria falada. Só funciona com o modelo de IA integrado.
- Pendente: catálogo e prévia de vozes (requer provedor de TTS).

### Atendimento (Fase 4 — motor pronto; canais pendentes)

- **Ferramentas sobre a agenda real**: interpretar data (resolvedor PT-BR), consultar horários, reservar
  temporariamente (10 min), confirmar, listar/cancelar/remarcar os agendamentos **do próprio cliente** e transferir
  para a equipe. Entradas validadas (Zod) antes de qualquer acesso ao banco; nomes de serviços/profissionais
  precisam casar com o cadastro; telefone do cliente vem do canal, nunca do modelo.
- **Confirmação em duas etapas**: a ferramenta recusa confirmar na mesma rodada da reserva — o cliente precisa
  ver o resumo e responder. Reserva temporária vencida nunca é confirmada (`HOLD_EXPIRED`).
- **Verificador de afirmações** (determinístico, antes de qualquer envio): preços (catálogo, valores devolvidos
  por ferramentas ou somas de até 3 serviços), horários (precisam ter vindo da agenda — e, se a frase cita data, o
  par data+horário precisa conferir), e "agendado/reservado/cancelado/remarcado" só depois do sucesso da
  ferramenta. Entende números e horários por extenso ("quarenta e cinco reais", "às duas da tarde"). Reprovação
  → nova tentativa com a correção; 3 reprovações → resposta segura e transferência para a equipe.
- **Motor de conversa**: instruções congeladas por conversa, histórico **somente-acréscimo** gravado exatamente
  como enviado ao modelo (preserva raciocínio e cache), "agora" e correções como mensagens de sistema da
  plataforma; recusa/indisponibilidade do provedor → resposta segura + equipe.
- **Adaptador Anthropic** (SDK oficial 1.3.0, `claude-opus-5-5`, esforço configurável, fallback do servidor em
  recusas, cache de prompt). Ativado somente com `ANTHROPIC_API_KEY` no servidor. **Não testado com o provedor
  real** (sem chave); validado por typecheck contra os tipos do SDK.
- **Central de conversas** no painel: filtros (recepcionista, equipe, encerradas, simulações), linha do tempo
  com ações das ferramentas e marcações do verificador; assumir, devolver à recepcionista e encerrar.
- Sem IA integrada, mensagens de canais **não se perdem**: a conversa nasce/passa para a equipe.
- LGPD: anonimizar o cliente apaga o conteúdo das conversas dele e o histórico enviado ao modelo.
- Pendente: WhatsApp Business Platform (webhook assinado, envio, janela de 24 h/templates), telefonia e voz em
  tempo real, resposta da equipe pelo painel, fila por contato para múltiplas instâncias.

---

## Testes executados (02/11/2026)

| Suíte                                        | O que cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Resultado           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `packages/core`                              | motor de agenda, fuzz de 300 cenários aleatórios, DST, desempenho, ~110 expressões temporais PT-BR, fala, telefone, dinheiro, UUID; Voice Studio (biblioteca, independência personagem×linguagem, compilador com 66 combinações, validador de estilo); **verificador de afirmações** (40 casos: números por extenso, horários ambíguos, durações, data+horário, listas do WhatsApp, negações e condicionais)                                                                                                                                                                                                                                                                   | **212/212 ✅**      |
| `packages/db`                                | RLS, FKs compostas, exclusion constraint, **20 inserções concorrentes → 1 aceita**, permissões do papel; personagens e configuração; **conversas isoladas**, histórico do modelo somente-acréscimo (nem o papel dono edita), sequência única                                                                                                                                                                                                                                                                                                                                                                                                                                   | **21/21 ✅**        |
| `packages/contracts`                         | validações compartilhadas painel↔API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **7/7 ✅**          |
| `apps/api`                                   | autenticação, isolamento, papéis, onboarding, catálogo, CRM/LGPD, disponibilidade, reservas concorrentes, idempotência, remarcação atômica, dashboard, Voice Studio; **recepcionista com modelo roteirizado**: agendamento ponta a ponta no banco, confirmação só após o "sim", histórico somente-acréscimo com raciocínio preservado, preço inventado bloqueado e corrigido, 3 reprovações → equipe, indisponibilidade/recusa → resposta segura, acesso só aos próprios agendamentos, remarcação e cancelamento reais, reserva vencida, simulador sem gravações, isolamento, anonimização das conversas; ponto de entrada da Vercel servindo `/api/*` e origem da implantação | **106/106 ✅**      |
| E2E (`e2e/smoke.mjs`, Chromium real)         | cadastro → onboarding → agendamento com horário real → recusa do mesmo horário → CRM → dashboard → mobile → Voice Studio → simulador/conversas sem IA (estado honesto, 503) → logout — contra o **build de produção**                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **17/17 etapas ✅** |
| Typecheck (5 pacotes) e build (API + painel) | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **✅**              |

**Total: 346 testes automatizados + 17 etapas E2E, todos aprovados.**

### Problemas encontrados pelos testes e corrigidos

1. Idempotência sob concorrência: 5 repetições simultâneas com a mesma chave geravam 1 reserva + 4 erros 409
   (o certo é devolver a mesma reserva). Corrigido verificando a chave após o lock do profissional.
2. Fuzz test do motor excedia 5 s: conversões de fuso via Luxon lentas. Criado caminho rápido com cache de
   offset por dia (fallback exato em dias de horário de verão) — suíte inteira caiu para ~1,3 s.
3. Onboarding: a revisão mostrava etapas "pendentes" por usar status em cache — corrigido (refetch sempre).
4. Logo sem as barras no celular: `id` de gradiente SVG repetido apontava para um SVG oculto — ids únicos.
5. Gráfico de horários sem barras (altura percentual em item flex) e rótulos desalinhando a linha de base.
6. `toSpeechText` removia o ponto final após "min."; bundle da API não encontrava dependência transitiva.
7. Seed da biblioteca de personagens não era idempotente: o `jsonb` reordena chaves e toda execução incrementaria
   a versão das 11 personagens. Corrigido com comparação canônica (chaves ordenadas).
8. Instalar o SDK da Anthropic trouxe `@opentelemetry/api` (peer opcional do Drizzle) só para a API e o pnpm
   criou uma segunda cópia do `drizzle-orm`, com tipos incompatíveis entre API e banco. Corrigido declarando a
   mesma versão no `packages/db` (uma única instância).
9. Revisão do fluxo de reserva da IA: uma reserva temporária já vencida, mas ainda não marcada como expirada pela
   limpeza, podia ser confirmada. Agora a confirmação verifica o vencimento (`HOLD_EXPIRED`) — coberto por teste.

### Implantação econômica em servidor único (pronta e testada, não publicada)

`deploy/docker-compose.prod.yml` sobe painel, API, PostgreSQL, Redis, HTTPS automático (Caddy) e backup diário em
um VPS de ~R$ 30–50/mês. Testado aqui com Docker: imagens construídas, pilha completa saudável, migrações e seeds
automáticos, E2E **17/17 por HTTPS** e restauração de backup verificada. Falta um servidor e um domínio reais
(do proprietário). Guia: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#opção-c--servidor-único-vps-a-mais-econômica--recomendada-para-o-piloto).

### Implantação na Vercel (configurada, não publicada)

`vercel.json` com dois serviços — `web` (Next.js, rota `/(.*)`) e `api` (Fastify, rota `/api/*`, ponto de
entrada `apps/api/src/vercel.ts`) — sem _bindings_ (nenhum serviço chama o outro pelo servidor). Validado com o
código oficial de resolução de serviços da Vercel e com testes do handler; **o build e o deploy na Vercel não
foram executados** (sem acesso à Vercel neste ambiente e publicação exige autorização). Ver
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#opção-a--vercel-com-serviços-verceljson).

### Ainda não testado

- `vercel build`/`vercel dev`/deploy na Vercel (configuração validada apenas com o resolvedor oficial e testes locais).
- **Chamada real ao modelo de IA**: nenhuma requisição foi feita à Anthropic (sem chave e sem autorização de
  custos). O comportamento conversacional real (qualidade, uso correto das ferramentas, taxa de reprovação do
  verificador, latência e custo por conversa) **precisa ser medido** com chave e com o harness de cenários.
- Várias instâncias da API atendendo a mesma conversa (a ordem por conversa é garantida por processo; a fila por
  contato chega com os canais).
- Rate limit com Redis (testado apenas em memória).
- Navegadores além do Chromium; leitores de tela (atributos ARIA aplicados, sem auditoria formal).
- Carga/performance da API sob muitos estabelecimentos simultâneos.

---

## Pendências conhecidas

- Convites de equipe por e-mail (tabela `invitations` existe; faltam endpoints/telas).
- Lista de espera: tabela `waitlist_entries` pronta; endpoints, telas e oferta automática pendentes (Fase 5).
- Envio real de e-mails (hoje: log em desenvolvimento) — escolher provedor (ver INTEGRATIONS.md).
- Aviso ao alterar jornada/horário quando já existem agendamentos fora da nova jornada.
- Agendamentos recorrentes; visão semanal da agenda; arrastar-e-soltar para remarcar.
- MFA (TOTP) obrigatório para superadmin; telas de superadmin.
- Revisão jurídica dos termos e da política de privacidade.
- Lint (ESLint 10 flat config) ainda não configurado — hoje a barreira é o typecheck estrito.

## Integrações que precisam de credenciais (nenhuma ativa)

| Integração                                             | Uso                               | Credenciais                                                   |
| ------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------- |
| Modelo de linguagem (Anthropic Claude) — código pronto | recepcionista, simulador, Copilot | `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`) |
| Voz — STT e TTS (provedor a definir na Fase 3/4)       | ligações, áudios, prévia de vozes | chave do provedor                                             |
| Telefonia SIP/VoIP (provedor a definir)                | ligações                          | conta, número, credenciais SIP/API                            |
| WhatsApp Business Platform (Meta, Cloud API)           | mensagens                         | app Meta, WABA, número verificado, token, app secret          |
| Pagamentos (Mercado Pago ou Stripe)                    | assinaturas                       | access token / chaves + webhook secret                        |
| E-mail transacional                                    | senha, confirmação                | chave do provedor                                             |

## Custos externos previstos

Estimativas preliminares **a validar com cotações atuais** antes de fixar preços e franquias (detalhes e
premissas em [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#custos)). O custo por minuto de ligação atendida
pela IA (telefonia + reconhecimento de fala + modelo + síntese de voz) é o principal fator de margem; as
franquias dos planos (`packages/db/src/seed-plans.ts`) foram definidas de forma conservadora até essa validação.

## Próximas etapas

1. **Ativar e medir a recepcionista com um modelo real** — **requer sua autorização** (gera custo por uso):
   configurar `ANTHROPIC_API_KEY` no servidor, testar pelo simulador e medir qualidade, taxa de reprovação do
   verificador, latência e custo por conversa; ajustar `ANTHROPIC_EFFORT` (ex.: `low` para ligações) com base nos números.
2. **Harness dos 200+ cenários conversacionais** (Fase 7) sobre o motor pronto: roteiros de agendamento,
   remarcação, cancelamento, preço, serviço inexistente, datas ambíguas, injeção de instruções e pedido de humano —
   executáveis com modelo roteirizado (regressão) e com o modelo real (medição, com custo autorizado).
3. **Fase 4b — WhatsApp Business Platform** (Cloud API oficial): consultar a documentação atual da Meta,
   webhook com verificação de assinatura, envio de mensagens, janela de 24 h e modelos aprovados, resposta da
   equipe pelo painel, fila por contato. Requer app Meta, número verificado e credenciais (**autorização**).
4. **Telefonia e voz**: escolher provedores (SIP/VoIP, reconhecimento e síntese de voz) com cotações reais —
   **requer autorização** por gerar custos; depois, gateway de voz em tempo real e catálogo/prévia de vozes no Voice Studio.
5. Demais provedores (e-mail transacional, pagamentos) — também dependem de autorização.
