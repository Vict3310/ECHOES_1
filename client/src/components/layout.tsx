import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  LogIn,
  LogOut,
  MapPinned,
  Menu,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clearStoredSession, readStoredSession, type StoredSession } from '../lib/auth';

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* -------------------------------------------------------------------------- */
/* Brand mark — the nine-dot grid from the design language                     */
/* -------------------------------------------------------------------------- */

const DOT_PATTERN = ['brand', 'dark', 'light', 'dark', 'light', 'dark', 'light', 'dark', 'brand'] as const;

export function DotMark({ className = '' }: { className?: string }) {
  return (
    <span className={`grid grid-cols-3 gap-[2.5px] ${className}`} aria-hidden="true">
      {DOT_PATTERN.map((tone, index) => (
        <span
          key={index}
          className={`h-1 w-1 rounded-full ${
            tone === 'brand' ? 'bg-brand' : tone === 'dark' ? 'bg-black/70' : 'bg-black/30'
          }`}
        />
      ))}
    </span>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <DotMark />
      <span className="whitespace-nowrap font-display text-sm font-semibold tracking-tight">ECHOES</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Motion primitives                                                           */
/* -------------------------------------------------------------------------- */

export function Reveal({
  children,
  delay = 0,
  className,
  amount = 0.15,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  amount?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 48, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Editorial heading animation: each word resolves in sequence. */
export function WordReveal({
  text,
  className,
  delay = 0,
  as: Tag = 'span',
}: {
  text: string;
  className?: string;
  delay?: number;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
}) {
  const reduced = useReducedMotion();
  if (reduced) return <Tag className={className}>{text}</Tag>;

  const words = text.split(' ');
  const MotionTag = motion[Tag];

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      variants={{ show: { transition: { staggerChildren: 0.045, delayChildren: delay } } }}
    >
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          className="inline-block"
          variants={{
            hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
            show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
          }}
        >
          {word}
          {index < words.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </MotionTag>
  );
}

/** Giant cropped wordmark used behind the hero and above the footer. */
export function GiantWordmark({
  text,
  className = '',
  strokeOnly = false,
}: {
  text: string;
  className?: string;
  strokeOnly?: boolean;
}) {
  return (
    <p
      aria-hidden="true"
      className={`select-none whitespace-nowrap text-center font-display font-light leading-none tracking-tighter ${
        strokeOnly ? 'text-transparent' : 'text-brand-deep/10'
      } ${className}`}
      style={strokeOnly ? { WebkitTextStroke: '1px rgba(30, 77, 51, 0.12)' } : undefined}
    >
      {text}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero atmosphere                                                             */
/* -------------------------------------------------------------------------- */

export function HeroBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="drift-a absolute left-[8%] top-[12%] h-40 w-40 rounded-full border border-white/25 bg-gradient-to-br from-white/30 to-white/5 shadow-[inset_0_0_60px_rgba(255,255,255,0.28)] backdrop-blur-sm sm:h-64 sm:w-64" />
      <div className="drift-b absolute right-[10%] top-[26%] h-28 w-28 rounded-[40%] border border-white/20 bg-gradient-to-tl from-brand/30 to-white/10 shadow-[inset_0_0_40px_rgba(66,168,93,0.32)] backdrop-blur-md sm:h-44 sm:w-44" />
      <div className="drift-c absolute left-[38%] top-[52%] h-20 w-20 rounded-full border border-white/25 bg-gradient-to-b from-white/25 to-transparent backdrop-blur-[2px] sm:h-32 sm:w-32" />
      <div className="drift-b absolute left-[55%] top-[8%] h-14 w-14 rounded-[45%] border border-white/20 bg-white/10 backdrop-blur-sm sm:h-20 sm:w-20" />
      <div className="drift-a absolute bottom-[36%] right-[28%] h-16 w-16 rounded-full border border-white/15 bg-gradient-to-br from-brand/25 to-transparent backdrop-blur-sm sm:h-24 sm:w-24" />
    </div>
  );
}

/** Scroll-linked parallax wrapper. */
export function Parallax({
  children,
  strength = 0.15,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const raw = useTransform(scrollY, (value) => value * strength);
  const y = useSpring(raw, { stiffness: 120, damping: 30, mass: 0.4 });

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

const NAV_LINKS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/experiences', label: 'Experiences', icon: Ticket },
  { to: '/guides', label: 'Guides', icon: Users },
  { to: '/assistant', label: 'Assistant', icon: Sparkles },
  { to: '/contribute', label: 'Contribute', icon: PenLine },
  { to: '/plan', label: 'Plan', icon: MapPinned },
];

/**
 * Which routes the rail belongs to. The landing page is a full-bleed page of its
 * own: no rail, no side padding, and its header keeps the header menu instead.
 */
export function usesSiteRail(pathname: string): boolean {
  // The landing page, auth flows and password reset screens sit in their own
  // full-width presentation rather than the main app rail, and the admin console
  // brings its own sidebar, so two sidebars side by side would be one too many.
  return (
    pathname !== '/' &&
    pathname !== '/auth' &&
    pathname !== '/forgot-password' &&
    pathname !== '/reset-password' &&
    !pathname.startsWith('/admin')
  );
}

/** Whether the reader collapsed the rail. Unreadable storage means “expanded”. */
const RAIL_STATE_KEY = 'echoes_rail_collapsed';

function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STATE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeRailCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STATE_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode); the rail still collapses for
    // this session, it just does not remember the choice.
  }
}

/** One entry in the menu, however that menu is laid out. */
interface MenuEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  onClick?: () => void;
}

/**
 * A label that only exists on the collapsed rail: hovering or focusing the icon
 * reveals the name, so nothing has to be guessed from a glyph.
 */
function RailTip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
      {label}
    </span>
  );
}

