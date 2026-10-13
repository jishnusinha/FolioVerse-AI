# FolioVerse ML notebooks

Eleven evaluation notebooks that exercise the real `folioverse_ai` and `folioverse_ml` code on the synthetic
datasets in `datasets/synthetic` and `datasets/evaluation`. They use the same hermetic setup as the test suite:
in-memory Qdrant, the in-memory repository, the deterministic hash embedder and the DEMO mock model. Nothing
calls a paid provider. Numbers describe relative behaviour on synthetic data, not real-world quality.

Each notebook is a jupytext pair: the `.py` file (percent format) is the source of truth and is what code
review sees; the `.ipynb` holds the outputs of the last full run.

| # | Notebook | Question it answers |
| --- | --- | --- |
| 01 | [Document parsing & chunking](01_document_parsing_chunking.py) | Do parsers keep exact offsets and locators; how do chunk sizes trade off? |
| 02 | [Embedding comparison](02_embedding_comparison.py) | Hash, TF-IDF, LSA (and fastembed in full mode) on label queries |
| 03 | [Hybrid retrieval & RRF](03_hybrid_retrieval_rrf.py) | Dense vs sparse vs RRF; RRF `k` and weighted fusion sweeps |
| 04 | [Reranking ablation](04_reranking_ablation.py) | Lexical and cross-encoder reranking vs RRF only, by rerank depth |
| 05 | [Citation validation metrics](05_citation_validation_metrics.py) | Precision/recall of the citation validator on labelled synthetic answers |
| 06 | [RAG evaluation harness](06_rag_evaluation_harness.py) | `grounded_qa` end to end: support, abstention, citations, tokens, DEMO cost |
| 07 | [Cost modeling & token economics](07_cost_modeling.py) | Pricing parity, context budget vs cost, DEMO spend scenarios |
| 08 | [Recsys: content, CF, MMR](08_recsys_content_cf_mmr.py) | Served offline eval, factor ablation, MMR λ sweep, cold start |
| 09 | [Taste profile clustering](09_taste_profile_clustering.py) | Are there stable taste segments, and are they useful? |
| 10 | [Narrative DNA extraction eval](10_narrative_dna_eval.py) | Entity/fact extraction and continuity rules against known ground truth |
| 11 | [LangGraph trace analytics](11_langgraph_trace_analytics.py) | Steps, latency, tokens per node and failure classes from run events |

Shared helpers live in [`fvnb.py`](fvnb.py). Results are written to
`datasets/evaluation/results/nb-<name>.json` (full runs, committed as references) or `.../results/smoke/`
(smoke runs, git-ignored). The Studio Evaluation tab links to this page and to the committed results.

## Running

```bash
python -m uv sync --all-packages --extra dev --extra notebooks
pnpm kaggle:smoke                                   # all notebooks, KAGGLE_SMOKE=1, 120 s budget each
node ml-notebooks/run-smoke.mjs --only 03           # one notebook
node ml-notebooks/run-smoke.mjs --full              # full mode: rewrites the .ipynb outputs and results/nb-*.json
python -m uv run jupyter lab ml-notebooks           # interactive (install jupyterlab separately)
```

`KAGGLE_SMOKE=1` switches every notebook to tiny samples; CI runs smoke mode in
[`.github/workflows/kaggle-smoke.yml`](../.github/workflows/kaggle-smoke.yml) (manual dispatch and changes to
notebooks or the code they exercise). Full mode tries the fastembed models (notebooks 02–04), which downloads
them on first use; without network access those notebooks fall back to the hash embedder and say so.

## Kaggle

Publishing to Kaggle needs a Kaggle account and API token; none is configured for this project, so Kaggle
publishing is **BLOCKED** (see `docs/planning/IMPLEMENTATION_STATUS.md`). To run there manually:

1. Upload the repository (or `apps/ai-service`, `packages/folioverse-ml`, `datasets`, `config/models` and
   `ml-notebooks`) as a Kaggle dataset.
2. In the notebook: `pip install -r <dataset>/ml-notebooks/requirements.txt <dataset>/packages/folioverse-ml <dataset>/apps/ai-service`.
   The packages declare Python 3.12; on an older image add `--ignore-requires-python` (untested).
3. Set `FV_REPO_ROOT=<dataset path>` and `FV_NOTEBOOK_DIR=<dataset>/ml-notebooks` before the first cell, and
   `KAGGLE_SMOKE=1` for a quick run. Results go to `FV_REPO_ROOT/datasets/evaluation/results`, so copy the
   dataset to `/kaggle/working` first if it is read-only.
