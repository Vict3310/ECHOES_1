import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { Nav, usesSiteRail } from './layout';

function renderNav(path = '/discover'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
    </MemoryRouter>,
  );
}

/** The rail is hidden by CSS below `md`, which jsdom does not evaluate. */
function rail(): HTMLElement {
  const element = document.getElementById('site-rail');
  if (!element) throw new Error('the site rail is not rendered');
  return element;
}

/**
 * This jsdom environment has no `localStorage` — the app copes by treating a
 * missing store as “signed out” and “expanded”, so anything stored needs a real
 * one here.
 */
function withStorage(entries: Record<string, string> = {}): void {
  const store = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

function signIn(name: string, email: string): void {
  withStorage({
    echoes_session: JSON.stringify({
      user: { id: 'u1', email, name, role: 'traveler' },
      token: 'test-token',
    }),
  });
}

beforeEach(() => {
  // Pages fetch on mount; the navigation and footer do not depend on the results.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network is disabled in tests');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'localStorage');
  // `document` is shared across the file, and the rail records its width there.
  delete document.documentElement.dataset.rail;
});

describe('where the rail belongs', () => {
  it('treats the landing page and the console as rail-free', () => {
    expect(usesSiteRail('/')).toBe(false);
    expect(usesSiteRail('/discover')).toBe(true);
    expect(usesSiteRail('/places/makoko')).toBe(true);
    // The console brings its own sidebar, so the site rail stands down there.
    expect(usesSiteRail('/admin')).toBe(false);
  });

  it('is on screen from the md breakpoint up, with no trigger to open it', () => {
    renderNav('/discover');

    expect(rail().className).toContain('hidden');
    expect(rail().className).toContain('md:flex');
    // Persistent means persistent: nothing toggles it, so no trigger claims it.
    expect(screen.queryByRole('button', { name: /open menu/i })).toHaveAttribute(
      'aria-controls',
      'mobile-nav',
    );
  });

  it('covers the destinations on every route that has it', () => {
    renderNav('/discover');

    const menu = within(rail());
    for (const label of ['Discover', 'Experiences', 'Guides', 'Assistant', 'Contribute', 'Plan']) {
      expect(menu.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(menu.getByRole('link', { name: 'Moderation' })).toBeInTheDocument();
  });

  it('ends with a personal note rather than a list of links', () => {
    renderNav('/discover');

    const footer = within(rail());
    expect(footer.getByText(/sign in to keep your trips/i)).toBeInTheDocument();
    expect(footer.queryByRole('link', { name: 'Privacy' })).toBeNull();
    expect(footer.queryByText(/© 2026/i)).toBeNull();
  });

  it('collapses to icons, and remembers the choice', () => {
    withStorage();
    renderNav('/discover');

    expect(rail().dataset.collapsed).toBe('false');
    expect(document.documentElement.dataset.rail).toBe('expanded');

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));

    expect(rail().dataset.collapsed).toBe('true');
    // The width lives in a CSS variable, so the header and page follow along.
    expect(document.documentElement.dataset.rail).toBe('collapsed');
    expect(window.localStorage.getItem('echoes_rail_collapsed')).toBe('1');
    // Expanded again by the same control.
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
  });

  it('keeps every label reachable while collapsed, for the hover popups', () => {
    renderNav('/discover');
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));

    const sidebar = within(rail());
    // Collapsed, the label is carried by the hover popup inside the link.
    for (const label of ['Discover', 'Experiences', 'Guides', 'Assistant', 'Contribute', 'Plan']) {
      expect(sidebar.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(sidebar.getByRole('link', { name: /^ECHOES home$/i })).toBeInTheDocument();
  });

  it('reopens collapsed when that is what was stored', () => {
    withStorage({ echoes_rail_collapsed: '1' });
    renderNav('/discover');

    expect(rail().dataset.collapsed).toBe('true');
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
  });

  it('shows who is signed in, and signs out from the footer rather than the links', () => {
    signIn('Ada Obi', 'ada@example.com');
    renderNav('/discover');

    const sidebar = within(rail());
    expect(sidebar.getByText('Ada Obi')).toBeInTheDocument();
    expect(sidebar.getByText('ada@example.com')).toBeInTheDocument();

    // Sign-out is a button in the footer, and not part of the link list.
    const signOut = sidebar.getByRole('button', { name: /sign out/i });
    expect(sidebar.queryByRole('link', { name: /sign out/i })).toBeNull();

    fireEvent.click(signOut);

    expect(window.localStorage.getItem('echoes_session')).toBeNull();
    // Signing out lands on the landing page, which has no rail.
    expect(document.getElementById('site-rail')).toBeNull();
  });

  it('is absent from the landing page, where the header popup menu takes over', () => {
    renderNav('/');

    expect(document.getElementById('site-rail')).toBeNull();

    // With no rail here, the menu must not disappear at desktop widths, and it
    // has to open as a popup rather than a sidebar.
    const trigger = screen.getByRole('button', { name: /open menu/i });
    expect(trigger.className).not.toContain('md:hidden');
    expect(trigger.className).not.toContain('lg:hidden');

    fireEvent.click(trigger);
    const menu = within(document.getElementById('mobile-nav') as HTMLElement);
    for (const label of ['Discover', 'Experiences', 'Guides', 'Assistant', 'Contribute', 'Plan']) {
      expect(menu.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('goes away when navigating from an app page back to the landing page', () => {
    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Nav />
      </MemoryRouter>,
    );
    expect(document.getElementById('site-rail')).not.toBeNull();

    fireEvent.click(within(rail()).getByRole('link', { name: 'ECHOES home' }));

    expect(document.getElementById('site-rail')).toBeNull();
  });
});

describe('the phone menu', () => {
  it('is the header trigger, and is hidden once the rail takes over', () => {
    renderNav('/discover');

    const trigger = screen.getByRole('button', { name: /open menu/i });
    expect(trigger.className).toContain('md:hidden');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the dropdown and closes it on Escape', () => {
    renderNav('/discover');

    const trigger = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const dropdown = document.getElementById('mobile-nav');
    expect(dropdown).not.toBeNull();
    // A panel under the trigger, not a bar across the header.
    expect(dropdown?.className).toContain('w-[280px]');
    expect(dropdown?.className).toContain('right-0');
    const menu = within(dropdown as HTMLElement);
    // Icon and label on one line, never stacked.
    expect(menu.getByRole('link', { name: 'Discover' }).className).toContain('flex');
    expect(menu.getByRole('link', { name: 'Discover' })).toBeInTheDocument();
    // The header hides its account links at this width, so the menu carries them.
    expect(menu.getByRole('link', { name: /sign in or create an account/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The rail is never part of the phone menu's open/closed state.
    expect(document.getElementById('site-rail')).not.toBeNull();
  });

  it('keeps sign-out in the phone menu, which has no footer of its own', () => {
    signIn('Ada Obi', 'ada@example.com');
    renderNav('/discover');

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const menu = within(document.getElementById('mobile-nav') as HTMLElement);
    expect(menu.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('still offers a way into signup from the header', () => {
    renderNav('/');

    expect(screen.getByRole('link', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^join$/i })).toHaveAttribute('href', '/auth?mode=register');
  });
});

describe('the footer', () => {
  it('appears on the home page', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(await screen.findByText(/© 2026 ECHOES/i)).toBeInTheDocument();
    expect(document.querySelector('footer')).not.toBeNull();
  });

  it('is absent from the rest of the app', () => {
    window.history.pushState({}, '', '/discover');
    render(<App />);

    // Asserted on the footer element itself rather than on text that other
    // surfaces may also show.
    expect(document.querySelector('footer')).toBeNull();
    expect(screen.queryByText(/Cultural records cite OpenStreetMap/i)).toBeNull();
  });
});
