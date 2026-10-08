ALTER TABLE "profiles" ADD COLUMN "services" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "custom_services" jsonb DEFAULT '[]'::jsonb NOT NULL;