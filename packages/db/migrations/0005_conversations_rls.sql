-- Conversas: isolamento por estabelecimento (mesma política das demais tabelas operacionais).
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversations"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversation_messages"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "conversation_llm_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversation_llm_turns"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- O histórico enviado ao modelo é somente-acréscimo: nunca é editado depois de gravado.
CREATE FUNCTION forbid_llm_turn_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'conversation_llm_turns é somente-acréscimo' USING ERRCODE = '42501';
END $$;--> statement-breakpoint
CREATE TRIGGER conversation_llm_turns_append_only BEFORE UPDATE ON "conversation_llm_turns"
  FOR EACH ROW EXECUTE FUNCTION forbid_llm_turn_update();
