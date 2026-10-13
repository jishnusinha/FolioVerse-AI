/** Agent Tutor: plain-language notes on how each graph works, what its tier means and where cost comes from. */

export const TIERS = {
  T0: { label: 'T0 · direct', text: 'One model call over context the graph has already prepared. No planning loop, so cost is predictable: one call per run.' },
  T1: { label: 'T1 · fixed workflow', text: 'A fixed graph of nodes (retrieve, generate, validate). Each node runs at most once; the model is called once unless a fallback is needed.' },
  T2: { label: 'T2 · agentic', text: 'A loop that chooses its own next tool call within a tool and token budget. Cost varies with the number of iterations.' },
};

const NODES = {
  retrieve: 'Hybrid search over the scoped sources: dense vectors and BM25 run separately, their rankings are fused with reciprocal-rank fusion (RRF), optionally reranked, then packed into a token budget.',
  abstain: 'Taken when retrieval finds no convincing evidence. The run answers "not found" without calling a model, so it costs nothing.',
  budget_stop: 'Taken when the workspace budget cannot cover the call. No model is called.',
  generate: 'One model call with the packed passages, each labelled [S1], [S2]… The model must cite those markers.',
  validate_citations: 'Deterministic check of every [S#] marker against the passage it points to. Unsupported citations are marked WEAK or UNRESOLVED; no model is used.',
  finalize: 'Stores the answer, citations and outcome (ANSWERED, ABSTAINED or PARTIAL).',
  assemble: 'Turns the generated text into the artifact format (table, outline, map) and attaches citations.',
  judge: 'Scores an answer from 1 to 5 for relevance to its question. Used by RAG evaluations when the judge is switched on.',
};

const GRAPHS = {
  grounded_qa: 'Answers a question from your documents only, with a citation for every claim, or abstains when the evidence is not there.',
  insight: 'Runs one insight action (summary, key facts, study tools) over the packed context of the selected documents.',
  multi_doc_compare: 'Compares two or more documents side by side with evidence from each.',
  risk_contradiction: 'Looks for risks and statements that contradict each other, citing both sides.',
  knowledge_map: 'Extracts entities and relations into a map, each edge backed by a citation.',
  writer_revision: 'Rewrites a selected passage of your draft in a requested style; no retrieval.',
  continuity_check: 'Checks a scene against the story bible for continuity conflicts.',
  dna_extraction: 'Extracts the narrative DNA (characters, themes, voice) of a manuscript.',
  passage_explain: 'Explains a passage of the book you are reading using only earlier pages, so nothing is spoiled.',
  research_writing: 'Researches across sources in a loop, then drafts with citations.',
  rec_explain: 'Explains in words why a title was recommended, from the recorded scoring factors.',
  answer_judge: 'Grades an answer for relevance. Without a live model it uses a DEMO word-overlap heuristic.',
};

/** Suggestions for the Playground based on how the run ended. */
function nextSteps(run, receipt) {
  const out = [];
  const retrieval = receipt?.retrieval?.[0];
  if (run.outcome === 'ABSTAINED') out.push('It abstained. In the Playground, raise top-K, switch fusion to sparse for exact terms, or widen the scope.');
  if (run.outcome === 'PARTIAL') out.push('Some citations did not validate. Open RAG X-Ray to check which passages were packed and compare with a stronger model.');
  if (run.status === 'FAILED') out.push('It failed. If a provider error caused it, a fallback model in the plan would have been tried; set one in the Playground.');
  if (retrieval && retrieval.packed < retrieval.candidates / 2) out.push('Most candidates were not packed. A larger context budget lets more evidence in, at the cost of more input tokens.');
  if (!out.length) out.push('Try the same question with a cheaper model in Model Battle to see whether quality holds at a lower cost.');
  return out;
}

/**
 * Tutor sections for a run.
 * @param {{ graph: string, tier?: string, status: string, outcome?: string | null }} run
 * @param {any} [receipt]
 */
export function tutorFor(run, receipt) {
  const tier = TIERS[run.tier] ?? null;
  const calls = receipt?.modelCalls?.length ?? 0;
  const tokens = receipt?.tokens;
  const cost =
    calls === 0
      ? 'No model was called, so this run costs nothing.'
      : `${calls} model call${calls === 1 ? '' : 's'} used ${tokens?.input ?? 0} input and ${tokens?.output ?? 0} output tokens. Cost is tokens × the registry price per million; retrieval, citation checks and replays are not billed as model usage.`;
  return {
    graph: GRAPHS[run.graph] ?? 'A LangGraph workflow registered in the AI service.',
    tier,
    nodes: NODES,
    cost,
    demo: receipt?.cost?.isDemo ? 'Prices here are DEMO values for the mock provider, not real provider prices.' : null,
    next: nextSteps(run, receipt),
  };
}
