import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';

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

const NAV_LINKS = [
  { to: '/discover', label: 'Discover' },
  { to: '/experiences', label: 'Experiences' },
  { to: '/assistant', label: 'Assistant' },
  { to: '/contribute', label: 'Contribute' },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <nav className="fixed left-1/2 top-4 z-50 -translate-x-1/2 sm:top-7" aria-label="Primary">
      <div className="capsule relative">
        <Link to="/" className="flex items-center gap-2.5 pr-3 sm:pr-4" aria-label="ECHOES home">
          <DotMark />
          <span className="whitespace-nowrap font-display text-sm font-semibold tracking-tight">ECHOES</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-300 hover:bg-black/5 hover:text-black ${
                  isActive ? 'text-black' : 'text-black/60'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <Link
          to="/plan"
          className="ml-1 whitespace-nowrap rounded-full bg-brand-deep px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand-deep/30 transition-all duration-300 hover:bg-brand-hover active:scale-95 sm:ml-2 sm:px-5"
        >
          Plan a visit
        </Link>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-1 grid h-8 w-8 place-items-center rounded-full text-ink/70 transition-colors hover:bg-black/5 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {open && (
          <div
            id="mobile-nav"
            className="absolute left-0 right-0 top-[calc(100%+10px)] rounded-3xl border border-black/10 bg-white/95 p-3 shadow-2xl shadow-black/15 backdrop-blur-md md:hidden"
          >
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm transition-colors ${
                    isActive ? 'bg-black/5 text-ink' : 'text-black/60 hover:bg-black/5'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <NavLink to="/admin" className="block rounded-2xl px-4 py-3 text-sm text-black/60 hover:bg-black/5">
              Moderation
            </NavLink>
          </div>
        )}
      </div>
    </nav>
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
          <Link to="/admin" className="transition-colors duration-300 hover:text-black">
            Moderation
          </Link>
        </div>
        <p className="text-xs text-black/30">© 2026 ECHOES — Lagos, Nigeria</p>
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
