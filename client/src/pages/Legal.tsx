import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Reveal } from '../components/layout';

/**
 * Contact address is configuration, not a hard-coded string: inventing an
 * address would be worse than shipping none, so an unset value says so plainly.
 */
const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() ?? '';

/** Shared shell so every plain-language page has the same rhythm. */
function DocPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-32 sm:px-10 sm:pt-36">
      <Reveal>
        <p className="text-xs uppercase tracking-[0.25em] text-brand-deep">{eyebrow}</p>
        <h1 className="mt-4 font-display text-4xl font-light leading-[1.05] tracking-tighter text-ink sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-black/65">{intro}</p>
      </Reveal>

      <div className="mt-12 space-y-10 pb-24">{children}</div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl tracking-tight text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-black/65">{children}</div>
    </section>
  );
}

/** States that the pages below describe the current build, not a finished service. */
function DraftNotice() {
  return (
    <p className="rounded-2xl border border-black/10 bg-white/60 px-5 py-4 text-sm leading-relaxed text-black/60">
      ECHOES is under active development. This page describes how the platform behaves in the current
      build, in plain language. It is not legal advice, and it has not been reviewed by a legal
      professional — that review should happen before the platform is launched publicly or takes real
      payments.
    </p>
  );
}

export function About() {
  return (
    <DocPage
      eyebrow="About"
      title="What ECHOES is for."
      intro="ECHOES maps cultural places in Lagos and records, honestly, which sources were checked and what they contain."
    >
      <DraftNotice />

      <Section heading="Coverage is evidence, not a verdict">
        <p>
          Every place carries a coverage row per dimension — coordinates, an encyclopedic article,
          structured facts, an image, citations, community testimony. A dimension marked missing means the
          sources we checked did not contain it. It is never a claim that a place lacks history, or that
          its community holds no knowledge about it.
        </p>
        <p>
          Community accounts are published after moderation and are presented as testimony, not as
          verified fact. Where sources disagree, the disagreement is recorded rather than resolved.
        </p>
      </Section>

      <Section heading="Images state what they are">
        <p>
          A photograph is either a freely licensed photograph of the place itself — resolved from a cited
          article, credited to its author, shipped with its licence — or it is a representative stock
          photograph shown for atmosphere. The second kind is labelled as a representative image wherever
          it appears, because showing a stock photo as though it depicted a specific place would be the
          same kind of quiet overstatement as an invented citation.
        </p>
      </Section>

      <Section heading="What is not finished">
        <p>
          Some listings are marked “sample” and are not real operators. Coordinates are approximate place
          centroids and have not been surveyed. The cultural records are currently curated by hand rather
          than refreshed by an automated ingestion pipeline. Payments and the AI assistant require
          credentials that are not configured in this build.
        </p>
      </Section>

      <Section heading="Where the records come from">
        <p>
          Records cite OpenStreetMap, Wikipedia and Wikidata, with a per-record source list. Each citation
          is meant to resolve to a real page; when one does not, that is a defect worth reporting.
        </p>
      </Section>
    </DocPage>
  );
}

export function Contact() {
  return (
    <DocPage
      eyebrow="Contact"
      title="Talk to the people behind it."
      intro="Corrections, takedown requests and contributions are all welcome — the dataset is only as good as what it is told."
    >
      <DraftNotice />

      {CONTACT_EMAIL ? (
        <Section heading="Email">
          <p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 text-brand-deep underline underline-offset-4"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      ) : (
        <Section heading="Email">
          <p>
            No contact address is configured in this build. Set <code>VITE_CONTACT_EMAIL</code> in the
            environment before deploying so this page can display a working address.
          </p>
        </Section>
      )}

      <Section heading="Corrections and takedowns">
        <p>
          If a record describes you, your family or your community and you want it changed or removed,
          quote its reference. Community submissions are published with the attribution you choose —
          full name, pseudonym or anonymous — and you can ask for that to change or be withdrawn.
        </p>
      </Section>

      <Section heading="Contributing a place or an account">
        <p>
          Contributions go through moderation before anything is published.{' '}
          <Link to="/contribute" className="text-brand-deep underline underline-offset-4">
            Open the contribution form
          </Link>
          .
        </p>
      </Section>
    </DocPage>
  );
}

export function Privacy() {
  return (
    <DocPage
      eyebrow="Privacy"
      title="What is stored, and where."
      intro="This describes the current build specifically, including the parts that are not production-grade yet."
    >
      <DraftNotice />

      <Section heading="What is collected">
        <p>
          Creating an account stores your name, email address and a hashed password. A password is hashed
          with bcrypt and is never stored or returned in plain text. Bookings you make store the traveller
          name, email, phone number if you give one, and the booking reference. Community submissions
          store the text you write, the attribution mode you choose, and the name you provide if you do not
          choose to be anonymous.
        </p>
      </Section>

      <Section heading="Where it is stored">
        <p>
          Account, booking, guide and moderation data live in the API’s store. In this build that store is
          in memory by default, which means it is emptied when the server restarts and nothing is
          recoverable from it. A PostgreSQL option exists in the code but is not configured here.
        </p>
      </Section>

      <Section heading="Session handling">
        <p>
          Signing in returns a token that the browser keeps in local storage so you stay signed in for
          seven days. Anything running in the page can read it, which is why a production deployment
          should move sessions to httpOnly cookies.
        </p>
      </Section>

      <Section heading="Third parties">
        <p>
          The map loads tiles from a third-party tile server, and representative images load from a
          third-party image CDN, so those requests are visible to those providers. If payment processing is
          enabled, booking and customer details are sent to the configured payment provider. No analytics
          or advertising trackers are part of this build.
        </p>
      </Section>

      <Section heading="Your choices">
        <p>
          You can ask for a correction or removal of a community submission by quoting its reference. See
          the contact page for how to reach us.
        </p>
      </Section>
    </DocPage>
  );
}

export function Terms() {
  return (
    <DocPage
      eyebrow="Terms"
      title="Terms of use."
      intro="Short and specific, because most of what matters here is what ECHOES does and does not claim."
    >
      <DraftNotice />

      <Section heading="What the records are">
        <p>
          Cultural records are compiled from the cited sources and are provided for general information.
          They are not survey data: coordinates are approximate. Coverage notes describe only the sources
          that were checked. Community accounts are testimony from contributors, published after
          moderation, and are not presented as verified fact.
        </p>
      </Section>

      <Section heading="Experiences and bookings">
        <p>
          Listings marked “sample” are placeholders used to exercise the booking flow. They are not real
          operators and are not for sale. Bookings made against them create no obligation for anyone to
          deliver a service.
        </p>
      </Section>

      <Section heading="Payments">
        <p>
          Where payments are enabled, they are handled by the configured payment provider and are verified
          server-side before a booking is confirmed. A booking is only confirmed once the provider confirms
          that the amount and currency match the booking exactly.
        </p>
      </Section>

      <Section heading="Images and licensing">
        <p>
          Photographs are reproduced under their stated licences with a visible credit. Images labelled
          “representative” are stock photographs and do not depict the place. If you believe an image is
          credited incorrectly or used without permission, tell us and it will be removed.
        </p>
      </Section>

      <Section heading="Contributions">
        <p>
          By submitting a community account you confirm it is your own testimony and grant ECHOES
          permission to publish it with the attribution you selected. Submission does not guarantee
          publication, and contributions are reviewed before they appear.
        </p>
      </Section>
    </DocPage>
  );
}