/** Menu contents, shared by the phone dropdown and the persistent desktop rail. */
function MenuLinks({
  session,
  onSignOut,
  withSignOut = true,
  inRail = false,
  collapsed = false,
}: {
  session: StoredSession | null;
  onSignOut: () => void;
  /** The rail puts sign-out in its own footer rather than in the link list. */
  withSignOut?: boolean;
  /** The rail lays links out in a column of icons; the phone menu stays a list. */
  inRail?: boolean;
  collapsed?: boolean;
}) {
  const entries: MenuEntry[] = [
    ...NAV_LINKS.map((link) => ({ key: link.to, ...link })),
    ...(session
      ? [
          { key: 'account', to: '/account', label: 'My account', icon: UserRound },
          ...(withSignOut
            ? [{ key: 'signout', label: 'Sign out', icon: LogOut, onClick: onSignOut }]
            : []),
        ]
      : [{ key: 'auth', to: '/auth', label: 'Sign in or create an account', icon: LogIn }]),
    { key: 'admin', to: '/admin', label: 'Moderation', icon: ShieldCheck },
  ];

  const linkClass = (isActive: boolean): string => {
    if (!inRail) {
      // A flex row, not a block: preflight gives `svg` display:block, which would
      // stack the icon above its label.
      return `flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
        isActive ? 'bg-black/5 text-ink' : 'text-black/60 hover:bg-black/5'
      }`;
    }
    if (collapsed) {
      return `group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        isActive ? 'bg-black/10 text-ink' : 'text-black/55 hover:bg-black/5 hover:text-ink'
      }`;
    }
    return `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
      isActive ? 'bg-black/5 text-ink' : 'text-black/60 hover:bg-black/5'
    }`;
  };

  const inner = (entry: MenuEntry) => (
    <>
      <entry.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {collapsed ? <RailTip label={entry.label} /> : <span className="truncate">{entry.label}</span>}
    </>
  );

  return (
    <div className={inRail && collapsed ? 'flex flex-col items-center gap-0.5' : 'contents'}>
      {entries.map((entry) =>
        entry.to ? (
          <NavLink key={entry.key} to={entry.to} className={({ isActive }) => linkClass(isActive)}>
            {inner(entry)}
          </NavLink>
        ) : (
          <button
            key={entry.key}
            type="button"
            onClick={entry.onClick}
            className={`${linkClass(false)} ${inRail ? 'shrink-0' : 'w-full text-left'}`}
          >
            {inner(entry)}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * The persistent rail: on screens from the `md` breakpoint up it is simply
 * always on screen, so there is no trigger to open it and nothing to trap focus
 * in. It can be collapsed to icons, and below `md` it is hidden entirely while
 * the header's phone dropdown takes over.
 */
function SiteRail({
  session,
  onSignOut,
  collapsed,
  onToggle,
}: {
  session: StoredSession | null;
  onSignOut: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const initial = session?.user.name.trim().charAt(0).toUpperCase() || 'E';

  return (
    <aside
      id="site-rail"
      aria-label="Site sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--rail-w)] flex-col border-r border-black/10 bg-[#f5f1ea] transition-[width] duration-300 md:flex"
    >
      <div
        className={`flex items-center border-b border-black/10 ${collapsed ? 'justify-center px-2 py-4' : 'px-5 py-6'}`}
      >
        <Link to="/" className="flex items-center gap-2.5" aria-label="ECHOES home">
          <DotMark />
          {!collapsed && (
            <span className="whitespace-nowrap font-display text-sm font-semibold tracking-tight">ECHOES</span>
          )}
        </Link>
      </div>

      {/*
        The collapse handle rides on the rail's outer edge, halfway down it, so
        it reads as part of the outline rather than as one more menu row.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls="site-rail"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="group absolute -right-3 top-1/2 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-white text-ink/55 shadow-sm transition-colors hover:bg-[#efe7dc] hover:text-ink"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {collapsed && <RailTip label="Expand" />}
      </button>

      {!collapsed && (
        <p className="px-5 pt-5 text-[10px] uppercase tracking-[0.22em] text-black/35">Lagos cultural atlas</p>
      )}

      {/*
        Collapsed, the rail must not be a scroll container: the hover labels are
        positioned outside the rail's box, and any overflow would clip them.
      */}
      <nav
        aria-label="Site"
        className={collapsed ? 'flex-1 overflow-y-visible px-2 py-3' : 'flex-1 overflow-y-auto px-3 py-5'}
      >
        {!collapsed && (
          <p className="px-3 pb-3 text-[10px] uppercase tracking-[0.24em] text-black/35">Explore</p>
        )}
        <MenuLinks session={session} onSignOut={onSignOut} withSignOut={false} inRail collapsed={collapsed} />
      </nav>

      {/*
        The bottom of the rail is about the person, not a second link list.
        Collapsed and signed out there is nothing to say, so it is not rendered.
      */}
      <div
        className={`border-t border-black/10 ${
          collapsed ? 'flex flex-col items-center gap-1.5 px-2 py-3' : 'px-4 py-4'
        } ${!session && collapsed ? 'hidden' : ''}`}
      >
        {session ? (
          collapsed ? (
            <>
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-deep text-sm font-medium text-white"
                title={session.user.name}
              >
                {initial}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="group relative grid h-10 w-10 place-items-center rounded-2xl text-black/55 transition-colors hover:bg-black/5 hover:text-ink"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <RailTip label="Sign out" />
                <span className="sr-only">Sign out</span>
              </button>
            </>
          ) : (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-deep text-sm font-medium text-white"
                  aria-hidden="true"
                >
                  {initial}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{session.user.name}</span>
                  <span className="block truncate text-xs text-black/45">{session.user.email}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-sm text-black/60 transition-colors hover:bg-black/5 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </div>
          )
        ) : (
          !collapsed && (
            <p className="px-1 text-xs leading-relaxed text-black/50">
              Sign in to keep your trips and contributions together.
            </p>
          )
        )}

      </div>
    </aside>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [session, setSession] = useState(() => readStoredSession());
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const location = useLocation();
  const navigate = useNavigate();
  const withRail = usesSiteRail(location.pathname);
  // Where the rail exists it replaces the menu from `md` up. The landing page has
  // no rail, so there the header menu stays at every width — it is the only
  // navigation on that page, and it opens as a popup rather than a sidebar.
  const menuBreakpoint = withRail ? 'md:hidden' : '';
  // The wordmark appears exactly once. The console carries it in its own
  // sidebar, which is the same width from `lg` up, so the header gives it up there
  // rather than showing two brands side by side.
  const isConsole = location.pathname.startsWith('/admin');
  const brandBreakpoint = withRail ? 'md:hidden' : isConsole ? 'lg:hidden' : '';

  // The rail's width is a CSS variable, so the header offset and the page shell
  // follow a collapse without any of them having to know about each other.
  useEffect(() => {
    document.documentElement.dataset.rail = railCollapsed ? 'collapsed' : 'expanded';
    storeRailCollapsed(railCollapsed);
  }, [railCollapsed]);

  // Signing in and out happens on other pages, so the stored session is re-read
  // on every navigation rather than cached for the lifetime of the header.
  useEffect(() => {
    setOpen(false);
    setTerm('');
    setSession(readStoredSession());
  }, [location.pathname]);

  // The phone menu is a dropdown rather than a modal, so nothing is locked
  // behind it: Escape simply closes it for keyboard users.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = term.trim();
    navigate(query ? `/discover?q=${encodeURIComponent(query)}` : '/discover');
  }

  function signOut() {
    clearStoredSession();
    setSession(null);
    setOpen(false);
    navigate('/');
  }

  return (
    <>
      {/*
        The header stays centred over the space the rail leaves behind: from
        `md` up it shifts right by half the rail width (8.25rem) and gives up
        that width plus its own 1.5rem gutter.
      */}
      <nav
        className={`fixed left-1/2 top-4 z-50 w-[calc(100%-1.5rem)] max-w-5xl -translate-x-1/2 sm:top-7 ${
          withRail
            ? 'md:left-[calc(50%_+_(var(--rail-w)/2))] md:w-[calc(100%_-_var(--rail-w)_-_1.5rem)]'
            : ''
        }`}
        aria-label="Primary"
      >
      <div className="relative flex items-center gap-3 rounded-full bg-transparent px-2 py-2 sm:px-3">
        {/* On rail pages the rail carries the wordmark, so the header does not repeat it. */}
        <Link
          to="/"
          className={`flex shrink-0 items-center gap-2.5 ${brandBreakpoint}`}
          aria-label="ECHOES home"
        >
          <DotMark />
          <span className="whitespace-nowrap font-display text-sm font-semibold tracking-tight">ECHOES</span>
        </Link>

        <form role="search" onSubmit={submitSearch} className="relative hidden flex-1 md:block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            aria-label="Search Lagos destinations"
            placeholder="Search Lagos, Oshodi, Lekki..."
            className="w-full rounded-full border border-black/10 bg-[#f5f3ee] py-2.5 pl-11 pr-4 text-sm text-black/80 outline-none placeholder:text-black/36 focus:border-brand-deep/40"
          />
        </form>

        <div className="hidden items-center gap-2 md:flex">
          {session ? (
            <>
              <Link
                to="/account"
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#f5f3ee] px-3.5 py-2 text-sm text-ink transition-colors duration-300 hover:bg-[#efe7dc]"
              >
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                {session.user.name.trim().split(' ')[0] || 'Account'}
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3.5 py-2 text-sm text-black/60 transition-colors duration-300 hover:bg-black/5"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="rounded-full px-3.5 py-2 text-sm text-black/60 transition-colors duration-300 hover:text-black"
              >
                Sign in
              </Link>
              <Link to="/auth?mode=register" className="btn-primary px-4 py-2 text-sm">
                Join
              </Link>
            </>
          )}
        </div>

        {/*
          Hidden from `md` up on rail pages, where the rail is the navigation.
          The landing page keeps it at every width, opening the same popup menu.
        */}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`ml-auto grid h-10 w-10 place-items-center rounded-full bg-[#f5f1ea] text-ink/70 transition-all duration-300 hover:bg-[#efe7dc] focus:outline-none ${menuBreakpoint}`}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {/*
          A small panel under the trigger, the same on phones and on the landing
          page — not a bar across the header, and never a sidebar.
        */}
        {open && (
          <div
            id="mobile-nav"
            className={`absolute right-0 top-[calc(100%+10px)] w-[280px] rounded-3xl border border-black/10 bg-white/95 p-3 shadow-2xl shadow-black/15 backdrop-blur-md ${menuBreakpoint}`}
          >
            <MenuLinks session={session} onSignOut={signOut} />
          </div>
        )}
      </div>
    </nav>

    {withRail && (
      <SiteRail
        session={session}
        onSignOut={signOut}
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((value) => !value)}
      />
    )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

export function Footer() {
  return (
    <footer className="border-t border-black/10">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center sm:px-10">
        <Wordmark />
        <div className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-black/50">
          <Link to="/discover" className="transition-colors duration-300 hover:text-black">
            Discover
          </Link>
          <Link to="/experiences" className="transition-colors duration-300 hover:text-black">
            Experiences
          </Link>
          <Link to="/assistant" className="transition-colors duration-300 hover:text-black">
            Assistant
          </Link>
          <Link to="/plan" className="transition-colors duration-300 hover:text-black">
            Plan
          </Link>
          <Link to="/contribute" className="transition-colors duration-300 hover:text-black">
            Contribute
          </Link>
          <Link to="/guides" className="transition-colors duration-300 hover:text-black">
            Guides
          </Link>
          <Link to="/admin" className="transition-colors duration-300 hover:text-black">
            Moderation
          </Link>
        </div>
        <p className="text-xs text-black/30">© 2026 ECHOES — Lagos, Nigeria</p>
      </div>

      <div className="mx-auto flex max-w-7xl flex-wrap gap-x-7 gap-y-2 px-6 pb-8 text-sm text-black/40 sm:px-10">
        <Link to="/about" className="transition-colors duration-300 hover:text-black">
          About
        </Link>
        <Link to="/contact" className="transition-colors duration-300 hover:text-black">
          Contact
        </Link>
        <Link to="/privacy" className="transition-colors duration-300 hover:text-black">
          Privacy
        </Link>
        <Link to="/terms" className="transition-colors duration-300 hover:text-black">
          Terms
        </Link>
      </div>
      <div className="mx-auto max-w-7xl px-6 pb-10 text-xs leading-relaxed text-black/40 sm:px-10">
        Cultural records cite OpenStreetMap, Wikipedia and Wikidata, with per-record source links. Coverage notes
        describe only the sources that were checked. Community accounts are published after moderation and are
        community testimony, not verified fact. Experience listings marked “sample” are placeholders and are not
        real operators.
      </div>
    </footer>
  );
}

/** Small arrow affordance used on links, matching the design's lucide usage. */
export function ArrowUpRightIcon({ className = '' }: { className?: string }) {
  return <ArrowUpRight className={`h-4 w-4 ${className}`} aria-hidden="true" />;
}
