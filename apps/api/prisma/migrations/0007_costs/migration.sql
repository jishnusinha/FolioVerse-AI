-- Gate 9: cost intelligence (price units, rollups, anomalies, provider reconciliation, infrastructure costs)

-- AlterTable
ALTER TABLE "app"."model_prices" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'MTOK';

-- Local compute rates were already per CPU-hour (stored in input_per_mtok).
UPDATE "app"."model_prices" SET "unit" = 'CPU_HOUR' WHERE "model_config_id" = 'local-compute';

-- CreateTable
CREATE TABLE "app"."cost_rollups" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "granularity" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "entries" INTEGER NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."cost_anomalies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "baseline_mean" DECIMAL(18,8) NOT NULL,
    "baseline_std" DECIMAL(18,8) NOT NULL,
    "z_score" DOUBLE PRECISION NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."provider_cost_reports" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ledger_amount" DECIMAL(18,8),
    "variance" DECIMAL(18,8),
    "entries" INTEGER NOT NULL DEFAULT 0,
    "imported_by_id" UUID,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_cost_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."infra_costs" (
    "id" UUID NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gcp',
    "service" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL,
    "external_key" TEXT,
    "note" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "entered_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "infra_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_rollups_granularity_bucket_start_idx" ON "app"."cost_rollups"("granularity", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "cost_rollups_workspace_id_granularity_bucket_start_dimensio_key" ON "app"."cost_rollups"("workspace_id", "granularity", "bucket_start", "dimension", "key");

-- CreateIndex
CREATE INDEX "cost_anomalies_created_at_idx" ON "app"."cost_anomalies"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_anomalies_workspace_id_day_dimension_key_key" ON "app"."cost_anomalies"("workspace_id", "day", "dimension", "key");

-- CreateIndex
CREATE UNIQUE INDEX "provider_cost_reports_provider_day_key" ON "app"."provider_cost_reports"("provider", "day");

-- CreateIndex
CREATE UNIQUE INDEX "infra_costs_external_key_key" ON "app"."infra_costs"("external_key");

-- CreateIndex
CREATE INDEX "infra_costs_day_idx" ON "app"."infra_costs"("day");

