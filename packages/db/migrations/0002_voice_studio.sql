CREATE TYPE "public"."customer_name_usage" AS ENUM('NEVER', 'GREETING', 'NATURAL');--> statement-breakpoint
CREATE TYPE "public"."formality" AS ENUM('FORMAL', 'SEMIFORMAL', 'INFORMAL');--> statement-breakpoint
CREATE TYPE "public"."persona_segment" AS ENUM('BARBERSHOP', 'SALON', 'ANY');--> statement-breakpoint
CREATE TYPE "public"."slang_level" AS ENUM('NONE', 'LOW', 'MODERATE', 'HIGH');--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"segment" "persona_segment" NOT NULL,
	"definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receptionist_configs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"persona_id" uuid NOT NULL,
	"persona_version" integer NOT NULL,
	"receptionist_name" text,
	"voice_id" text,
	"formality" "formality" DEFAULT 'SEMIFORMAL' NOT NULL,
	"slang_level" "slang_level" DEFAULT 'LOW' NOT NULL,
	"emojis_enabled" boolean DEFAULT false NOT NULL,
	"enthusiasm" smallint DEFAULT 3 NOT NULL,
	"relaxation" smallint DEFAULT 3 NOT NULL,
	"use_customer_name" "customer_name_usage" DEFAULT 'GREETING' NOT NULL,
	"greeting" text,
	"farewell" text,
	"signature_expressions" text[] DEFAULT '{}'::text[] NOT NULL,
	"vocabulary_prefer" text[] DEFAULT '{}'::text[] NOT NULL,
	"vocabulary_avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"business_instructions" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receptionist_enthusiasm_range" CHECK ("receptionist_configs"."enthusiasm" BETWEEN 1 AND 5),
	CONSTRAINT "receptionist_relaxation_range" CHECK ("receptionist_configs"."relaxation" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personas_library_key" ON "personas" USING btree ("key") WHERE "personas"."tenant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "personas_tenant_key" ON "personas" USING btree ("tenant_id","key") WHERE "personas"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "personas_tenant_idx" ON "personas" USING btree ("tenant_id");