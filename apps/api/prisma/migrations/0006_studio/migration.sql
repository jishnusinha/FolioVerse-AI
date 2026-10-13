-- Gate 8: AI Studio (Model Battle, RAG evaluation runs)

-- CreateTable
CREATE TABLE "app"."model_battles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "source_run_id" UUID NOT NULL,
    "contestants" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "winner" TEXT,
    "voted_by_id" UUID,
    "voted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."evaluation_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "rec"."EvalStatus" NOT NULL DEFAULT 'QUEUED',
    "dataset" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "model_config_id" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "judge" BOOLEAN NOT NULL DEFAULT false,
    "run_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "items" JSONB,
    "metrics" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_battles_workspace_id_created_at_idx" ON "app"."model_battles"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_runs_workspace_id_created_at_idx" ON "app"."evaluation_runs"("workspace_id", "created_at");
