/** Conversation tree helpers. Messages form a tree through `parentMessageId`; a branch is a root→leaf path. */

const byTime = (a, b) => a.createdAt.localeCompare(b.createdAt);

/** Messages from the root to `leafId`, oldest first. */
export function pathTo(messages, leafId) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out = [];
  let cur = byId.get(leafId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined;
  }
  return out;
}

/** Messages with no children, oldest first. Each one ends a branch. */
export function leaves(messages) {
  const parents = new Set(messages.map((m) => m.parentMessageId).filter(Boolean));
  return messages.filter((m) => !parents.has(m.id)).sort(byTime);
}

/** The most recent branch end, or undefined for an empty thread. */
export function latestLeaf(messages) {
  return leaves(messages).at(-1)?.id;
}

/**
 * Branch list for the branch switcher: label is the last question on the branch, depth is how many
 * earlier forks the branch passes through.
 */
export function branches(messages) {
  const children = new Map();
  for (const m of messages) {
    const k = m.parentMessageId ?? 'root';
    children.set(k, [...(children.get(k) ?? []), m]);
  }
  return leaves(messages).map((leaf) => {
    const path = pathTo(messages, leaf.id);
    const question = [...path].reverse().find((m) => m.role === 'USER');
    const forks = path.filter((m) => (children.get(m.parentMessageId ?? 'root')?.length ?? 0) > 1).length;
    return { leafId: leaf.id, label: question?.content ?? 'Conversation', status: leaf.role === 'ASSISTANT' ? leaf.status : 'PENDING', depth: forks };
  });
}

/** Message status → outcome vocabulary for badges. */
export function messageOutcome(m, citations = m.citations ?? []) {
  if (m.status === 'ABSTAINED') return 'ABSTAINED';
  if (m.status === 'FAILED') return null;
  if (m.status !== 'COMPLETE') return null;
  const states = citations.map((c) => c.state);
  if (!states.length || states.includes('UNRESOLVED') || states.every((s) => s === 'WEAK')) return 'PARTIAL';
  return 'ANSWERED';
}

/**
 * Client-side mirror of the API preflight estimate (question tokens + 3500 context, max output).
 * Returns null when the model has no admin-entered price.
 * @param {{ price?: { inputPerMTok: string, outputPerMTok: string, isDemo?: boolean } | null, maxOutputTokens?: number } | undefined} model
 * @param {string} question
 */
export function preflightEstimate(model, question) {
  if (!model?.price) return null;
  const input = Math.ceil((question?.length ?? 0) / 4) + 3500;
  const output = model.maxOutputTokens ?? 800;
  const amount = (input * Number(model.price.inputPerMTok) + output * Number(model.price.outputPerMTok)) / 1e6;
  return { amount, isDemo: Boolean(model.price.isDemo) };
}
