/**
 * The research notebooks in `ml-notebooks/` (jupytext pairs). Their committed full-run findings come from
 * the API (`studio/capabilities` → `notebooks`, read from `datasets/evaluation/results/nb-*.json`).
 * Links point into the repository when `VITE_REPO_URL` is set (for example `https://github.com/<org>/<repo>/blob/main`).
 */
export const NOTEBOOKS = [
  { id: '01-parsing-chunking', file: '01_document_parsing_chunking', title: 'Document parsing & chunking', question: 'Exact offsets and locators per format; chunk size trade-offs.' },
  { id: '02-embedding-comparison', file: '02_embedding_comparison', title: 'Embedding comparison', question: 'Hash, TF-IDF, LSA and fastembed models on label queries.' },
  { id: '03-hybrid-retrieval-rrf', file: '03_hybrid_retrieval_rrf', title: 'Hybrid retrieval & RRF', question: 'Dense vs sparse vs fusion; RRF k and weighted fusion sweeps.' },
  { id: '04-reranking-ablation', file: '04_reranking_ablation', title: 'Reranking ablation', question: 'Lexical and cross-encoder reranking vs RRF only, by depth.' },
  { id: '05-citation-validation', file: '05_citation_validation_metrics', title: 'Citation validation metrics', question: 'Precision and recall of the citation validator on labelled answers.' },
  { id: '06-rag-evaluation', file: '06_rag_evaluation_harness', title: 'RAG evaluation harness', question: 'grounded_qa end to end: support, abstention, citations, cost.' },
  { id: '07-cost-modeling', file: '07_cost_modeling', title: 'Cost modeling & token economics', question: 'Pricing parity, context budget vs cost, DEMO spend scenarios.' },
  { id: '08-recsys', file: '08_recsys_content_cf_mmr', title: 'Recsys: content, CF, MMR', question: 'Offline evaluation, factor ablation, MMR λ sweep, cold start.' },
  { id: '09-taste-clustering', file: '09_taste_profile_clustering', title: 'Taste profile clustering', question: 'Are there stable, useful taste segments?' },
  { id: '10-narrative-dna', file: '10_narrative_dna_eval', title: 'Narrative DNA extraction eval', question: 'Entity, fact and continuity rules against known ground truth.' },
  { id: '11-trace-analytics', file: '11_langgraph_trace_analytics', title: 'LangGraph trace analytics', question: 'Steps, latency, tokens per node and failure classes.' },
];

const REPO_URL = String(import.meta.env.VITE_REPO_URL || '').replace(/\/+$/, '');

/** Repository URL of a path, or null when no repository URL is configured. */
export const repoLink = (path) => (REPO_URL ? `${REPO_URL}/${path}` : null);

/** Catalog entries joined with the findings the API reports (missing results stay listed, without findings). */
export function notebookRows(results) {
  const byName = new Map((results ?? []).map((r) => [r.name, r]));
  return NOTEBOOKS.map((n) => ({
    ...n,
    notebook: `ml-notebooks/${n.file}.ipynb`,
    results: `datasets/evaluation/results/nb-${n.id}.json`,
    run: byName.get(n.id) ?? null,
  }));
}
