import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Nav, usesSiteRail } from './components/layout';
import { ErrorState } from './components/ui';
import Home from './pages/Home';
import Discover from './pages/Discover';
import PlaceDetail from './pages/PlaceDetail';
import Assistant from './pages/Assistant';
import Plan from './pages/Plan';
import Experiences from './pages/Experiences';
import ExperienceDetail from './pages/ExperienceDetail';
import BookingReturn from './pages/BookingReturn';
import Contribute from './pages/Contribute';
import Auth from './pages/Auth';
import Account from './pages/Account';
import Guides from './pages/Guides';
import GuideDetail from './pages/GuideDetail';
import GuideDashboard from './pages/GuideDashboard';
import Admin from './pages/Admin';
import { About, Contact, Privacy, Terms } from './pages/Legal';
import { ForgotPassword, ResetPassword } from './pages/PasswordReset';
import NotFound from './pages/NotFound';
import { attachUnloadFlush, initTracker, setConsent, trackPageView } from './lib/tracker';
import { Cookie } from 'lucide-react';

/**
 * The marketing footer belongs to the landing page only; the rest of the app ends
 * at its own content. `About`, `Contact`, `Privacy` and `Terms` stay reachable
 * from every page through the navigation sidebar.
 */
function HomeFooter() {
  const { pathname } = useLocation();
  if (pathname !== '/') return null;
  return <Footer />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Do not retry client errors; do retry transient provider failures.
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ECHOES interface error', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-32">
          <ErrorState
            error={this.state.error}
            title="This view could not be rendered"
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

/**
 * Starts first-party analytics and reports one page view per route change.
 *
 * Nothing else in the app needs to know how tracking works: the tracker decides
 * for itself whether it is allowed to send anything, based on consent, the
 * browser's do-not-track signal and whether the visitor has withdrawn consent.
 */
function Analytics() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // The tracker queues anything that happens before its configuration lands,
    // so the first page view is not lost when the config request is slow.
    void initTracker();
    return attachUnloadFlush();
    // Deliberately once per page load: re-initialising would duplicate timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname, search]);

  return null;
}

/**
 * Consent is asked once, in a single unmissable line, and declining is as easy as
 * accepting. It is only shown when the API says consent is required.
 */
function ConsentNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void initTracker().then((state) => setVisible(state === 'pending_consent'));
  }, []);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed bottom-4 left-1/2 z-[80] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-black/10 bg-cream/95 p-4 shadow-2xl backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Cookie className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden="true" />
        <p className="min-w-[14rem] flex-1 text-xs leading-relaxed text-black/65">
          ECHOES collects its own anonymous usage statistics to understand which places people are looking for. No
          third-party trackers, no message contents, no precise location.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setConsent(false);
              setVisible(false);
            }}
          >
            Decline
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setConsent(true);
              setVisible(false);
            }}
          >
            Allow statistics
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-black/40">
        Declining leaves the site fully usable. Withdrawing consent later deletes the events already collected for this
        browser.
      </p>
    </div>
  );
}

/** Announces route changes to assistive technology. */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  return (
    <p aria-live="polite" className="sr-only">
      Navigated to {pathname}
    </p>
  );
}

/**
 * The pages that sit behind the rail. The landing page does not use the rail, so
 * it is not padded either — it keeps its full-bleed layout and the footer stays
 * edge to edge. The rail itself is fixed, so this offset is all it needs.
 */
function PageShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div
      className={
        usesSiteRail(pathname) ? 'transition-[padding-left] duration-300 md:pl-[var(--rail-w)]' : undefined
      }
    >
      <main id="main" className="pt-8 sm:pt-10">
        {children}
      </main>
      <HomeFooter />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ScrollToTop />
        <RouteAnnouncer />
        <Analytics />
        <ConsentNotice />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-brand-deep focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <Nav />
        <PageShell>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/places/:id" element={<PlaceDetail />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/experiences" element={<Experiences />} />
              {/* ALATPay's callback URL lands here. Declared before :id so it wins. */}
              <Route path="/experiences/booking/return" element={<BookingReturn />} />
              <Route path="/experiences/:id" element={<ExperienceDetail />} />
              <Route path="/contribute" element={<Contribute />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/account" element={<Account />} />
              <Route path="/guides" element={<Guides />} />
              <Route path="/guides/:id" element={<GuideDetail />} />
              <Route path="/guide-dashboard" element={<GuideDashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </PageShell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
