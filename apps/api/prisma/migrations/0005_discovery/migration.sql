-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "rec";

-- CreateEnum
CREATE TYPE "rec"."CatalogKind" AS ENUM ('BOOK', 'FILM');

-- CreateEnum
CREATE TYPE "rec"."InteractionKind" AS ENUM ('IMPRESSION', 'CLICK', 'SAVE', 'UNSAVE', 'LIKE', 'DISLIKE', 'DISMISS', 'UNDISMISS', 'EXPLAIN');

-- CreateEnum
CREATE TYPE "rec"."RecSetMode" AS ENUM ('DISCOVER', 'LAB');

-- CreateEnum
CREATE TYPE "rec"."EvalStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "rec"."catalog_items" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "rec"."CatalogKind" NOT NULL,
    "title" TEXT NOT NULL,
    "creators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "franchise" TEXT,
    "length" INTEGER,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "cover_tone" INTEGER NOT NULL DEFAULT 1,
    "is_demo" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'SYNTHETIC',
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rec"."item_themes" (
    "item_id" UUID NOT NULL,
    "theme" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "item_themes_pkey" PRIMARY KEY ("item_id","theme")
);

-- CreateTable
CREATE TABLE "rec"."taste_profiles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seed_item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onboarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taste_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rec"."interactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" "rec"."InteractionKind" NOT NULL,
    "set_id" UUID,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rec"."recommendation_sets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" "rec"."RecSetMode" NOT NULL DEFAULT 'DISCOVER',
    "query" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "lambda" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "k" INTEGER NOT NULL DEFAULT 12,
    "model_version" TEXT NOT NULL,
    "stages" JSONB NOT NULL DEFAULT '{}',
    "profile_summary" JSONB NOT NULL DEFAULT '{}',
    "cold_start" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rec"."recommendation_items" (
    "set_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "base_rank" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "shared_themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "because_of" JSONB,
    "rationale" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "recommendation_items_pkey" PRIMARY KEY ("set_id","rank")
);

-- CreateTable
CREATE TABLE "rec"."feedback" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "library_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rec"."evaluation_reports" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "rec"."EvalStatus" NOT NULL DEFAULT 'QUEUED',
    "k" INTEGER NOT NULL DEFAULT 10,
    "model_version" TEXT,
    "report" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "evaluation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_slug_key" ON "rec"."catalog_items"("slug");

-- CreateIndex
CREATE INDEX "catalog_items_kind_idx" ON "rec"."catalog_items"("kind");

-- CreateIndex
CREATE INDEX "item_themes_theme_idx" ON "rec"."item_themes"("theme");

-- CreateIndex
CREATE UNIQUE INDEX "taste_profiles_workspace_id_user_id_key" ON "rec"."taste_profiles"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "interactions_workspace_id_user_id_created_at_idx" ON "rec"."interactions"("workspace_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "interactions_item_id_idx" ON "rec"."interactions"("item_id");

-- CreateIndex
CREATE INDEX "recommendation_sets_workspace_id_user_id_mode_created_at_idx" ON "rec"."recommendation_sets"("workspace_id", "user_id", "mode", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_workspace_id_user_id_item_id_key" ON "rec"."feedback"("workspace_id", "user_id", "item_id");

-- CreateIndex
CREATE INDEX "evaluation_reports_workspace_id_created_at_idx" ON "rec"."evaluation_reports"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "rec"."item_themes" ADD CONSTRAINT "item_themes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "rec"."catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rec"."recommendation_items" ADD CONSTRAINT "recommendation_items_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "rec"."recommendation_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rec"."recommendation_items" ADD CONSTRAINT "recommendation_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "rec"."catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
