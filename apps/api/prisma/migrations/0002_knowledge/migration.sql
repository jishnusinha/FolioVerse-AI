-- CreateEnum
CREATE TYPE "app"."ArtifactKind" AS ENUM ('SUMMARY', 'KEY_FACTS', 'STUDY_NOTES', 'FLASHCARDS', 'QUIZ', 'TASKS', 'REPORT', 'COMPARISON', 'RISK_REPORT', 'KNOWLEDGE_MAP');

-- CreateTable
CREATE TABLE "app"."artifacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "source_id" UUID,
    "run_id" UUID NOT NULL,
    "kind" "app"."ArtifactKind" NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "source_version_ids" UUID[],
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."notes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "source_id" UUID,
    "source_version_id" UUID,
    "body" TEXT NOT NULL,
    "quote" TEXT,
    "anchor" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_run_id_key" ON "app"."artifacts"("run_id");

-- CreateIndex
CREATE INDEX "artifacts_workspace_id_project_id_idx" ON "app"."artifacts"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "artifacts_workspace_id_source_id_idx" ON "app"."artifacts"("workspace_id", "source_id");

-- CreateIndex
CREATE INDEX "notes_workspace_id_source_id_idx" ON "app"."notes"("workspace_id", "source_id");

-- Full-text search (workspace search). Expression indexes are not expressible in schema.prisma.
CREATE INDEX "sources_title_fts" ON "app"."sources" USING GIN (to_tsvector('english', "title"));
CREATE INDEX "threads_title_fts" ON "app"."threads" USING GIN (to_tsvector('english', "title"));
CREATE INDEX "artifacts_title_fts" ON "app"."artifacts" USING GIN (to_tsvector('english', "title"));
CREATE INDEX "notes_text_fts" ON "app"."notes" USING GIN (to_tsvector('english', coalesce("quote", '') || ' ' || "body"));
