---
title: RAG pipeline
description: How documents become searchable chunks and how a question becomes a cited, validated answer.
section: AI/ML
order: 1
gates: [3, 4]
blocked: [OpenAI API key]
demo: Without OPENAI_API_KEY the generate step uses the deterministic mock model, which quotes retrieved passages verbatim.
---

FolioVerse answers from your documents only, cites the exact passage behind each claim and checks every
citation before showing it.

## Ingestion

Uploading a file creates an immutable source **version**. The worker queues an ingestion job that walks the states
`UPLOADED → SCANNING → PREVIEW_READY → PARSING → INDEXING → READY` (or `PARTIAL` when some pages fail, `FAILED` or
`QUARANTINED` otherwise).

1. **Parse** (`ingestion/parsers.py`): PDF, DOCX, EPUB, Markdown and plain text become a normalized element list.
   Each element keeps a locator: page number and page-relative character offsets, an optional bounding box for
   PDF, the heading path, and for EPUB the chapter href and an element CFI.
2. **Chunk** (`ingestion/chunking.py`): parents of about 1,200 tokens give the model coherent context; children of
   about 300 tokens with 15% overlap are what gets embedded and retrieved. Chunk ids are deterministic, so
   re-ingesting a version is idempotent. EPUB chunks never cross a chapter boundary.
3. **Embed and index**: each child gets a dense vector (`BAAI/bge-small-en-v1.5` via fastembed, or the
   deterministic hash embedder in tests) and a BM25 sparse vector (`Qdrant/bm25`), stored in Qdrant with the
   workspace and source version as payload filters.

## Retrieval

`retrieval/retrieve.py` runs for every grounded question:

1. Dense and sparse searches run separately, each filtered by the **signed scope token** (workspace plus the
   allowed source versions). Request fields never widen the filter.
2. The two lists are fused with reciprocal rank fusion:

```text
score_rrf(d) = Σ_r 1 / (k + rank_r(d)),   k = 60
```

3. An optional cross-encoder reranker (`FV_RERANK=true`, `Xenova/ms-marco-MiniLM-L-6-v2`) reorders the pool.
4. The top `FV_TOP_K` (6) children are packed under the context budget (`FV_CONTEXT_BUDGET_TOKENS`, 3,500),
   preferring each child's parent when it fits.
5. If nothing relevant is found (low dense score and low lexical overlap), the graph **abstains**: no model call,
   zero cost, and the answer says the documents do not cover the question.

Every candidate keeps its dense, sparse, fused and rerank ranks and a note (`packed-parent`, `packed-child`,
`over-budget`, `below-top-k`…), which AI Studio's RAG X-Ray shows per run.

## Generation and validation

The model receives the packed passages labelled `[S1]`, `[S2]`… and must cite them. After generation,
`citations.py` checks each marker deterministically: unknown markers are UNRESOLVED; otherwise the claim before
the marker is scored by content-word containment in the cited passage, and a score of at least 0.45 is VALID,
below that WEAK. No model is involved, so validation is free and reproducible.

Validation proves that the quoted passage exists and supports the wording of the claim. It does not prove the
claim is true or relevant, which is why the UI always shows the supporting quote. The research notebooks measure
the validator: precision 0.977 and recall 0.838 at the 0.45 threshold on synthetic paraphrases
([Research notebooks](../notebooks.md)).

## Measuring it

- AI Studio → Evaluations runs the golden datasets (`datasets/evaluation`) through the real graph and reports
  faithfulness, retrieval recall, answer accuracy, abstention accuracy and cost per answer.
- Notebooks 02–06 compare embedders, fusion methods, reranking and the end-to-end harness.
