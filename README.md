# ECHOES

**AI-powered cultural discovery, navigation and tourism platform — Lagos, Nigeria.**

ECHOES maps real cultural and historical places, explains why they matter using **cited sources**,
shows **what the checked records are missing** without ever treating a gap as proof that a place
has no history, calculates **real routes**, and connects visitors to **bookable cultural
experiences** with server-verified payments.

## Project team

- Flora Adelekan
- Fashina Omolabake
- Victor B.

---

---

## 1. What actually exists in this repository

| Layer | Status |
| --- | --- |
| Cultural discovery map (Leaflet + OpenStreetMap) | **Implemented and rendered** in a real browser |
| Curated cultural dataset with provenance | **Implemented** — 17 real Lagos sites, each with source links |
| Explainable knowledge-gap analysis | **Implemented** — 7 independent coverage dimensions, evidence stored per flag |
| Grounded cultural assistant (RAG + citations) | **Implemented** — Gemma provider wired; retrieval-only fallback verified |
| Real routing + Google Maps handoff | **Implemented and verified live** against an OSRM server |
| AI itinerary planner | **Implemented** — model place IDs validated against the DB; routes from the routing provider |
| Community stories + moderation | **Implemented and verified** end to end (submit → moderate → coverage flips) |
| Experiences, bookings, ALATPay | **Implemented**; verification rules tested. **Awaiting ALATPay merchant credentials** |
| PostgreSQL + PostGIS + Prisma | **Schema, migration workflow and seed implemented**; not executed against a live server here |
| Auth, permissions, admin console | **Implemented** — token/session gated, least-privilege |
| Tests | **94 passing** (87 API + 7 client), plus typecheck and production builds |

> The `design.html` file in the repository root is the design reference this interface follows
> (cream/deep-green palette, Geist + Inter + Instrument Serif, floating capsule nav, drifting
> hero forms, word-by-word reveals, giant cropped wordmarks, dark-green capability list).

---

## 2. Architecture

```
ECHOES/
├── data/                     # Canonical cultural records (version-controlled, reviewable)
│   ├── places.json           #   17 Lagos places, per-record sources + coverage evidence
│   └── experiences.json      #   SAMPLE listings (labelled, cannot be sold)
├── client/                   # React + TypeScript + Vite + Tailwind + Framer Motion
│   └── src/
│       ├── components/       #   layout, ui, place, MapView, DirectionsPanel
│       ├── pages/            #   Home, Discover, PlaceDetail, Assistant, Plan,
│       │                     #   Experiences, ExperienceDetail, BookingReturn,
│       │                     #   Contribute, Admin, NotFound
│       └── lib/              #   api client, typed contract, formatting, knowledge helpers
└── server/                   # Express + TypeScript API
    ├── prisma/schema.prisma  #   users, stories, bookings, payments, audit
    ├── prisma/sql/postgis.sql#   optional PostGIS mirror for geographic queries
    ├── src/
    │   ├── routes/           #   places, experiences, stories, bookings, payments,
    │   │                     #   ai, itinerary, auth, admin, health
    │   ├── services/
    │   │   ├── gemma/        #   provider abstraction, grounding, prompts, validation
    │   │   ├── payments/     #   ALATPay transport + trusted verification
    │   │   ├── knowledge.ts  #   coverage/gap analysis
    │   │   ├── quality.ts    #   duplicate flagging (never auto-merges)
    │   │   ├── routing.ts    #   OSRM / GraphHopper
    │   │   └── itinerary.ts  #   AI plan + real routing + validation
    │   ├── repo/             #   reference data + transactional store (memory | Prisma)
    │   └── middleware/       #   auth, validation, rate limits, errors
    └── tests/                #   9 suites, 87 tests
```

**Key design decision.** Curated cultural reference data lives in `/data` under version control so
every change to a historical record is reviewable with its provenance intact. User-generated and
transactional data (stories, bookings, payments, accounts, audit) lives in PostgreSQL. When
`DATABASE_URL` is unset, the API runs on an in-memory transactional store so every journey is
explorable offline.

---

## 3. Quick start

```bash
# 1. Install (npm workspaces)
npm install

# 2. Configure
cp .env.example .env      # then edit — see section 4

# 3. Generate the Prisma client (required for the server to typecheck/build)
npm --workspace server run db:generate

# 4. Run both workspaces
npm run dev               # API on :8787, client on :5173 (Vite proxies /api)
```

Open <http://localhost:5173>.

Nothing else is required: with no credentials configured the app runs with
**offline grounded retrieval** instead of Gemma, **simulated** ALATPay checkout, and live routing
from the configured OSRM endpoint.

