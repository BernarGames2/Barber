# Testes

## Como executar

```bash
# todos os testes (recria o banco barber_voice_test a cada execução)
pnpm test

# por pacote
pnpm --filter @barber-voice/core test
pnpm --filter @barber-voice/db test
pnpm --filter @barber-voice/contracts test
pnpm --filter @barber-voice/api test

# tipos
pnpm typecheck

# E2E em navegador (com API em :4000 e painel em :3000 rodando)
node e2e/smoke.mjs --shots=./tmp/screens
```

Requisitos: PostgreSQL com os papéis de teste (`docker compose up -d` ou `pnpm db:bootstrap`) e as variáveis
`TEST_DATABASE_URL`/`TEST_DATABASE_ADMIN_URL`. Por segurança, o reset só roda em bancos cujo nome contém "test".

## Estratégia

| Camada                | Ferramenta                                  | Foco                                                               |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Domínio puro (`core`) | Vitest                                      | regras de agenda, propriedades (fuzz), desempenho, linguagem PT-BR |
| Banco (`db`)          | Vitest + PostgreSQL real                    | RLS, constraints, concorrência, permissões do papel                |
| API (`api`)           | Vitest + `fastify.inject` + PostgreSQL real | contratos HTTP, segurança, isolamento, fluxos de agenda            |
| Contratos             | Vitest                                      | validação compartilhada painel↔API                                 |
| Ponta a ponta         | Playwright (Chromium)                       | jornada real do proprietário, desktop e celular                    |

Princípios: **sem mocks de banco** nos testes de integração (RLS e constraints só são testáveis no PostgreSQL
real); relógio injetável na API (`clock`) para testar antecedência, expiração e bloqueios de forma determinística;
cada teste de agenda cria um estabelecimento novo (isolamento).

## Cobertura atual (02/11/2026)

Ver números em [PROJECT_STATUS.md](../PROJECT_STATUS.md#testes-executados-02112026). Destaques:

- **Propriedade do motor**: 300 cenários aleatórios — os horários calculados são _exatamente_ os aprovados pela
  validação individual e nenhum colide com agendamentos existentes.
- **Concorrência**: 20 inserções simultâneas no banco e 15 requisições HTTP simultâneas pelo mesmo horário →
  exatamente uma reserva; "qualquer profissional" com 6 pedidos e 2 profissionais → exatamente 2.
- **Isolamento**: dono de B não lê nem altera nada de A (inclusive usando IDs de A dentro do escopo de B).
- **Linguagem**: ~110 expressões temporais em português, incluindo ambiguidades ("às 8", "terça que vem" na
  véspera), ruído ("boa tarde" não é período) e quantidades ("2 pessoas" não é horário).

## Plano para a recepcionista (Fases 4 e 7) — 200+ cenários

Os cenários conversacionais serão executados por um _harness_ determinístico contra o motor real da recepcionista,
com estabelecimento e agenda semeados e relógio fixo. Cada cenário define: mensagens/áudio do cliente, estado da
agenda, e **asserções verificáveis** (não "parece bom"):

- ferramenta chamada e argumentos (ex.: data resolvida, serviço, profissional);
- agendamento gravado (ou não) no banco — **nenhuma confirmação sem registro**;
- valores citados ⊆ valores do catálogo; horários citados ⊆ horários retornados pela agenda;
- estilo: formalidade/gírias/emojis conforme configuração e canal (validadores automáticos + revisão amostral);
- transferência humana com resumo completo quando aplicável.

Categorias planejadas (mínimo por categoria): falar rápido/frases incompletas (15), sotaques e gírias
regionais (20), interrupções e correções (15), mudança de ideia (15), horário indisponível (20), preço
(15), cancelamento (15), remarcação (15), datas ambíguas (25), pedido de humano (10), ruído/áudio degradado
(15), áudio no WhatsApp (10), serviço inexistente (10), corrida pelo mesmo horário (5), privacidade/tentativa
de obter dados de terceiros (5), injeção de instruções (5). **Total ≥ 230.**

Metas do piloto (medidas, nunca presumidas): zero confirmações de horário indisponível; ≥ 95% de acerto
nos fluxos de agendamento; ≥ 95% de compreensão nos cenários de áudio definidos; transferência funcional.

## Testes manuais antes de cada entrega

- Painel em celular real (iOS Safari e Android Chrome): onboarding, agenda, criar/cancelar/remarcar.
- Leitor de tela nas telas principais (VoiceOver/TalkBack).
- Revisão visual das capturas do E2E (`--shots`).
