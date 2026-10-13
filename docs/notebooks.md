# Research notebooks

FolioVerse ships eleven evaluation notebooks in [`ml-notebooks/`](../ml-notebooks/README.md). Each one runs the
production `folioverse_ai` / `folioverse_ml` code on the synthetic datasets (`datasets/synthetic`,
`datasets/evaluation`) with the same hermetic setup as the test suite: in-memory Qdrant, the in-memory
repository, the deterministic hash embedder and the DEMO mock model. No notebook calls a paid provider.

All numbers describe relative behaviour on **synthetic** data. They are useful for comparing design choices
inside FolioVerse, not as claims about real-world quality. Costs use DEMO prices.

## Notebooks

| # | Notebook | Results file |
| --- | --- | --- |
| 01 | [Document parsing & chunking](../ml-notebooks/01_document_parsing_chunking.py) | `nb-01-parsing-chunking.json` |
| 02 | [Embedding comparison](../ml-notebooks/02_embedding_comparison.py) | `nb-02-embedding-comparison.json` |
| 03 | [Hybrid retrieval & RRF](../ml-notebooks/03_hybrid_retrieval_rrf.py) | `nb-03-hybrid-retrieval-rrf.json` |
| 04 | [Reranking ablation](../ml-notebooks/04_reranking_ablation.py) | `nb-04-reranking-ablation.json` |
| 05 | [Citation validation metrics](../ml-notebooks/05_citation_validation_metrics.py) | `nb-05-citation-validation.json` |
| 06 | [RAG evaluation harness](../ml-notebooks/06_rag_evaluation_harness.py) | `nb-06-rag-evaluation.json` |
| 07 | [Cost modeling & token economics](../ml-notebooks/07_cost_modeling.py) | `nb-07-cost-modeling.json` |
| 08 | [Recsys: content, CF, MMR](../ml-notebooks/08_recsys_content_cf_mmr.py) | `nb-08-recsys.json` |
| 09 | [Taste profile clustering](../ml-notebooks/09_taste_profile_clustering.py) | `nb-09-taste-clustering.json` |
| 10 | [Narrative DNA extraction eval](../ml-notebooks/10_narrative_dna_eval.py) | `nb-10-narrative-dna.json` |
| 11 | [LangGraph trace analytics](../ml-notebooks/11_langgraph_trace_analytics.py) | `nb-11-trace-analytics.json` |

The `.py` files (jupytext percent format) are the source; the paired `.ipynb` files hold the outputs of the
last full run, and `datasets/evaluation/results/nb-*.json` hold the numbers and findings from that run.

## Key findings (last full run)

**Ingestion and retrieval**

- Parsers keep exact character offsets for every element; no EPUB chunk crosses a chapter boundary (01).
- With fastembed available, `BAAI/bge-small-en-v1.5` reaches nDCG@10 0.288 on label queries vs 0.113 for the
  hash embedder and 0.185 for TF-IDF. The hash embedder is a lexical CI stand-in, not a semantic model (02).
- RRF (k=60) scores 0.320 against 0.380 for the best single list; tuned weighted fusion reaches 0.392 at
  α=0.7. RRF is kept because it needs no per-embedder score calibration and its `k` barely matters (range
  0.041) (03).
- A cross-encoder rerank adds +0.193 nDCG@10 on label queries; it costs roughly 0.5–1 s per query on CPU,
  depending on load. The small QA set is saturated for every reranker (04).

**Answers and citations**

- At the contract threshold 0.45 the citation validator has precision 0.977 and recall 0.838; the 6 golden
  fixtures pass. Same-genre swapped markers fool it 5% of the time, which is why the UI shows the quote (05).
- `grounded_qa` (topK=6) supports 54% of answers with 0% false abstentions and 100% VALID citations, but only
  abstains on 25% of unanswerable questions with the hash embedder: citation validity is not relevance (06).
- Input tokens are 83% of mock-grounded spend, so context size is the main cost lever; caching 90% of input
  cuts DEMO monthly spend by 37% (07).

**Discovery, writer and traces**

- The served hybrid+MMR recommender scores nDCG@10 0.089 vs 0.032 for popularity and 0.052 for NMF; MMR
  trades -0.014 nDCG for +0.060 diversity (08).
- Taste profiles form a continuum (best silhouette 0.107), but the segments are stable (bootstrap ARI 0.85)
  and segment popularity beats global popularity (hit@10 0.297 vs 0.190) (09).
- Narrative DNA continuity rules catch age, eye and hair colour conflicts with precision and recall 1.00 and
  do not flag sentences about another character; the rule-based fact extractor only sees the phrasings it
  encodes (10).
- `generate` is the largest time share; injected failures finish or fail with the documented error codes
  (`PROVIDER_RATE_LIMIT`, `RETRIEVAL_UNAVAILABLE`, PARTIAL on malformed output) (11).

## In the app

**AI Studio → Evaluations** has a *Research notebooks* card. For each notebook it shows the question it answers
and, when the server has a committed full-run result, its date and findings. The API reads
`datasets/evaluation/results/nb-*.json` and returns them from `GET /api/workspaces/:workspaceId/studio/capabilities` as `notebooks`. When
`VITE_REPO_URL` is set, notebook and result paths link to the repository; otherwise they show as paths.

## Running

```bash
python -m uv sync --all-packages --extra dev --extra notebooks
pnpm kaggle:smoke                         # all notebooks in smoke mode (KAGGLE_SMOKE=1), 120 s budget each
node ml-notebooks/run-smoke.mjs --full    # full mode: rewrites the .ipynb outputs and results/nb-*.json
```

CI runs smoke mode in `.github/workflows/kaggle-smoke.yml`. Publishing to Kaggle needs an account and API token
that are not configured, so it is **BLOCKED**; see the [notebooks README](../ml-notebooks/README.md#kaggle) for
running on Kaggle by hand.