### Verification commands

```bash
npm run typecheck                    # both workspaces, strict
npm test                             # 87 API tests + 7 client tests
npm run build                        # server tsc + client vite build
```

---

## 4. Environment variables

Full list with commentary: [`.env.example`](.env.example). Never commit `.env`.

| Group | Variables | Notes |
| --- | --- | --- |
| Server | `PORT`, `CORS_ORIGINS`, `NODE_ENV` | |
| Database | `DATABASE_URL` | Unset ⇒ in-memory store |
| Auth | `SESSION_SECRET`, `ADMIN_API_TOKEN` | Admin console refuses access if unset |
| Gemma | `GEMMA_PROVIDER` (`google`\|`ollama`\|`none`), `GEMMA_MODEL`, `GOOGLE_AI_API_KEY`, `OLLAMA_BASE_URL` | `none` ⇒ retrieval-only |
| Cultural data | `WIKIPEDIA_API_URL`, `WIKIDATA_API_URL`, `WIKIMEDIA_USER_AGENT` | Wikimedia requires a descriptive UA |
| Map tiles | `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION` | Point at your own/commercial tiles for production |
| Routing | `ROUTING_PROVIDER`, `OSRM_BASE_URL`, `GRAPHHOPPER_API_KEY` | |
| ALATPay | `ALATPAY_ENV`, `ALATPAY_BASE_URL`, `ALATPAY_PUBLIC_KEY`, `ALATPAY_SECRET_KEY`, `ALATPAY_BUSINESS_ID`, `ALATPAY_INIT_PATH`, `ALATPAY_VERIFY_PATH`, `ALATPAY_WEBHOOK_SECRET`, `ALATPAY_CALLBACK_URL`, `ALATPAY_ALLOW_SIMULATION` | |

Only `VITE_*` values reach the browser. Secret keys are read server-side exclusively.

---

## 5. Gemma — the primary AI model

**Gemma is the primary model.** The AI layer is a provider abstraction
(`server/src/services/gemma/providers.ts`) with two supported deployments and an explicit offline mode:

- **Option 1 — hosted inference:** Google AI for Developers (`GEMMA_PROVIDER=google`, `GOOGLE_AI_API_KEY`).
  Docs: <https://ai.google.dev/gemma>
