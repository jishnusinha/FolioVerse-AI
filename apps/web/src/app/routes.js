/**
 * Route registry (Prompt 3 Part D / design-prototype ROUTES). Plain data so the router, navigation rail,
 * breadcrumbs and command palette share one source. `gate` marks where the real page lands.
 */

export const SECTIONS = /** @type {const} */ ([
  { id: 'home', label: 'Home', to: '/app', icon: 'house' },
  { id: 'knowledge', label: 'Folio Knowledge', to: '/app/knowledge', icon: 'library-big' },
  { id: 'writer', label: 'Folio Writer', to: '/app/writer', icon: 'feather' },
  { id: 'library', label: 'Library', to: '/app/library', icon: 'book-open' },
  { id: 'discover', label: 'Discover', to: '/app/discover', icon: 'compass' },
  { id: 'studio', label: 'AI Developer Studio', to: '/app/studio', icon: 'flask-conical' },
  { id: 'costs', label: 'Cost Center', to: '/app/costs', icon: 'receipt' },
  { id: 'docs', label: 'Documentation', to: '/app/docs', icon: 'book-marked' },
]);

/**
 * @typedef {object} RouteDef
 * @property {string} id
 * @property {string} path
 * @property {string} title
 * @property {string} section
 * @property {number} gate
 * @property {boolean} [public]
 * @property {boolean} [forceDark]
 */

/** @type {RouteDef[]} */
export const PUBLIC_ROUTES = [
  { id: 'login', path: '/auth/login', title: 'Sign in', section: 'auth', gate: 2, public: true },
  { id: 'register', path: '/auth/register', title: 'Create account', section: 'auth', gate: 2, public: true },
  { id: 'forgot', path: '/auth/forgot-password', title: 'Forgot password', section: 'auth', gate: 2, public: true },
  { id: 'reset', path: '/reset-password', title: 'Reset password', section: 'auth', gate: 2, public: true },
  { id: 'verify', path: '/verify-email', title: 'Verify email', section: 'auth', gate: 2, public: true },
  { id: 'onboarding', path: '/onboarding', title: 'Welcome to FolioVerse', section: 'auth', gate: 2, public: true },
];

/** @type {RouteDef[]} */
export const APP_ROUTES = [
  { id: 'home', path: '/app', title: 'Home', section: 'home', gate: 3 },
  { id: 'knowledge', path: '/app/knowledge', title: 'Folio Knowledge', section: 'knowledge', gate: 2 },
  { id: 'project', path: '/app/knowledge/projects/:projectId', title: 'Project', section: 'knowledge', gate: 2 },
  {
    id: 'document',
    path: '/app/knowledge/projects/:projectId/documents/:sourceId',
    title: 'Document workspace',
    section: 'knowledge',
    gate: 3,
  },
  { id: 'writer', path: '/app/writer', title: 'Folio Writer', section: 'writer', gate: 5 },
  { id: 'manuscript', path: '/app/writer/manuscripts/:manuscriptId', title: 'Manuscript', section: 'writer', gate: 5 },
  { id: 'dna', path: '/app/writer/manuscripts/:manuscriptId/dna', title: 'Narrative DNA', section: 'writer', gate: 5 },
  {
    id: 'continuity',
    path: '/app/writer/manuscripts/:manuscriptId/continuity',
    title: 'Continuity',
    section: 'writer',
    gate: 5,
  },
  { id: 'library', path: '/app/library', title: 'Library', section: 'library', gate: 6 },
  { id: 'reader', path: '/app/library/books/:itemId/read', title: 'Reader', section: 'library', gate: 6 },
  { id: 'discover', path: '/app/discover', title: 'Discover', section: 'discover', gate: 7 },
  { id: 'rec-lab', path: '/app/discover/recommendation-lab', title: 'Recommendation Lab', section: 'discover', gate: 7 },
  { id: 'studio', path: '/app/studio', title: 'AI Developer Studio', section: 'studio', gate: 3, forceDark: true },
  { id: 'studio-run', path: '/app/studio/runs/:runId', title: 'Run', section: 'studio', gate: 3, forceDark: true },
  { id: 'costs', path: '/app/costs', title: 'Cost Center', section: 'costs', gate: 3 },
  { id: 'admin-costs', path: '/app/admin/costs', title: 'Cost administration', section: 'admin', gate: 9 },
  { id: 'admin-pricing', path: '/app/admin/pricing', title: 'Model prices', section: 'admin', gate: 9 },
  { id: 'admin-models', path: '/app/admin/models', title: 'Model registry', section: 'admin', gate: 9 },
  { id: 'docs', path: '/app/docs', title: 'Documentation', section: 'docs', gate: 12 },
  { id: 'docs-design', path: '/app/docs/design', title: 'Component gallery', section: 'docs', gate: 1 },
  { id: 'docs-page', path: '/app/docs/:slug', title: 'Documentation', section: 'docs', gate: 12 },
  { id: 'settings', path: '/app/settings', title: 'Settings', section: 'settings', gate: 1 },
  { id: 'settings-section', path: '/app/settings/:section', title: 'Settings', section: 'settings', gate: 1 },
];

export const ALL_ROUTES = [...PUBLIC_ROUTES, ...APP_ROUTES];

/** @param {string} id */
export function routeById(id) {
  return ALL_ROUTES.find((r) => r.id === id);
}

/**
 * Fill `:params` in a route path.
 * @param {string} id
 * @param {Record<string, string>} [params]
 */
export function hrefFor(id, params = {}) {
  const r = routeById(id);
  if (!r) throw new Error(`Unknown route ${id}`);
  return r.path.replace(/:(\w+)/g, (_, k) => {
    if (params[k] == null) throw new Error(`Missing param ${k} for route ${id}`);
    return encodeURIComponent(params[k]);
  });
}
