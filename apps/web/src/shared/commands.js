import { create } from 'zustand';
import { SECTIONS } from '@/app/routes.js';

/**
 * @typedef {{ id: string, label: string, group: 'Go to' | 'Actions' | string, to?: string, run?: () => void, keywords?: string[], shortcut?: string[], hint?: string }} Command
 */

/** Navigation commands derived from the route registry. */
export const NAV_COMMANDS = [
  ...SECTIONS.map((s) => ({ id: `go:${s.id}`, label: s.label, group: 'Go to', to: s.to })),
  { id: 'go:search', label: 'Search everywhere', group: 'Go to', to: '/app/search', keywords: ['find', 'documents', 'notes', 'artifacts'] },
  { id: 'go:rec-lab', label: 'Recommendation Lab', group: 'Go to', to: '/app/discover/recommendation-lab' },
  { id: 'go:admin-costs', label: 'Cost administration', group: 'Go to', to: '/app/admin/costs' },
  { id: 'go:admin-pricing', label: 'Model prices', group: 'Go to', to: '/app/admin/pricing' },
  { id: 'go:settings', label: 'Settings', group: 'Go to', to: '/app/settings' },
  { id: 'go:design', label: 'Design system gallery', group: 'Go to', to: '/app/docs/design', keywords: ['components', 'tokens'] },
];

/** Feature modules register contextual commands (e.g. "Upload documents") while mounted. */
export const useCommandRegistry = create((set, get) => ({
  /** @type {Record<string, Command[]>} */
  sources: {},
  /** @param {string} source @param {Command[]} commands */
  register: (source, commands) => {
    set({ sources: { ...get().sources, [source]: commands } });
    return () => {
      const { [source]: _drop, ...rest } = get().sources;
      set({ sources: rest });
    };
  },
}));

/** @param {Command[]} actions shell actions (theme, rail, shortcuts) */
export function allCommands(actions, sources) {
  return [...NAV_COMMANDS, ...actions, ...Object.values(sources).flat()];
}
