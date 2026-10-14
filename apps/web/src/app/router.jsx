import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Outlet, useMatches } from 'react-router';
import { APP_ROUTES, PUBLIC_ROUTES } from './routes.js';
import { AppShell, useApplyTheme } from './AppShell.jsx';
import { NotFoundPage, PlaceholderPage } from './PlaceholderPage.jsx';
import { Skeleton } from '@/shared/ui/index.js';
import { Toaster } from '@/shared/ui/toast.jsx';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/AuthPages.jsx';
import { OnboardingPage } from '@/features/auth/OnboardingPage.jsx';
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage.jsx';
import { HomePage } from '@/features/home/HomePage.jsx';

// Lazy-loaded route components for fast initial bundle loading
const KnowledgeHomePage = lazy(() => import('@/features/knowledge/KnowledgeHomePage.jsx').then((m) => ({ default: m.KnowledgeHomePage })));
const ProjectPage = lazy(() => import('@/features/knowledge/ProjectPage.jsx').then((m) => ({ default: m.ProjectPage })));
const TrashPage = lazy(() => import('@/features/knowledge/TrashPage.jsx').then((m) => ({ default: m.TrashPage })));
const DocumentPage = lazy(() => import('@/features/documents/DocumentPage.jsx').then((m) => ({ default: m.DocumentPage })));
const ArtifactPage = lazy(() => import('@/features/insights/ArtifactPage.jsx').then((m) => ({ default: m.ArtifactPage })));
const SearchPage = lazy(() => import('@/features/insights/SearchPage.jsx').then((m) => ({ default: m.SearchPage })));
const StudioPage = lazy(() => import('@/features/studio/StudioPage.jsx').then((m) => ({ default: m.StudioPage })));
const ComparePage = lazy(() => import('@/features/studio/ComparePage.jsx').then((m) => ({ default: m.ComparePage })));
const PlaygroundPage = lazy(() => import('@/features/studio/PlaygroundPage.jsx').then((m) => ({ default: m.PlaygroundPage })));
const BattlesPage = lazy(() => import('@/features/studio/BattlesPage.jsx').then((m) => ({ default: m.BattlesPage })));
const BattlePage = lazy(() => import('@/features/studio/BattlesPage.jsx').then((m) => ({ default: m.BattlePage })));
const EvaluationsPage = lazy(() => import('@/features/studio/EvaluationsPage.jsx').then((m) => ({ default: m.EvaluationsPage })));
const CostsPage = lazy(() => import('@/features/costs/CostsPage.jsx').then((m) => ({ default: m.CostsPage })));
const AdminCostsPage = lazy(() => import('@/features/admin/AdminCostsPage.jsx').then((m) => ({ default: m.AdminCostsPage })));
const AdminPricingPage = lazy(() => import('@/features/admin/AdminPricingPage.jsx').then((m) => ({ default: m.AdminPricingPage })));
const AdminModelsPage = lazy(() => import('@/features/admin/AdminModelsPage.jsx').then((m) => ({ default: m.AdminModelsPage })));
const WriterHomePage = lazy(() => import('@/features/writer/WriterHomePage.jsx').then((m) => ({ default: m.WriterHomePage })));
const ManuscriptPage = lazy(() => import('@/features/writer/ManuscriptPage.jsx').then((m) => ({ default: m.ManuscriptPage })));
const DnaPage = lazy(() => import('@/features/writer/DnaPage.jsx').then((m) => ({ default: m.DnaPage })));
const ContinuityPage = lazy(() => import('@/features/writer/ContinuityPage.jsx').then((m) => ({ default: m.ContinuityPage })));
const PrintPage = lazy(() => import('@/features/writer/PrintPage.jsx').then((m) => ({ default: m.PrintPage })));
const LibraryPage = lazy(() => import('@/features/library/LibraryPage.jsx').then((m) => ({ default: m.LibraryPage })));
const ReaderPage = lazy(() => import('@/features/reader/ReaderPage.jsx').then((m) => ({ default: m.ReaderPage })));
const DiscoverPage = lazy(() => import('@/features/discover/DiscoverPage.jsx').then((m) => ({ default: m.DiscoverPage })));
const LabPage = lazy(() => import('@/features/discover/LabPage.jsx').then((m) => ({ default: m.LabPage })));
const DocsPage = lazy(() => import('@/features/docs/DocsPage.jsx').then((m) => ({ default: m.DocsPage })));
const DesignGalleryPage = lazy(() => import('@/features/design/DesignGalleryPage.jsx').then((m) => ({ default: m.DesignGalleryPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage.jsx').then((m) => ({ default: m.SettingsPage })));

/** Page components that have replaced placeholders, keyed by route id. */
const PAGES = {
  login: LoginPage,
  register: RegisterPage,
  forgot: ForgotPasswordPage,
  reset: ResetPasswordPage,
  verify: VerifyEmailPage,
  onboarding: OnboardingPage,
  'accept-invite': AcceptInvitePage,
  home: HomePage,
  knowledge: KnowledgeHomePage,
  document: DocumentPage,
  artifact: ArtifactPage,
  search: SearchPage,
  studio: StudioPage,
  'studio-run': StudioPage,
  'studio-compare': ComparePage,
  'studio-playground': PlaygroundPage,
  'studio-battles': BattlesPage,
  'studio-battle': BattlePage,
  'studio-evaluations': EvaluationsPage,
  costs: CostsPage,
  'admin-costs': AdminCostsPage,
  'admin-pricing': AdminPricingPage,
  'admin-models': AdminModelsPage,
  writer: WriterHomePage,
  manuscript: ManuscriptPage,
  dna: DnaPage,
  continuity: ContinuityPage,
  'manuscript-print': PrintPage,
  library: LibraryPage,
  reader: ReaderPage,
  discover: DiscoverPage,
  'rec-lab': LabPage,
  project: ProjectPage,
  trash: TrashPage,
  docs: DocsPage,
  'docs-page': DocsPage,
  'docs-design': DesignGalleryPage,
  settings: SettingsPage,
  'settings-section': SettingsPage,
};

function PageLoader() {
  return (
    <div className="page" style={{ padding: 24, maxWidth: 900 }}>
      <Skeleton height={32} width={220} style={{ marginBottom: 16 }} />
      <Skeleton height={180} />
    </div>
  );
}

function element(route) {
  const Page = PAGES[route.id];
  return Page ? (
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  ) : (
    <PlaceholderPage route={route} />
  );
}

function PublicLayout() {
  useApplyTheme();
  const route = useMatches().at(-1)?.handle?.route;
  useEffect(() => {
    document.title = `${route?.title ?? 'FolioVerse'} · FolioVerse`;
  }, [route]);
  return (
    <>
      <main id="main" tabIndex={-1} style={{ height: '100%' }}>
        <Outlet />
      </main>
      <Toaster />
    </>
  );
}

/** Route objects for `createBrowserRouter` / `createMemoryRouter`. */
export const routeObjects = [
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/auth', element: <Navigate to="/auth/login" replace /> },
  {
    element: <PublicLayout />,
    children: PUBLIC_ROUTES.map((r) => ({ path: r.path, element: element(r), handle: { route: r } })),
  },
  {
    element: <AppShell />,
    children: [
      ...APP_ROUTES.map((r) => ({ path: r.path, element: element(r), handle: { route: r } })),
      { path: '/app/*', element: <NotFoundPage />, handle: { route: { title: 'Not found' } } },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
