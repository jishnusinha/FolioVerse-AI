-- CreateEnum
CREATE TYPE "app"."ManuscriptNodeKind" AS ENUM ('PART', 'CHAPTER', 'SCENE');

-- CreateEnum
CREATE TYPE "app"."RevisionOrigin" AS ENUM ('AUTHOR', 'POST_AI', 'RESTORE', 'UNDO');

-- CreateEnum
CREATE TYPE "app"."SuggestionState" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'STALE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "app"."DnaStatus" AS ENUM ('CANON', 'PROPOSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "app"."DnaOrigin" AS ENUM ('AUTHOR', 'AI_EXTRACTED');

-- CreateEnum
CREATE TYPE "app"."IssueState" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "app"."manuscripts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "daily_goal" INTEGER NOT NULL DEFAULT 1000,
    "day_start" DATE,
    "day_start_words" INTEGER NOT NULL DEFAULT 0,
    "dna_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manuscripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."manuscript_nodes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "app"."ManuscriptNodeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pov" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manuscript_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."rich_docs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rich_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."doc_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "origin" "app"."RevisionOrigin" NOT NULL,
    "content" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."suggestions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "block_id" TEXT NOT NULL,
    "batch_id" UUID,
    "run_id" UUID,
    "mode" TEXT NOT NULL,
    "tone" TEXT,
    "instruction" TEXT NOT NULL,
    "state" "app"."SuggestionState" NOT NULL DEFAULT 'PENDING',
    "base_revision" INTEGER NOT NULL,
    "base_text" TEXT NOT NULL,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "chosen" INTEGER,
    "applied_revision" INTEGER,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."dna_facts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL DEFAULT 'CHARACTER',
    "predicate" TEXT,
    "value" TEXT,
    "statement" TEXT NOT NULL,
    "status" "app"."DnaStatus" NOT NULL,
    "origin" "app"."DnaOrigin" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "run_id" UUID,
    "note" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dna_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."dna_links" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "status" "app"."DnaStatus" NOT NULL,
    "origin" "app"."DnaOrigin" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "run_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dna_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."continuity_issues" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "block_id" TEXT,
    "run_id" UUID,
    "fact_id" UUID,
    "entity" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "found" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" "app"."IssueState" NOT NULL DEFAULT 'OPEN',
    "anchors" JSONB NOT NULL DEFAULT '[]',
    "fingerprint" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "continuity_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."excerpts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_id" UUID,
    "source_version_id" UUID,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "anchor" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excerpts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."research_notes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "manuscript_id" UUID NOT NULL,
    "node_id" UUID,
    "excerpt_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "quote" TEXT,
    "source" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manuscripts_workspace_id_project_id_idx" ON "app"."manuscripts"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "manuscript_nodes_manuscript_id_parent_id_position_idx" ON "app"."manuscript_nodes"("manuscript_id", "parent_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "rich_docs_node_id_key" ON "app"."rich_docs"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_revisions_doc_id_revision_key" ON "app"."doc_revisions"("doc_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "suggestions_run_id_key" ON "app"."suggestions"("run_id");

-- CreateIndex
CREATE INDEX "suggestions_doc_id_state_idx" ON "app"."suggestions"("doc_id", "state");

-- CreateIndex
CREATE INDEX "suggestions_manuscript_id_created_at_idx" ON "app"."suggestions"("manuscript_id", "created_at");

-- CreateIndex
CREATE INDEX "dna_facts_manuscript_id_status_idx" ON "app"."dna_facts"("manuscript_id", "status");

-- CreateIndex
CREATE INDEX "dna_links_manuscript_id_idx" ON "app"."dna_links"("manuscript_id");

-- CreateIndex
CREATE INDEX "continuity_issues_manuscript_id_state_idx" ON "app"."continuity_issues"("manuscript_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "continuity_issues_manuscript_id_fingerprint_key" ON "app"."continuity_issues"("manuscript_id", "fingerprint");

-- CreateIndex
CREATE INDEX "excerpts_workspace_id_created_at_idx" ON "app"."excerpts"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "research_notes_manuscript_id_idx" ON "app"."research_notes"("manuscript_id");

-- AddForeignKey
ALTER TABLE "app"."manuscript_nodes" ADD CONSTRAINT "manuscript_nodes_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "app"."manuscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."rich_docs" ADD CONSTRAINT "rich_docs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "app"."manuscript_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."doc_revisions" ADD CONSTRAINT "doc_revisions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "app"."rich_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

