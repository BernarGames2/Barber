-- =============================================================================
-- Barber Voice — integridade da agenda e isolamento multi-tenant (Row-Level Security)
-- =============================================================================

-- Extensões "trusted" (PG13+): podem ser criadas pelo dono do banco.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Estabelecimento corrente da transação. Definido pela aplicação com
--   SELECT set_config('app.tenant_id', '<uuid>', true)
-- no início de cada transação (escopo LOCAL: some ao final da transação).
-- NULLIF trata o valor vazio que o PostgreSQL devolve após um SET LOCAL anterior na mesma conexão.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Garantia anticonflito: dois agendamentos ativos do mesmo profissional nunca se
-- sobrepõem. Vale para qualquer caminho de escrita (painel, IA, importação, bugs),
-- inclusive sob concorrência — a verificação é atômica no banco.
-- Encaixes deliberados (is_overbook = true) ficam fora da restrição.
-- -----------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "professional_id" WITH =,
    tstzrange("starts_at", "blocked_until", '[)') WITH &&
  )
  WHERE ("status" IN ('HELD', 'PENDING', 'CONFIRMED', 'COMPLETED') AND NOT "is_overbook");--> statement-breakpoint

-- Busca de clientes por nome (CRM) com trigramas.
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Row-Level Security nas tabelas operacionais.
-- O papel da aplicação (sem BYPASSRLS e que não é dono das tabelas) só enxerga e só
-- grava linhas do estabelecimento definido em app.tenant_id. Sem contexto: zero linhas.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_hours',
    'closures',
    'services',
    'professionals',
    'professional_services',
    'professional_working_hours',
    'time_off',
    'customers',
    'consents',
    'appointments',
    'appointment_items',
    'waitlist_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Auditoria: leitura apenas do próprio estabelecimento; inserção do próprio estabelecimento
-- ou de evento de plataforma (tenant_id nulo). Sem políticas de UPDATE/DELETE = proibido.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_logs_select ON "audit_logs" FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY audit_logs_insert ON "audit_logs" FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());
