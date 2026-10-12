/* Generated from packages/contracts/schemas by scripts/generate.mjs. Do not edit. */
/* eslint-disable */
/**
 * Every streamed event (NDJSON work-unit lines, Redis Stream entries, SSE messages) uses this envelope.
 */
export interface EventEnvelope {
schemaVersion: 1
/**
 * Redis Stream id once relayed; used as SSE Last-Event-ID
 */
id?: string
type: ("run.started" | "run.state" | "node.started" | "node.finished" | "retrieval.completed" | "token.delta" | "citation.validated" | "usage.recorded" | "cost.updated" | "message.checkpoint" | "run.finished" | "run.failed" | "heartbeat" | "ingestion.stage" | "ingestion.finished" | "notification")
runId?: string
workspaceId?: string
seq: number
ts: string
traceId?: string
data: {

}
}
export interface IngestionEventData {
IngestionStage?: IngestionStage
IngestionFinished?: IngestionFinished
}
/**
 * This interface was referenced by `IngestionEventData`'s JSON-Schema
 * via the `definition` "IngestionStage".
 */
export interface IngestionStage {
sourceId?: string
sourceVersionId: string
jobId?: string
state: ("UPLOADING" | "UPLOADED" | "SCANNING" | "PREVIEW_READY" | "PARSING" | "INDEXING" | "READY" | "PARTIAL" | "FAILED" | "QUARANTINED")
progress?: number
message?: string
}
/**
 * This interface was referenced by `IngestionEventData`'s JSON-Schema
 * via the `definition` "IngestionFinished".
 */
export interface IngestionFinished {
sourceVersionId: string
state: ("READY" | "PARTIAL" | "FAILED" | "QUARANTINED")
stats: {
pages?: number
elements?: number
parentChunks?: number
childChunks?: number
failedPages?: number[]
embedder?: string
collection?: string
}
error?: string
}
/**
 * Resolved at admission by the API. The AI service may only fall back to models listed here.
 */
export interface ModelPlan {
primary: ModelRef
fallbacks: ModelRef[]
maxOutputTokens: number
temperature: number
isDemo: boolean
reservation?: {
reservationId?: string
amount?: string
currency?: string
}
/**
 * Set only under a hard budget. The graph stops before generating when its real prompt could cost more than maxCost.
 */
budgetGuard?: {
maxCost: string
prices: {
inputPerMTok: string
outputPerMTok: string
cachedInputPerMTok?: (string | null)
reasoningPerMTok?: (string | null)
batchDiscount?: (string | null)
}
}
}
/**
 * This interface was referenced by `ModelPlan`'s JSON-Schema
 * via the `definition` "ModelRef".
 */
export interface ModelRef {
modelConfigId: string
provider: ("mock" | "openai" | "ollama")
model: string
contextWindow?: number
}
/**
 * Payload (envelope.data) per run event type.
 */
