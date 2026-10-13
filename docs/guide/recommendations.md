---
title: Recommendation ML
description: The hybrid recommender behind Discover, its explanations and how it is evaluated offline.
section: AI/ML
order: 3
gates: [7]
blocked: [OpenAI API key]
demo: The catalog, users and interactions are synthetic DEMO data (datasets/synthetic/catalog); natural-language explanations use the mock model without a provider key.
---

Discover is powered by `packages/folioverse-ml`, a small, explainable recommender that the AI service serves and
the research notebooks evaluate.

## Pipeline

```text
candidates (semantic, TF-IDF, theme, collaborative) → linear hybrid score → MMR diversification → explanations
```

1. **Candidate retrieval** pulls up to 120 semantic, 80 TF-IDF, 64 theme and 40 collaborative candidates.
2. **Hybrid score** for each candidate:

```text
s(i) = w_sem·semantic + w_tfidf·tfidf + w_theme·theme + w_pref·preference + w_prior·prior − dislike penalty
```

   Default weights are 0.35 / 0.20 / 0.20 / 0.20 / 0.05. Weights are clipped, normalised to sum to 1, and the
   quality prior is capped at 0.10 so popularity never dominates.
3. **MMR diversification** (λ = 0.7) trades a little relevance for variety, with at most two items per creator or
   franchise and a balance of books and films.
4. **Explanations**: every factor value and weight is returned per item, so "why this" is the exact decomposition of
   the score, plus the themes the item shares with your taste. The optional `rec_explain` graph turns those
   signals into a sentence.

Features are TF-IDF and LSA embeddings over titles and descriptions, a shared theme taxonomy and NMF item factors
from implicit feedback (saves, likes, clicks) with NNLS fold-in for new users. Model artifacts are a JSON manifest
plus a NumPy `.npz` file: no pickles.

## Cold start and feedback

New users pick genres, moods, themes and a few seed titles; until they have interactions, candidates come from
those choices and the catalog prior. Every recommendation set is logged (`rec.recommendation_sets`) with its model
version, weights and latency, and impressions, clicks, saves, dislikes and dismissals are recorded as interactions.
Saving a book from Discover puts it on the Library shelf.

## Recommendation Lab

`/app/discover/recommendation-lab` re-ranks the same query with your own weights and λ as a LAB set, so you can see
how each factor moves the list without changing what Discover serves.

## Offline evaluation

`folioverse_ml.evaluate` scores variants on a held-out split: popularity, NMF collaborative filtering, the hybrid
without diversification and the served hybrid + MMR, reporting precision, recall and nDCG at K, catalog coverage,
intra-list diversity and novelty. The worker runs it on request from the Lab, and notebooks 08 and 09 explore it further: on the synthetic
catalog the served model reaches nDCG@10 0.089 against 0.032 for popularity ([Research notebooks](../notebooks.md)).
