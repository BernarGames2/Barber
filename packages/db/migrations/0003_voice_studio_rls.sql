-- Voice Studio: isolamento por estabelecimento.
-- personas: a biblioteca (tenant_id nulo) é legível por todos; cada estabelecimento lê e grava
-- apenas as próprias personagens. A biblioteca só é gravada pelo papel dono (seed).
ALTER TABLE "personas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY personas_read ON "personas" FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY personas_write ON "personas" FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY personas_update ON "personas" FOR UPDATE
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY personas_delete ON "personas" FOR DELETE
  USING (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "receptionist_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "receptionist_configs"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
