CREATE TYPE "public"."conversation_channel" AS ENUM('PHONE', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('CUSTOMER', 'ASSISTANT', 'STAFF', 'SYSTEM', 'TOOL');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('OPEN', 'HANDOFF', 'CLOSED');--> statement-breakpoint
CREATE TABLE "conversation_llm_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"messages" jsonb NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_llm_turns_seq_key" UNIQUE("tenant_id","conversation_id","seq")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_name" text,
	"tool_input" jsonb,
	"tool_output" jsonb,
	"verification" jsonb,
	"external_id" text,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "conversation_channel" NOT NULL,
	"status" "conversation_status" DEFAULT 'OPEN' NOT NULL,
	"is_simulation" boolean DEFAULT false NOT NULL,
	"customer_id" uuid,
	"contact_phone" text,
	"contact_name" text,
	"external_id" text,
	"persona_id" uuid,
	"persona_version" integer,
	"instructions_hash" text,
	"system_prompt" text,
	"language" jsonb,
	"model" text,
	"handoff_reason" text,
	"handoff_at" timestamp with time zone,
	"assigned_user_id" uuid,
	"started_by_user_id" uuid,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversations_phone_e164" CHECK ("conversations"."contact_phone" IS NULL OR "conversations"."contact_phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "conversation_llm_turns" ADD CONSTRAINT "conversation_llm_turns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_llm_turns" ADD CONSTRAINT "conversation_llm_turns_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_conv_idx" ON "conversation_messages" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_external_key" ON "conversation_messages" USING btree ("tenant_id","external_id") WHERE "conversation_messages"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_tenant_recent_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_tenant_contact_idx" ON "conversations" USING btree ("tenant_id","contact_phone","status");