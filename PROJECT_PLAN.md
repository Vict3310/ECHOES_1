# ECHOES Project Plan

## Product vision
ECHOES is a tourism and cultural discovery platform connecting tourists with local guides and cultural experiences across Nigeria. The app should help users discover historical places, heritage experiences, food trails, and guided tours, then book experiences with confidence.

## Goal
Build a production-ready MVP with a strong discovery experience, guide marketplace, user authentication, bookings, and payments, while keeping the app mobile-friendly and visually polished.

## Scope
This project has three major layers:
- Frontend web app for tourists and guides
- Backend API for auth, content, bookings, and AI discovery
- Shared content and data layer for places, guide profiles, and experiences

## Phase 1: Foundation and project stability
Objectives:
- Stabilize the repo and toolchain
- Confirm the app runs locally without broken config
- Make the backend and frontend predictable for development

Planned work:
- Fix TypeScript config and build compatibility
- Confirm env variable setup and local startup flow
- Ensure frontend and backend run in local dev mode
- Document env setup for setup scripts and onboarding

Deliverables:
- Healthy local dev environment
- Clear environment file setup
- Type-safe backend build able to run without crash

## Phase 2: User experience and landing page
Objectives:
- Create a premium, conversion-focused landing page
- Make the app mobile responsive and polished
- Improve discovery and hero storytelling

Planned work:
- Redesign landing hero and top navigation
- Improve mobile experience and menu interactions
- Add richer place imagery and destination sections
- Refine homepage layout with featured destinations and experience blocks

Deliverables:
- Clean marketing landing page
- Responsive mobile UI
- Better visual storytelling for destinations and heritage experiences

## Phase 3: Core discovery and place data
Objectives:
- Build a strong travel discovery experience
- Expand content beyond a single city to cover more Nigerian destinations
- Support rich cultural place metadata

Planned work:
- Expand place dataset and location coverage
- Add image support and highlight cards
- Add categories for food, heritage, history, culture, and guided travel
- Ensure place detail pages present clear context and experience metadata

Deliverables:
- Rich destination library
- More location coverage and place context
- Better browsing and exploration flow

## Phase 4: Authentication and user roles
Objectives:
- Support tourists and guides as distinct user personas
- Secure app access and session management

Planned work:
- Tourist signup and login
- Guide signup and onboarding
- Role management and route protection
- Password reset and session persistence

Deliverables:
- Secure auth flow
- Role-based access
- User dashboards for each persona

## Phase 5: Guide marketplace and booking flow
Objectives:
- Turn discovery into a real booking product
- Allow guides to list offerings and tourists to reserve experiences

Planned work:
- Guide profile pages
- Experience listing and pricing
- Booking request flow
- Guide approval/availability management
- Booking status tracking

Deliverables:
- Usable marketplace MVP
- End-to-end booking lifecycle

## Phase 6: Payments and transaction handling
Objectives:
- Enable monetization and fulfillment
- Secure checkout and transaction validation

Planned work:
- Integrate ALATPay checkout flow
- Add transaction confirmation and webhook handling
- Support successful and failed payment states
- Handle cancellations and refunds

Deliverables:
- Working payment flow for bookings
- Clear transaction status UX

## Phase 7: AI guided travel assistant
Objectives:
- Add a smart assistant to help tourists decide where to go and what to do
- Use the cheapest reliable OpenAI model for response generation

Planned work:
- Configure AI provider to use GPT-4o mini
- Ground answers with cultural destination data
- Attach citations to places and experiences
- Expose assistant results in the app flow

Deliverables:
- Travel assistant that responds with grounded recommendations
- Better planning support for tourists

## Phase 8: Admin and moderation
Objectives:
- Ensure the app stays trustworthy and manageable
- Give administrators control over content and users

Planned work:
- Admin dashboard for guide approval
- Review moderation for places and content
- Moderation of user reviews and reports
- Analytics overview for bookings and growth

Deliverables:
- Controlled platform operations
- Safer user-generated content lifecycle

## Phase 9: Quality, scale, and production readiness
Objectives:
- Move from prototype to a robust product
- Prepare for real-world users and operations

Planned work:
- Production logging and monitoring
- Rate limiting and security hardening
- CI/CD and deployment automation
- Automated tests for critical flows
- Accessibility and UX polish

Deliverables:
- Production-ready backend/frontend setup
- Monitoring and release process

## Current phase
We are currently in Phase 1 and Phase 2: project stability and polished user experience. The app now has a stronger landing page and a more stable backend, and we are continuing toward a full product-ready MVP.

## Immediate next build items
1. Finalize startup and env reliability
2. Build tourist auth flow
3. Build guide auth flow
4. Add user profile and dashboard shells
5. Start booking flow integration
6. Add admin moderation and guide approval

## Success criteria for MVP
- Users can sign up and sign in
- Tourists can browse places and experiences
- Guides can create profiles and offerings
- Booking requests can be made and tracked
- Payments can be processed in sandbox mode
- The app is mobile responsive and visually premium
- AI assistant provides helpful grounded recommendations