- **Option 2 — self-hosted:** Ollama (`GEMMA_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `GEMMA_MODEL`).
  Docs: <https://docs.ollama.com/>
- **Offline (`none`):** no model is called. Answers are assembled **verbatim from the stored
  records with their citations**, and the response is labelled `retrieval-only`.

Grounding, integrity and safety rules that are enforced in code, not just in prompts:

1. **Retrieval→cite→validate.** Records are retrieved by keyword scoring, wrapped in a delimited
   untrusted-data block, and the model must return JSON with citation ids. Ids that do not match a
   retrieved record are **discarded server-side** (`validateCitations`), so a displayed link always
   corresponds to a real record.
2. **Prompt-injection resistance.** Retrieved text is sanitised; instruction-like lines are stripped
   and logged as signals.
3. **Community accounts stay labelled.** Accounts in `community_accounts_unverified` must be
   described as testimony, never as established fact. Gemma is never used to "verify" a story.
4. **No fabricated itineraries.** Every `placeId` returned is checked against the candidate set;
   unknown ids are rejected and reported.
5. **Routing numbers come from the router.** The model is told never to estimate travel distance or
   duration, and the server unions the model's ordering with provider results.
6. **Safe failure.** Invalid JSON, schema violations, timeouts and provider errors all degrade to
   the retrieval-only answer rather than a fabricated one.

> **Not verified here:** no Gemma endpoint was reachable in this environment, so the
> `google` and `ollama` transports are **implemented but unverified against a live endpoint**.
> The retrieval-only path and all validation logic are covered by tests.

---

## 6. Cultural data, provenance and knowledge gaps

Sources checked and recorded per place: **OpenStreetMap (ODbL)**, **English Wikipedia (CC BY-SA)**,
**Wikidata (CC0)**. Coverage is evaluated on **seven independent dimensions** —
coordinates, encyclopedic article, structured facts, openly licensed image, citations, community
story, verified experience — each with one of five states:

`available` · `incomplete` · `missing` · `conflicting` · `awaiting_review`

Every flag stores its **evidence**, and the API returns a disclaimer with every list:

> Coverage describes the sources that were checked. A missing entry is not evidence that a place
> lacks history or that its community does not hold knowledge about it.

There is deliberately **no single "truth score"**. Duplicate detection (`services/quality.ts`)
only *flags* candidates for human review and never merges or deletes a record.

---

## 7. Routing and directions

- Provider: OSRM HTTP API (`ROUTING_PROVIDER=osrm`) or GraphHopper (`=graphhopper`).
- Modes: **walking and driving only** — public transport, danfo, ferry and live traffic are *not*
  integrated and are never claimed.
- The UI shows distance, duration, turn-by-turn steps, the provider name, the provider's own
  limitations note, and states that **estimates do not include live traffic**.
- When the provider fails or lacks a profile, the API returns a typed error (`routing_unavailable`,
  `no_route`, `unprocessable`) and the UI shows the message — it never invents a route.
- **Google Maps handoff** uses the official Maps URLs format
  (`https://www.google.com/maps/dir/?api=1&...`) for a single destination and for whole itineraries.
  Navigation is performed by Google Maps; ECHOES says so.
- Accessibility: location permission is requested only after an explanation, manual coordinate and
  place-based start points are always available, the map is `scrollWheelZoom: false` so it does not
  trap page scroll, and **every place is also reachable as a list** — the map is never the only route
  to the information.

---

## 8. Experiences, bookings and ALATPay

Docs referenced: <https://docs.alatpay.ng/>, <https://developer.alatpay.ng/>, <https://alatpay.ng/portal>.

**No official ALATPay MCP server could be verified**, so ECHOES uses the documented REST API.
`.mcp.json` in the repository points at a development MCP URL; it is present in the repo but is
**not** used or trusted by any code path.

Booking flow (all server-side):

1. Availability is computed from the schedule capacity plus confirmed **and** pending bookings.
2. Booking creation re-checks capacity inside a lock (Postgres advisory lock on the schedule id in
   the Prisma store) — a date cannot be oversold.
3. The price is recalculated from the experience record; a client-supplied amount is ignored.
4. A pending booking and a unique payment reference are created, then checkout is initialised.
5. The booking becomes `confirmed` **only** after verification.

Verification rules (`services/payments/verify.ts`) — confirmed only when reference, amount and
currency all match; otherwise the outcome is `mismatched` / `pending` / `failed` / `cancelled` /
`expired` and the booking stays unconfirmed. Application is **idempotent**: replaying a callback
cannot confirm twice, revive a cancelled booking, or downgrade a confirmed one. Webhooks require a
valid HMAC signature (`ALATPAY_WEBHOOK_SECRET`) — unsigned webhooks are rejected.

### ALATPay endpoint configuration

ECHOES deliberately ships **no default REST paths**, because they must come from the documentation
for your merchant account. If `ALATPAY_INIT_PATH` / `ALATPAY_VERIFY_PATH` are unset, the API refuses
to call anything and reports exactly what is missing instead of guessing an endpoint.

```bash
ALATPAY_ENV=sandbox
ALATPAY_BASE_URL=https://api.alatpay.com
ALATPAY_PUBLIC_KEY=...        # from the ALATPay developer portal
ALATPAY_SECRET_KEY=...
ALATPAY_BUSINESS_ID=...
ALATPAY_INIT_PATH=/...        # copy verbatim from https://docs.alatpay.ng/
ALATPAY_VERIFY_PATH=/.../:reference   # must contain the :reference placeholder
ALATPAY_WEBHOOK_SECRET=...    # enables signed webhook processing
ALATPAY_CALLBACK_URL=http://localhost:5173/experiences/booking/return
```

**Sandbox status: not tested against ALATPay** — no merchant credentials were available. Everything
that does not require them is implemented and tested, including the full mismatch/replay/idempotency
matrix. A clearly-labelled **simulated checkout** (`ALATPAY_ALLOW_SIMULATION=true`, always disabled
when `ALATPAY_ENV=live`) lets the whole journey be exercised locally; it reports
`SIMULATED payment. No real transaction took place.` at every step.

---

## 9. Database

```bash
npm --workspace server run db:generate              # Prisma client
npm --workspace server run db:migrate:dev -- --name init   # create the migration
npm --workspace server run db:migrate               # apply in production (prisma migrate deploy)
psql "$DATABASE_URL" -f server/prisma/sql/postgis.sql      # optional PostGIS mirror
SEED_ADMIN_EMAIL=you@example.org SEED_ADMIN_PASSWORD='…' npm --workspace server run db:seed
```

`prisma/sql/postgis.sql` is idempotent and adds a `place_geo` table, a GIST index and a
`places_near(in_lat, in_lng, radius_m, max_rows)` function for radius queries.

> **Not executed here:** no PostgreSQL/PostGIS server was available in this environment, so
> migrations and seed were **not run**. The Prisma store typechecks against the generated client but
> has **not been exercised against a live database**; the in-memory store is what every test and the
> running demo use.

---

## 10. Testing

```
server  →  9 suites, 87 tests   (knowledge, geo, validation, quality, stories,
                                 bookings, payments, itinerary, API integration)
client  →  2 suites,  7 tests   (formatting, coverage/gap presentation)
```

Highlights covered: independent gap classification; no "no history" claims; citation dropping;
rejected stop ids; overbooking and seat release; server-side pricing; reference/amount/currency
mismatch; replay and cancelled-booking protection; unsigned webhooks; admin authorisation;
sensitive-content moderation refusal; routing failure degradation; over-budget itineraries.

```bash
npm test
```

---

## 11. Security, privacy and honest limitations

Implemented: server-side validation (Zod) on every input; authorisation at the API boundary;
parameterised Prisma/query usage; Helmet headers; CORS allow-list; per-surface rate limits
(AI, stories, payments, auth); 128 kB body limit; pino logging with secret redaction; secrets kept
in env only; no card data stored; consent captured before a story is accepted; location permission
requested only after an explanation and never persisted.

**Recorded limitations — do not read these as solved:**

- **Gemma transports unverified** (`google`, `ollama`): implemented, never connected here.
- **ALATPay untested against the provider**: no sandbox credentials; verification logic is unit- and
  integration-tested, the transport is not.
- **PostgreSQL/PostGIS never started**: schema, migration workflow and seed exist but are unexercised.
- **Public OSM tile service**: fine for development, **not** an unrestricted production service.
  Configure `VITE_TILE_URL` for production and review the provider's terms.
- **Public OSRM demo server**: works (verified: 1 741 m / 166 s for a Lagos Island pair) but is an
  **evaluation** endpoint. Self-host OSRM or use a commercial plan for production traffic.
- **Coordinates are approximate** place centroids, flagged per record as
  `coordinateAccuracy: "approximate"`. They must be re-validated before being treated as survey-grade.
- **Some historical statements are contested** and are labelled as such (conflicting coverage state)
  rather than silently resolved.
- **All experience listings are sample data** (`isSampleData: true`), badged in the UI, and cannot be
  sold. Real listings require a verified operator with written consent.
- **No testimonials, reviews or ratings** are displayed: none exist, and none were invented.
- **Text-to-speech** uses the browser's built-in speech synthesis. No external TTS provider is
  integrated, and generated narration is labelled as such.
- **No claim of production readiness.** See the blockers in section 13.

---

## 12. The four primary journeys

| Journey | How it works now |
| --- | --- |
| **A — First-time visitor** | `/discover` → marker or list → coverage, gaps and sources → *Get directions* → real route with steps → *Open in Google Maps* |
| **B — AI-assisted exploration** | `/plan` → set start, interests, time → Gemma (or heuristic) plan with validated stops → real leg-by-leg routing → reorder/remove → recalculate → Google Maps handoff |
| **C — Community preservation** | `/contribute` → choose place, write account, give source context, choose attribution, consent → reference issued → moderator approves in `/admin` → account published as testimony, coverage flips to `available` |
| **D — Paid experience** | `/experiences` → dated availability → booking priced on the server → checkout initialised → server verifies transaction → booking confirmed only on a match |

---

## 13. Exact remaining blockers

1. **ALATPay merchant credentials and the real REST paths** (`ALATPAY_PUBLIC_KEY`, `ALATPAY_SECRET_KEY`,
   `ALATPAY_BUSINESS_ID`, `ALATPAY_INIT_PATH`, `ALATPAY_VERIFY_PATH`, `ALATPAY_WEBHOOK_SECRET`) and
   sandbox access. Until then payments run in clearly-labelled simulation.
2. **A Gemma endpoint** — either `GOOGLE_AI_API_KEY` (with the model name for your project) or a
   running Ollama host with `gemma3:4b` pulled. Until then the assistant answers in retrieval-only mode.
3. **A PostgreSQL + PostGIS instance** (`DATABASE_URL`) to move off the in-memory store.
4. **A production tile source** for the map, and a **self-hosted/contracted routing service**
   instead of the public demo servers.
5. **Verified experience operators** with written consent before any listing is sold.
6. **Deployment targets**: Cloudflare Pages for `client/dist`, a Node host for `server/dist`, managed
   Postgres for data — configuration is documented but no deployment has been performed.
