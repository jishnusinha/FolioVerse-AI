import type { ArtifactKind } from '@prisma/client';

export interface InsightAction {
  id: string;
  label: string;
  graph: 'insight' | 'risk_contradiction' | 'multi_doc_compare' | 'knowledge_map';
  tier: 'T0' | 'T1' | 'T2';
  kind: ArtifactKind;
  group: string;
  minSources: number;
}

/** Must equal packages/contracts/fixtures/insight-actions.json (checked by test/unit/insight-actions.spec.ts). */
export const INSIGHT_ACTIONS: InsightAction[] = [
  { id: 'quick_summary', label: 'Quick Summary', graph: 'insight', tier: 'T0', kind: 'SUMMARY', group: 'Summaries', minSources: 1 },
  { id: 'executive_summary', label: 'Executive Summary', graph: 'insight', tier: 'T0', kind: 'SUMMARY', group: 'Summaries', minSources: 1 },
  { id: 'detailed_breakdown', label: 'Detailed Breakdown', graph: 'insight', tier: 'T0', kind: 'SUMMARY', group: 'Summaries', minSources: 1 },
  { id: 'explain_simply', label: 'Explain Simply', graph: 'insight', tier: 'T0', kind: 'SUMMARY', group: 'Summaries', minSources: 1 },
  { id: 'key_facts', label: 'Extract Key Facts', graph: 'insight', tier: 'T0', kind: 'KEY_FACTS', group: 'Summaries', minSources: 1 },
  { id: 'risks', label: 'Identify Risks', graph: 'risk_contradiction', tier: 'T1', kind: 'RISK_REPORT', group: 'Analysis', minSources: 1 },
  { id: 'contradictions', label: 'Find Contradictions', graph: 'risk_contradiction', tier: 'T1', kind: 'RISK_REPORT', group: 'Analysis', minSources: 1 },
  { id: 'quiz', label: 'Generate Questions', graph: 'insight', tier: 'T1', kind: 'QUIZ', group: 'Study', minSources: 1 },
  { id: 'study_notes', label: 'Create Study Notes', graph: 'insight', tier: 'T1', kind: 'STUDY_NOTES', group: 'Study', minSources: 1 },
  { id: 'flashcards', label: 'Generate Flashcards', graph: 'insight', tier: 'T1', kind: 'FLASHCARDS', group: 'Study', minSources: 1 },
  { id: 'compare', label: 'Compare with Another Document', graph: 'multi_doc_compare', tier: 'T1', kind: 'COMPARISON', group: 'Analysis', minSources: 2 },
  { id: 'extract_tasks', label: 'Extract Tasks', graph: 'insight', tier: 'T0', kind: 'TASKS', group: 'Analysis', minSources: 1 },
  { id: 'research_report', label: 'Generate Research Report', graph: 'insight', tier: 'T1', kind: 'REPORT', group: 'Reports', minSources: 1 },
  { id: 'knowledge_map', label: 'Create Knowledge Map', graph: 'knowledge_map', tier: 'T1', kind: 'KNOWLEDGE_MAP', group: 'Reports', minSources: 1 },
];

export const ACTION_BY_ID = new Map(INSIGHT_ACTIONS.map((a) => [a.id, a]));
export const ARTIFACT_GRAPHS = new Set(INSIGHT_ACTIONS.map((a) => a.graph));

/** The action a run of `graph` performs: the requested one when it belongs to that graph, else the graph's only action. */
export function actionFor(graph: string, requested?: string): InsightAction | null {
  if (requested) {
    const a = ACTION_BY_ID.get(requested);
    return a && a.graph === graph ? a : null;
  }
  const own = INSIGHT_ACTIONS.filter((a) => a.graph === graph);
  if (graph === 'insight') return ACTION_BY_ID.get('quick_summary')!;
  return own[0] ?? null;
}
