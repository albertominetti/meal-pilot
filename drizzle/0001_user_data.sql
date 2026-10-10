CREATE TABLE "meal_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"video_id" text NOT NULL,
	"plan_id" text,
	"cooked" boolean NOT NULL,
	"rating" integer,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"version" integer NOT NULL,
	"request" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"shopping_list" jsonb NOT NULL,
	"checked" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "meal_logs_user_id_idx" ON "meal_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plans_user_id_idx" ON "plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plans_created_at_idx" ON "plans" USING btree ("created_at");