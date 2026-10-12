import { useEffect, useState } from 'react';

export const SEARCH_GROUPS = [
  ['project', 'Projects'],
  ['source', 'Documents'],
  ['passage', 'Passages'],
  ['artifact', 'Artifacts'],
  ['note', 'Notes'],
  ['thread', 'Conversations'],
];

/** Where a search result opens. */
export function searchHref(item) {
  const project = `/app/knowledge/projects/${item.projectId}`;
  if (item.type === 'project') return project;
  if (item.type === 'artifact') return `${project}/artifacts/${item.id}`;
  if (item.sourceId) return `${project}/documents/${item.sourceId}`;
  return project;
}

/** @template T @param {T} value @param {number} ms @returns {T} */
export function useDebouncedValue(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
