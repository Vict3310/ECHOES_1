import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia, which framer-motion reads for
// prefers-reduced-motion.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom does not implement scrolling. The admin console scrolls the new section
// into view, which is a real behaviour worth keeping — it just needs to be a
// no-op here rather than an unhandled error.
// jsdom defines `scrollTo` but throws “not implemented” when it is called, so it
// has to be replaced rather than merely filled in when missing.
window.scrollTo = (() => undefined) as unknown as typeof window.scrollTo;

// jsdom has no IntersectionObserver either, and the `Reveal` sections use
// framer-motion's `whileInView`, which constructs one on mount. Without this the
// whole view throws and tests would be asserting on an error boundary.
if (!window.IntersectionObserver) {
  class Observer implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  window.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
}
