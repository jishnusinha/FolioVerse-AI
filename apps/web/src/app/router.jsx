import { useEffect } from 'react';
import { Navigate, Outlet, useMatches } from 'react-router';
import { APP_ROUTES, PUBLIC_ROUTES } from './routes.js';
import { AppShell, useApplyTheme } from './AppShell.jsx';
import { NotFoundPage, PlaceholderPage } from './PlaceholderPage.jsx';
import { DesignGalleryPage } from '@/features/design/DesignGalleryPage.jsx';
import { SettingsPage } from '@/features/settings/SettingsPage.jsx';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/AuthPages.jsx';
import { OnboardingPage } from '@/features/auth/OnboardingPage.jsx';
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage.jsx';
import { KnowledgeHomePage } from '@/features/knowledge/KnowledgeHomePage.jsx';
import { ProjectPage } from '@/features/knowledge/ProjectPage.jsx';
import { TrashPage } from '@/features/knowledge/TrashPage.jsx';
import { DocumentPage } from '@/features/documents/DocumentPage.jsx';
import { ArtifactPage } from '@/features/insights/ArtifactPage.jsx';
import { SearchPage } from '@/features/insights/SearchPage.jsx';
import { HomePage } from '@/features/home/HomePage.jsx';
import { StudioPage } from '@/features/studio/StudioPage.jsx';
import { CostsPage } from '@/features/costs/CostsPage.jsx';
import { WriterHomePage } from '@/features/writer/WriterHomePage.jsx';
import { ManuscriptPage } from '@/features/writer/ManuscriptPage.jsx';
import { DnaPage } from '@/features/writer/DnaPage.jsx';
import { ContinuityPage } from '@/features/writer/ContinuityPage.jsx';
import { PrintPage } from '@/features/writer/PrintPage.jsx';
import { LibraryPage } from '@/features/library/LibraryPage.jsx';
import { ReaderPage } from '@/features/reader/ReaderPage.jsx';
import { DiscoverPage } from '@/features/discover/DiscoverPage.jsx';
import { LabPage } from '@/features/discover/LabPage.jsx';
import { Toaster } from '@/shared/ui/toast.jsx';

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
  costs: CostsPage,
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
  'docs-design': DesignGalleryPage,
  settings: SettingsPage,
  'settings-section': SettingsPage,
};

function element(route) {
  const Page = PAGES[route.id];
  return Page ? <Page /> : <PlaceholderPage route={route} />;
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
