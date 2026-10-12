-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ai";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "app"."WorkspaceKind" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "app"."MemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "app"."ProjectKind" AS ENUM ('KNOWLEDGE', 'WRITER', 'LIBRARY');

-- CreateEnum
CREATE TYPE "app"."AuthTokenKind" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "app"."IngestionState" AS ENUM ('UPLOADING', 'UPLOADED', 'SCANNING', 'PREVIEW_READY', 'PARSING', 'INDEXING', 'READY', 'PARTIAL', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "app"."SourceKind" AS ENUM ('DOCUMENT', 'BOOK');

-- CreateEnum
CREATE TYPE "app"."RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'STREAMING', 'AWAITING_INPUT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED');

-- CreateEnum
CREATE TYPE "app"."RunOutcome" AS ENUM ('ANSWERED', 'ABSTAINED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "app"."CitationState" AS ENUM ('VALID', 'WEAK', 'UNRESOLVED', 'PERMISSION_REVOKED', 'SOURCE_PURGED');

-- CreateEnum
CREATE TYPE "app"."MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "app"."MessageStatus" AS ENUM ('COMPLETE', 'STREAMING', 'FAILED', 'ABSTAINED');

-- CreateEnum
CREATE TYPE "app"."ModelStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISABLED');

-- CreateEnum
CREATE TYPE "app"."CostTier" AS ENUM ('PREFLIGHT_ESTIMATE', 'LIVE_ESTIMATE', 'FINALIZED', 'FINAL_ESTIMATED', 'RECONCILED', 'VARIANCE');

-- CreateEnum
CREATE TYPE "app"."CostClass" AS ENUM ('AI_API', 'LOCAL_COMPUTE', 'CLOUD_INFRA');

-- CreateEnum
CREATE TYPE "app"."CostEntryType" AS ENUM ('ESTIMATE', 'FINAL', 'RECONCILIATION', 'VARIANCE');

-- CreateEnum
CREATE TYPE "app"."BudgetScope" AS ENUM ('WORKSPACE', 'USER', 'PROJECT');

-- CreateEnum
CREATE TYPE "app"."BudgetPeriodKind" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "app"."ReservationStatus" AS ENUM ('OPEN', 'CONSUMED', 'RELEASED');

-- CreateTable
CREATE TABLE "app"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "platform_role" "app"."PlatformRole" NOT NULL DEFAULT 'USER',
    "email_verified_at" TIMESTAMP(3),
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "app"."AuthTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "app"."WorkspaceKind" NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."workspace_members" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "app"."MemberRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "app"."invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "app"."MemberRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "app"."ProjectKind" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."folders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."stored_objects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."upload_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "folder_id" UUID,
    "user_id" UUID NOT NULL,
    "source_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "state" "app"."IngestionState" NOT NULL DEFAULT 'UPLOADING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."sources" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "folder_id" UUID,
    "title" TEXT NOT NULL,
    "kind" "app"."SourceKind" NOT NULL DEFAULT 'DOCUMENT',
    "mime_type" TEXT NOT NULL,
    "current_version_id" UUID,
    "ingestion_state" "app"."IngestionState" NOT NULL DEFAULT 'UPLOADING',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."source_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "stored_object_id" UUID NOT NULL,
    "mime_type" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER,
    "ingestion_state" "app"."IngestionState" NOT NULL DEFAULT 'UPLOADED',
    "ingestion_error" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ingestion_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "state" "app"."IngestionState" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "stats" JSONB,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."index_manifests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "collection" TEXT NOT NULL,
    "embedder" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "parent_count" INTEGER NOT NULL,
    "child_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."source_pages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "page_no" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,

    CONSTRAINT "source_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."chunks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "parent_id" UUID,
    "level" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "locator" JSONB NOT NULL,
    "heading_path" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."retrieval_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "packed" JSONB NOT NULL,
    "latency_ms" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."embedding_cache" (
    "key" TEXT NOT NULL,
    "embedder" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app"."context_scopes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "source_version_ids" UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."threads" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "source_id" UUID,
    "title" TEXT NOT NULL,
    "context_scope_id" UUID,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "parent_message_id" UUID,
    "role" "app"."MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "app"."MessageStatus" NOT NULL DEFAULT 'COMPLETE',
    "ai_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."message_citations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "marker" TEXT NOT NULL,
    "chunk_id" UUID,
    "source_version_id" UUID NOT NULL,
    "state" "app"."CitationState" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quote" TEXT NOT NULL DEFAULT '',
    "anchor" JSONB NOT NULL,

    CONSTRAINT "message_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ai_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "thread_id" UUID,
    "message_id" UUID,
    "graph" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" "app"."RunStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" "app"."RunOutcome",
    "input" JSONB NOT NULL,
    "scope" JSONB,
    "model_plan" JSONB,
    "options" JSONB,
    "result" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "lab" BOOLEAN NOT NULL DEFAULT false,
    "parent_run_id" UUID,
    "forked_from_checkpoint" TEXT,
    "error" JSONB,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ai_run_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."node_executions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "node" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "duration_ms" DOUBLE PRECISION,
    "summary" JSONB,

    CONSTRAINT "node_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."model_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "app"."ModelStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "context_window" INTEGER NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "fallback_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."model_prices" (
    "id" UUID NOT NULL,
    "model_config_id" TEXT NOT NULL,
    "input_per_mtok" DECIMAL(18,8) NOT NULL,
    "output_per_mtok" DECIMAL(18,8) NOT NULL,
    "cached_input_per_mtok" DECIMAL(18,8),
    "reasoning_per_mtok" DECIMAL(18,8),
    "batch_discount" DECIMAL(6,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "source_url" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "entered_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."model_calls" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "model_config_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "latency_ms" DOUBLE PRECISION,
    "error_class" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."usage_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID,
    "user_id" UUID,
    "model_call_id" UUID,
    "model_config_id" TEXT,
    "cost_class" "app"."CostClass" NOT NULL DEFAULT 'AI_API',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "compute_seconds" DECIMAL(18,6),
    "reported" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "feature" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."cost_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "run_id" UUID,
    "usage_event_id" UUID,
    "model_call_id" UUID,
    "model_config_id" TEXT,
    "entry_type" "app"."CostEntryType" NOT NULL,
    "tier" "app"."CostTier" NOT NULL,
    "cost_class" "app"."CostClass" NOT NULL DEFAULT 'AI_API',
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "price_id" UUID,
    "reason" TEXT,
    "supersedes_entry_id" UUID,
    "feature" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."budget_policies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "scope" "app"."BudgetScope" NOT NULL,
    "scope_ref_id" UUID,
    "period" "app"."BudgetPeriodKind" NOT NULL DEFAULT 'MONTHLY',
    "limit_amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "hard" BOOLEAN NOT NULL DEFAULT true,
    "alert_thresholds" INTEGER[] DEFAULT ARRAY[75, 90, 100]::INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."budget_periods" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "limit_amount" DECIMAL(18,8) NOT NULL,
    "spent_final" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "reserved_open" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "alerts_sent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "budget_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."budget_reservations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "status" "app"."ReservationStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."audit_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."idempotency_keys" (
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "app"."notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "app"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "app"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "app"."refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "app"."auth_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "app"."invitations"("token_hash");

-- CreateIndex
CREATE INDEX "projects_workspace_id_kind_idx" ON "app"."projects"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspace_id_id_key" ON "app"."projects"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "folders_project_id_path_idx" ON "app"."folders"("project_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "folders_workspace_id_id_key" ON "app"."folders"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stored_objects_workspace_id_id_key" ON "app"."stored_objects"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "sources_workspace_id_project_id_idx" ON "app"."sources"("workspace_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "sources_workspace_id_id_key" ON "app"."sources"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "source_versions_workspace_id_id_key" ON "app"."source_versions"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "source_versions_source_id_version_no_key" ON "app"."source_versions"("source_id", "version_no");

-- CreateIndex
CREATE INDEX "ingestion_jobs_source_version_id_idx" ON "app"."ingestion_jobs"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_manifests_source_version_id_key" ON "ai"."index_manifests"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_pages_source_version_id_page_no_key" ON "ai"."source_pages"("source_version_id", "page_no");

-- CreateIndex
CREATE INDEX "chunks_source_version_id_level_ordinal_idx" ON "ai"."chunks"("source_version_id", "level", "ordinal");

-- CreateIndex
CREATE INDEX "retrieval_events_run_id_idx" ON "ai"."retrieval_events"("run_id");

-- CreateIndex
CREATE INDEX "threads_workspace_id_source_id_idx" ON "app"."threads"("workspace_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_workspace_id_id_key" ON "app"."threads"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "app"."messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspace_id_id_key" ON "app"."messages"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_citations_message_id_marker_key" ON "app"."message_citations"("message_id", "marker");

-- CreateIndex
CREATE INDEX "ai_runs_workspace_id_created_at_idx" ON "app"."ai_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_status_heartbeat_at_idx" ON "app"."ai_runs"("status", "heartbeat_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_runs_workspace_id_id_key" ON "app"."ai_runs"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_events_run_id_seq_key" ON "app"."ai_run_events"("run_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "node_executions_run_id_step_node_key" ON "app"."node_executions"("run_id", "step", "node");

-- CreateIndex
CREATE INDEX "model_prices_model_config_id_effective_from_idx" ON "app"."model_prices"("model_config_id", "effective_from");

-- CreateIndex
CREATE INDEX "model_calls_run_id_idx" ON "app"."model_calls"("run_id");

-- CreateIndex
CREATE INDEX "usage_events_workspace_id_created_at_idx" ON "app"."usage_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_processed_at_idx" ON "app"."usage_events"("processed_at");

-- CreateIndex
CREATE INDEX "cost_entries_workspace_id_created_at_idx" ON "app"."cost_entries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "cost_entries_run_id_idx" ON "app"."cost_entries"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entries_usage_event_id_entry_type_key" ON "app"."cost_entries"("usage_event_id", "entry_type");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entries_model_call_id_tier_key" ON "app"."cost_entries"("model_call_id", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "budget_periods_policy_id_period_start_key" ON "app"."budget_periods"("policy_id", "period_start");

-- CreateIndex
CREATE INDEX "budget_reservations_run_id_idx" ON "app"."budget_reservations"("run_id");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "app"."audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "app"."notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "app"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."folders" ADD CONSTRAINT "folders_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "app"."projects"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."sources" ADD CONSTRAINT "sources_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "app"."projects"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."source_versions" ADD CONSTRAINT "source_versions_workspace_id_source_id_fkey" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "app"."sources"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_workspace_id_thread_id_fkey" FOREIGN KEY ("workspace_id", "thread_id") REFERENCES "app"."threads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_workspace_id_message_id_fkey" FOREIGN KEY ("workspace_id", "message_id") REFERENCES "app"."messages"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."model_prices" ADD CONSTRAINT "model_prices_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "app"."model_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."budget_periods" ADD CONSTRAINT "budget_periods_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "app"."budget_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
