CREATE TABLE "fdc_mappings" (
	"normalised_name" text PRIMARY KEY NOT NULL,
	"fdc_id" integer,
	"description" text,
	"data_type" text,
	"nutrients" jsonb,
	"portions" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_analyses" (
	"video_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"schema_version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "video_analyses_video_id_provider_model_schema_version_pk" PRIMARY KEY("video_id","provider","model","schema_version")
);
--> statement-breakpoint
CREATE TABLE "youtube_search_cache" (
	"query_norm" text PRIMARY KEY NOT NULL,
	"video_ids" jsonb NOT NULL,
	"cached_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "video_analyses_analyzed_at_idx" ON "video_analyses" USING btree ("analyzed_at");