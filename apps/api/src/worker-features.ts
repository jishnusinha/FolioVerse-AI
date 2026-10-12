import type { Job } from 'bullmq';

/** Additional named job handlers registered by later gates (rollups, reconciliation, ...). */
export const WORKER_FEATURE_HANDLERS: Record<string, (job: Job) => Promise<unknown>> = {};
