CREATE TYPE "public"."appointment_source" AS ENUM('DASHBOARD', 'AI_PHONE', 'AI_WHATSAPP', 'ONLINE', 'WALK_IN', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('HELD', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."auth_token_type" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."business_category" AS ENUM('BARBERSHOP', 'BEAUTY_SALON', 'UNISEX_SALON', 'HAIR_STUDIO', 'CURLY_HAIR_STUDIO', 'BRAIDS_STUDIO', 'COLOR_STUDIO', 'AESTHETICS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('CUSTOMER', 'STAFF', 'AI', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."closure_kind" AS ENUM('HOLIDAY', 'CLOSURE', 'EVENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('WHATSAPP_TRANSACTIONAL', 'WHATSAPP_MARKETING', 'CALL_RECORDING', 'DATA_PROCESSING');--> statement-breakpoint
CREATE TYPE "public"."customer_source" AS ENUM('DASHBOARD', 'PHONE', 'WHATSAPP', 'WALK_IN', 'IMPORT', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('OWNER', 'MANAGER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('SUPERADMIN', 'SUPPORT');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('FIXED', 'STARTING_AT', 'ON_REQUEST');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."time_off_kind" AS ENUM('DAY_OFF', 'VACATION', 'BLOCK', 'SICK_LEAVE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('WAITING', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"platform_role" "platform_role",
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "business_category" NOT NULL,
	"status" "tenant_status" DEFAULT 'ONBOARDING' NOT NULL,
	"legal_name" text,
	"document" text,
	"responsible_name" text,
	"phone" text,
	"whatsapp_number" text,
	"email" text,
	"address_street" text,
	"address_number" text,
	"address_complement" text,
	"address_district" text,
	"address_city" text,
	"address_state" text,
	"address_postal_code" text,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"slot_interval_min" integer DEFAULT 30 NOT NULL,
	"min_booking_notice_min" integer DEFAULT 60 NOT NULL,
	"max_booking_days_ahead" integer DEFAULT 60 NOT NULL,
	"cancellation_min_notice_min" integer DEFAULT 0 NOT NULL,
	"onboarding_step" text,
	"onboarding_completed_at" timestamp with time zone,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
	CONSTRAINT "tenants_slot_interval_range" CHECK ("tenants"."slot_interval_min" BETWEEN 5 AND 240),
	CONSTRAINT "tenants_notice_range" CHECK ("tenants"."min_booking_notice_min" BETWEEN 0 AND 10080),
	CONSTRAINT "tenants_days_ahead_range" CHECK ("tenants"."max_booking_days_ahead" BETWEEN 1 AND 365),
	CONSTRAINT "tenants_cancel_notice_range" CHECK ("tenants"."cancellation_min_notice_min" BETWEEN 0 AND 10080)
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_hours_weekday_range" CHECK ("business_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "business_hours_order" CHECK ("business_hours"."start_time" < "business_hours"."end_time")
);
--> statement-breakpoint
CREATE TABLE "closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "closure_kind" DEFAULT 'CLOSURE' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closures_order" CHECK ("closures"."starts_at" < "closures"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "professional_services" (
	"tenant_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"duration_min" integer,
	"price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_services_professional_id_service_id_pk" PRIMARY KEY("professional_id","service_id"),
	CONSTRAINT "professional_services_duration_range" CHECK ("professional_services"."duration_min" IS NULL OR "professional_services"."duration_min" BETWEEN 5 AND 720),
	CONSTRAINT "professional_services_price_positive" CHECK ("professional_services"."price_cents" IS NULL OR "professional_services"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "professional_working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_working_hours_weekday_range" CHECK ("professional_working_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "professional_working_hours_order" CHECK ("professional_working_hours"."start_time" < "professional_working_hours"."end_time")
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"bio" text,
	"email" text,
	"phone" text,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"bookable_by_ai" boolean DEFAULT true NOT NULL,
	"uses_business_hours" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "professionals_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"duration_min" integer NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"price_cents" integer,
	"price_type" "price_type" DEFAULT 'FIXED' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"bookable_by_ai" boolean DEFAULT true NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "services_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "services_duration_range" CHECK ("services"."duration_min" BETWEEN 5 AND 720),
	CONSTRAINT "services_buffer_range" CHECK ("services"."buffer_after_min" BETWEEN 0 AND 240),
	CONSTRAINT "services_price_positive" CHECK ("services"."price_cents" IS NULL OR "services"."price_cents" >= 0),
	CONSTRAINT "services_price_required" CHECK ("services"."price_type" = 'ON_REQUEST' OR "services"."price_cents" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"kind" time_off_kind DEFAULT 'BLOCK' NOT NULL,
	"reason" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_order" CHECK ("time_off"."starts_at" < "time_off"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"channel" text NOT NULL,
	"evidence" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"birth_date" date,
	"notes" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "customer_source" DEFAULT 'DASHBOARD' NOT NULL,
	"preferred_professional_id" uuid,
	"first_visit_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"visits_count" integer DEFAULT 0 NOT NULL,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"cancellation_count" integer DEFAULT 0 NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_phone_e164" CHECK ("customers"."phone" IS NULL OR "customers"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "appointment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"price_cents" integer,
	"price_type" "price_type" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"status" "appointment_status" DEFAULT 'CONFIRMED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"total_duration_min" integer NOT NULL,
	"total_price_cents" integer,
	"price_is_estimate" boolean DEFAULT false NOT NULL,
	"source" "appointment_source" NOT NULL,
	"is_overbook" boolean DEFAULT false NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"notes" text,
	"idempotency_key" text,
	"created_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by",
	"cancel_reason" text,
	"rescheduled_from_id" uuid,
	"reminder_sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "appointments_order" CHECK ("appointments"."starts_at" < "appointments"."ends_at" AND "appointments"."ends_at" <= "appointments"."blocked_until"),
	CONSTRAINT "appointments_duration_range" CHECK ("appointments"."total_duration_min" BETWEEN 5 AND 720),
	CONSTRAINT "appointments_hold_has_expiry" CHECK ("appointments"."status" <> 'HELD' OR "appointments"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "appointments_price_positive" CHECK ("appointments"."total_price_cents" IS NULL OR "appointments"."total_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"professional_id" uuid,
	"earliest_date" date NOT NULL,
	"latest_date" date NOT NULL,
	"preferred_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "waitlist_status" DEFAULT 'WAITING' NOT NULL,
	"offered_appointment_id" uuid,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_date_order" CHECK ("waitlist_entries"."earliest_date" <= "waitlist_entries"."latest_date")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"limits" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"is_founding_partner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_fk" FOREIGN KEY ("tenant_id","professional_id") REFERENCES "public"."professionals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_professional_fk" FOREIGN KEY ("tenant_id","professional_id") REFERENCES "public"."professionals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_professional_fk" FOREIGN KEY ("tenant_id","professional_id") REFERENCES "public"."professionals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_preferred_professional_id_professionals_id_fk" FOREIGN KEY ("preferred_professional_id") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_fk" FOREIGN KEY ("tenant_id","professional_id") REFERENCES "public"."professionals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_fk" FOREIGN KEY ("rescheduled_from_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_key" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_organization_idx" ON "tenants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "business_hours_tenant_idx" ON "business_hours" USING btree ("tenant_id","weekday");--> statement-breakpoint
CREATE INDEX "closures_tenant_range_idx" ON "closures" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "professional_services_tenant_idx" ON "professional_services" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "professional_services_service_idx" ON "professional_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "professional_working_hours_prof_idx" ON "professional_working_hours" USING btree ("tenant_id","professional_id","weekday");--> statement-breakpoint
CREATE INDEX "professionals_tenant_idx" ON "professionals" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "services_tenant_idx" ON "services" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "services_tenant_name_key" ON "services" USING btree ("tenant_id",lower("name")) WHERE "services"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "time_off_prof_range_idx" ON "time_off" USING btree ("tenant_id","professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "consents_customer_idx" ON "consents" USING btree ("tenant_id","customer_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_phone_key" ON "customers" USING btree ("tenant_id","phone") WHERE "customers"."phone" IS NOT NULL AND "customers"."anonymized_at" IS NULL;--> statement-breakpoint
CREATE INDEX "appointment_items_appointment_idx" ON "appointment_items" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_items_service_idx" ON "appointment_items" USING btree ("tenant_id","service_id");--> statement-breakpoint
CREATE INDEX "appointments_tenant_starts_idx" ON "appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_professional_starts_idx" ON "appointments" USING btree ("tenant_id","professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_starts_idx" ON "appointments" USING btree ("tenant_id","customer_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_hold_expiry_idx" ON "appointments" USING btree ("hold_expires_at") WHERE "appointments"."status" = 'HELD';--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_tenant_idempotency_key" ON "appointments" USING btree ("tenant_id","idempotency_key") WHERE "appointments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "waitlist_tenant_status_idx" ON "waitlist_entries" USING btree ("tenant_id","status","earliest_date");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subscriptions_organization_idx" ON "subscriptions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");