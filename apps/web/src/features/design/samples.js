/** DEMO fixtures for the design gallery. Fictional values; nothing here comes from a real run or provider. */

export const SAMPLE_RECEIPT = {
  run: {
    id: 'run_demo_0001',
    graph: 'grounded_qa',
    tier: 'T1',
    status: 'SUCCEEDED',
    outcome: 'ANSWERED',
    isDemo: true,
    durationMs: 4800,
  },
  modelPlan: { primary: { provider: 'mock', model: 'mock-grounded' }, fallbacks: [] },
  modelCalls: [{ provider: 'mock', model: 'mock-grounded', attempt: 1, status: 'SUCCEEDED' }],
  tokens: { input: 6214, cachedInput: 1536, output: 512, reasoning: 0 },
  cost: { total: '0.00910000', estimate: '0.01200000', tier: 'FINALIZED', currency: 'USD', isDemo: true },
  citations: { total: 4, byState: { VALID: 2, WEAK: 1, UNRESOLVED: 1 } },
  traceUrl: '/app/studio/runs/run_demo_0001',
};

export const SAMPLE_CITATIONS = [
  {
    marker: 'S1',
    state: 'VALID',
    anchorState: 'EXACT',
    title: 'Market Outlook 2026.pdf (DEMO)',
    versionNumber: 3,
    currentVersionNumber: 3,
    locator: 'p. 12 · §2.1 Base scenario',
    quote: 'the addressable market for assisted research tools grows at a compound annual rate of 14.2% between 2026 and 2030',
  },
  {
    marker: 'S2',
    state: 'WEAK',
    anchorState: 'FUZZY',
    title: 'Risk Assessment.pdf (DEMO)',
    versionNumber: 2,
    currentVersionNumber: 3,
    locator: 'p. 7 · §1.4 Demand risks',
    quote: 'sustained growth above 12% per year appears unlikely while procurement cycles exceed nine months',
  },
  {
    marker: 'S3',
    state: 'UNRESOLVED',
    anchorState: 'ORPHANED',
    title: 'Research Methods.docx (DEMO)',
    versionNumber: 1,
    currentVersionNumber: 1,
    locator: '§4 Survey weighting',
    quote: 'responses were reweighted to match regional revenue shares',
  },
  { marker: 'S4', state: 'PERMISSION_REVOKED', anchorState: 'ORPHANED', title: 'Partner Memo (restricted)', quote: null },
  { marker: 'S5', state: 'SOURCE_PURGED', anchorState: 'ORPHANED', title: 'Draft Forecast v0.pdf', quote: null },
];

export const SAMPLE_MODELS = [
  { id: 'mock-grounded', label: 'mock-grounded', provider: 'mock', isDemo: true, priced: true },
  { id: 'local-compute', label: 'cpu-embedding', provider: 'local', isDemo: false, priced: false },
];

export const SAMPLE_ROWS = [
  { id: 'd1', name: 'Market Outlook 2026.pdf', type: 'PDF', state: 'READY', pages: 48 },
  { id: 'd2', name: 'Regional Forecast Q3.pdf', type: 'PDF', state: 'INDEXING', pages: 64 },
  { id: 'd3', name: 'Chapter Draft.md', type: 'MD', state: 'PREVIEW_READY', pages: null },
  { id: 'd4', name: 'Interview Notes.docx', type: 'DOCX', state: 'FAILED', pages: null },
];
