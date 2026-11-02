# Segurança e LGPD

## Controles implementados

### Identidade e sessão

- Senhas com **Argon2id** (19 MiB, 2 iterações, paralelismo 1 — mínimo OWASP); política: ≥ 10 caracteres com letras e números.
- Login com resposta genérica e tempo constante (hash fictício quando a conta não existe).
- **Bloqueio de conta** por 15 min após 10 falhas (por conta, independente do IP) + rate limit por IP.
- Sessões **opacas**: token aleatório de 256 bits no cookie; o banco guarda só o SHA-256.
  Expiração absoluta (30 dias) e por inatividade (14 dias); revogação imediata no logout, na troca/redefinição
  de senha (encerra as demais sessões) e por dispositivo.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` obrigatório em produção (a API recusa iniciar sem ele).
- Redefinição de senha: token de uso único, 1 h, consumo atômico, sem revelar se o e-mail existe e com
  proteção contra envio repetido de e-mails.
- Superadmin concedido **somente** via CLI no servidor (`make-superadmin`), com auditoria. Sem rota de API.

### Proteções HTTP

- CORS restrito às origens do painel; **CSRF**: requisições mutáveis com cookie exigem `Origin` autorizado
  (ou bloqueiam `Sec-Fetch-Site: cross-site`); corpo somente JSON (formulários HTML não são interpretados).
- `helmet` (CSP restritiva para a API, `nosniff`, `frame-ancestors 'none'`, HSTS em produção); painel com
  `X-Frame-Options: DENY`, `Referrer-Policy` e `Permissions-Policy`.
- Rate limit global (300/min/IP) e estrito nas rotas de autenticação; Redis opcional para vários nós.
- Limite de corpo (256 KB), `cache-control: no-store`, redirecionamento pós-login apenas para caminhos internos.
- Logs com redação de cookies, cabeçalhos de autorização, senhas e tokens.

### Isolamento multi-tenant

Defesa em profundidade — rota, permissão, serviço, **RLS no banco** e **FKs compostas** (detalhes em
[ARCHITECTURE.md](ARCHITECTURE.md#isolamento-multi-tenant-defesa-em-profundidade)). Testado em dois níveis:
banco (`packages/db/test`) e API (`apps/api/test/tenancy.test.ts`), incluindo tentativas de usar IDs de outro
estabelecimento dentro do próprio escopo.

### Integridade dos dados

- Exclusion constraint impede agendamentos sobrepostos; idempotência evita duplicidade em retentativas.
- Auditoria **somente-inserção** para a aplicação (UPDATE/DELETE revogados no banco).
- Segredos de integrações serão guardados com **AES-256-GCM** (`apps/api/src/lib/crypto.ts`, formato
  versionado para rotação de chave); `ENCRYPTION_KEY` obrigatória em produção.
- Configuração de produção validada no boot: recusa `COOKIE_SECURE=false`, origens `http://`, chave ausente
  e senhas de banco de desenvolvimento.

### Matriz de permissões

| Permissão                                            | Proprietário | Gerente | Equipe |
| ---------------------------------------------------- | :----------: | :-----: | :----: |
| Ver agenda, clientes, catálogo, dashboard            |      ✅      |   ✅    |   ✅   |
| Criar/cancelar/remarcar agendamentos, encaixe        |      ✅      |   ✅    |   ✅   |
| Agendar fora do horário                              |      ✅      |   ✅    |   —    |
| Catálogo, horários, folgas, dados do estabelecimento |      ✅      |   ✅    |   —    |
| Anonimizar cliente (LGPD)                            |      ✅      |   ✅    |   —    |
| Equipe e cobrança                                    |      ✅      |    —    |   —    |

## LGPD

| Tema                | Como é tratado                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Papéis              | Estabelecimento = controlador dos dados dos seus clientes; Barber Voice = operador                                                                                                        |
| Minimização         | Cadastro do cliente exige apenas nome; telefone/e-mail opcionais                                                                                                                          |
| Consentimento       | Registro por finalidade (WhatsApp transacional, marketing, gravação de ligação, tratamento de dados), somente-inserção, com data, canal e evidência; estado atual = registro mais recente |
| Direitos do titular | Acesso/correção pela ficha; **anonimização** irreversível que preserva métricas agregadas                                                                                                 |
| Observações         | Campos de observação marcados como "autorizadas"; não são lidos ao cliente pela IA                                                                                                        |
| Transparência       | Política de privacidade preliminar publicada; aviso de gravação será obrigatório quando houver gravação de chamadas (Fase 4)                                                              |
| Comunicação ativa   | Campanhas e recuperação de clientes só com consentimento de marketing e dentro das regras da Meta (Fase 5)                                                                                |

### Retenção de dados

A definir com assessoria jurídica antes do piloto (gravações, transcrições, logs de acesso). A auditoria não
tem FK para estabelecimentos para permitir retenção independente da exclusão da conta.

## Pendências de segurança

- MFA (TOTP) obrigatório para superadmin e opcional para proprietários.
- Verificação de senhas vazadas (k-anonymity) e medidor de força no cadastro.
- Rotação de `ENCRYPTION_KEY` (formato já versionado) e de credenciais de banco.
- Varredura de dependências (ex.: `pnpm audit`/Dependabot) e testes de segurança automatizados (DAST) no CI.
- Política de retenção formal e rotina de expurgo; registro de operações de tratamento (ROPA).
- Pentest antes do lançamento comercial.

## Relato de vulnerabilidades

Envie para o responsável técnico do projeto (canal privado). Não abra issue pública com detalhes exploráveis.