export interface RunEventData {
RunStarted?: RunStarted
RunState?: RunState
NodeStarted?: NodeStarted
NodeFinished?: NodeFinished
RetrievalCompleted?: RetrievalCompleted
TokenDelta?: TokenDelta
CitationValidated?: CitationValidated
UsageRecorded?: UsageRecorded
Usage?: Usage
CostUpdated?: CostUpdated
MessageCheckpoint?: MessageCheckpoint
RunFinished?: RunFinished
RunFailed?: RunFailed
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "RunStarted".
 */
export interface RunStarted {
graph: ("grounded_qa" | "insight" | "multi_doc_compare" | "risk_contradiction" | "knowledge_map" | "writer_revision" | "continuity_check" | "dna_extraction" | "passage_explain" | "research_writing" | "rec_explain")
tier: ("T0" | "T1" | "T2")
model?: string
isDemo?: boolean
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "RunState".
 */
export interface RunState {
status: ("QUEUED" | "RUNNING" | "STREAMING" | "AWAITING_INPUT" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED" | "INTERRUPTED" | "BUDGET_REJECTED")
reason?: string
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "NodeStarted".
 */
export interface NodeStarted {
node: string
step: number
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "NodeFinished".
 */
export interface NodeFinished {
node: string
step: number
durationMs: number
status: ("OK" | "ERROR" | "SKIPPED")
summary?: {

}
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "RetrievalCompleted".
 */
export interface RetrievalCompleted {
candidates: number
packed: number
topScore?: number
contextTokens?: number
sources?: {
marker: string
chunkId: string
sourceVersionId: string
title?: string
page?: number
score?: number
}[]
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "TokenDelta".
 */
export interface TokenDelta {
text: string
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "CitationValidated".
 */
export interface CitationValidated {
marker: string
state: ("VALID" | "WEAK" | "UNRESOLVED" | "PERMISSION_REVOKED" | "SOURCE_PURGED")
score?: number
anchor?: SourceAnchor
quote?: string
}
/**
 * Multi-selector pointer into an immutable source version. Readers resolve the most specific selector available and report an anchor state.
 */
export interface SourceAnchor {
sourceVersionId: string
chunkId?: string
selectors: {
page?: number
/**
 * [x0, top, x1, bottom] in PDF points relative to the page
 * 
 * @minItems 4
 * @maxItems 4
 */
bbox?: [number, number, number, number]
textPosition?: {
start: number
end: number
}
textQuote?: {
exact: string
prefix?: string
suffix?: string
}
blockId?: string
cfi?: string
headingPath?: string[]
}
state?: ("EXACT" | "SHIFTED" | "FUZZY" | "ORPHANED")
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "UsageRecorded".
 */
export interface UsageRecorded {
usageEventId: string
modelCallId: string
provider: string
model: string
/**
 * true when token counts came from the provider response
 */
reported: boolean
usage: Usage
latencyMs?: number
isDemo?: boolean
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "Usage".
 */
export interface Usage {
input: number
output: number
cachedInput?: number
reasoning?: number
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "CostUpdated".
 */
export interface CostUpdated {
tier: ("PREFLIGHT_ESTIMATE" | "LIVE_ESTIMATE" | "FINALIZED" | "FINAL_ESTIMATED" | "RECONCILED" | "VARIANCE")
amount: string
currency: string
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "MessageCheckpoint".
 */
export interface MessageCheckpoint {
text: string
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "RunFinished".
 */
export interface RunFinished {
status: ("QUEUED" | "RUNNING" | "STREAMING" | "AWAITING_INPUT" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED" | "INTERRUPTED" | "BUDGET_REJECTED")
outcome: ("ANSWERED" | "ABSTAINED" | "PARTIAL")
answer?: string
artifact?: {

}
}
/**
 * This interface was referenced by `RunEventData`'s JSON-Schema
 * via the `definition` "RunFailed".
 */
export interface RunFailed {
errorClass: ("PROVIDER" | "RETRIEVAL" | "VALIDATION" | "TIMEOUT" | "CANCELLED" | "BUDGET" | "INTERNAL")
message: string
retryable: boolean
}
/**
 * Client request to start an AI run (POST /api/runs).
 */
export interface RunSpec {
graph: ("grounded_qa" | "insight" | "multi_doc_compare" | "risk_contradiction" | "knowledge_map" | "writer_revision" | "continuity_check" | "dna_extraction" | "passage_explain" | "research_writing" | "rec_explain")
threadId?: string
parentMessageId?: string
input: {
question?: string
action?: string
text?: string
params?: {

}
}
scope?: {
projectId?: string
sourceIds?: string[]
sourceVersionIds?: string[]
}
/**
 * model_configs.id or alias; resolved server-side
 */
modelPreference?: string
/**
 * Studio lab run (playground, battle, failure injection)
 */
lab?: boolean
options?: {
topK?: number
fusion?: ("rrf" | "dense" | "sparse")
rerank?: boolean
inject?: ("provider_timeout" | "provider_429" | "malformed_output" | "retrieval_down")
}
}
/**
 * ES256-signed claims minted by the API. The AI service derives every vector-store filter from these claims only.
 */
export interface ScopeTokenClaims {
iss: "folioverse-api"
aud: "folioverse-ai"
typ: "scope"
/**
 * ai_run id
 */
sub: string
/**
 * workspace id
 */
wid: string
/**
 * allowed source_version ids
 */
svids: string[]
iat: number
exp: number
}
/**
 * Multi-selector pointer into an immutable source version. Readers resolve the most specific selector available and report an anchor state.
 */
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "IngestionState".
 */
export type IngestionState = ("UPLOADING" | "UPLOADED" | "SCANNING" | "PREVIEW_READY" | "PARSING" | "INDEXING" | "READY" | "PARTIAL" | "FAILED" | "QUARANTINED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "RunStatus".
 */
export type RunStatus = ("QUEUED" | "RUNNING" | "STREAMING" | "AWAITING_INPUT" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED" | "INTERRUPTED" | "BUDGET_REJECTED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "RunOutcome".
 */
export type RunOutcome = ("ANSWERED" | "ABSTAINED" | "PARTIAL")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "CitationState".
 */
export type CitationState = ("VALID" | "WEAK" | "UNRESOLVED" | "PERMISSION_REVOKED" | "SOURCE_PURGED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "AnchorState".
 */
export type AnchorState = ("EXACT" | "SHIFTED" | "FUZZY" | "ORPHANED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "SuggestionState".
 */
export type SuggestionState = ("PENDING" | "ACCEPTED" | "REJECTED" | "STALE" | "SUPERSEDED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "CostTier".
 */
export type CostTier = ("PREFLIGHT_ESTIMATE" | "LIVE_ESTIMATE" | "FINALIZED" | "FINAL_ESTIMATED" | "RECONCILED" | "VARIANCE")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "CostClass".
 */
export type CostClass = ("AI_API" | "LOCAL_COMPUTE" | "CLOUD_INFRA")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "DnaStatus".
 */
export type DnaStatus = ("CANON" | "PROPOSED" | "RETIRED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "DnaOrigin".
 */
export type DnaOrigin = ("AUTHOR" | "AI_EXTRACTED")
/**
 * This interface was referenced by `States`'s JSON-Schema
 * via the `definition` "GraphName".
 */
export type GraphName = ("grounded_qa" | "insight" | "multi_doc_compare" | "risk_contradiction" | "knowledge_map" | "writer_revision" | "continuity_check" | "dna_extraction" | "passage_explain" | "research_writing" | "rec_explain")

/**
 * Shared state vocabularies. The web STATES module, Prisma enums and Python enums must match these exactly.
 */
export interface States {
IngestionState?: IngestionState
RunStatus?: RunStatus
RunOutcome?: RunOutcome
CitationState?: CitationState
AnchorState?: AnchorState
SuggestionState?: SuggestionState
CostTier?: CostTier
CostClass?: CostClass
DnaStatus?: DnaStatus
DnaOrigin?: DnaOrigin
GraphName?: GraphName
}
/**
 * Bounded, held-open streaming HTTP request from api-worker to the AI service. The response body is NDJSON EventEnvelope lines.
 */
export interface WorkUnit {
RunUnitRequest?: RunUnitRequest
IngestUnitRequest?: IngestUnitRequest
}
/**
 * This interface was referenced by `WorkUnit`'s JSON-Schema
 * via the `definition` "RunUnitRequest".
 */
export interface RunUnitRequest {
runId: string
workspaceId: string
graph: ("grounded_qa" | "insight" | "multi_doc_compare" | "risk_contradiction" | "knowledge_map" | "writer_revision" | "continuity_check" | "dna_extraction" | "passage_explain" | "research_writing" | "rec_explain")
input: {

}
history?: {
role: ("user" | "assistant")
content: string
}[]
modelPlan: ModelPlan
scopeToken: string
options?: {

}
resumeFromCheckpoint?: string
traceparent?: string
}
/**
 * Resolved at admission by the API. The AI service may only fall back to models listed here.
 */
export interface IngestUnitRequest {
jobId: string
workspaceId: string
projectId?: string
sourceId: string
sourceVersionId: string
title?: string
mimeType: string
/**
 * short-lived signed GET URL
 */
objectUrl: string
sha256?: string
traceparent?: string
}
