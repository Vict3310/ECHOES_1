import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Nav } from './components/layout';
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
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';

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

/** Announces route changes to assistive technology. */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  return (
    <p aria-live="polite" className="sr-only">
      Navigated to {pathname}
    </p>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <RouteAnnouncer />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-brand-deep focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main">
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
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <Footer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
