# ECHOES Project Overview

ECHOES is an AI-powered cultural discovery and tourism platform for Lagos, Nigeria. The project helps users explore historical places, local culture, food, routes, bookings, and community stories with a map-first experience.

## Core idea

ECHOES combines:
- a map-based discovery experience
- verified cultural records and source-backed explanations
- route planning for real travel
- local food and touring recommendations
- booking and payment flows for experiences

## Contributors

- Flora Adelekan
- Fashina Omolabake
- Victor B.

## Main repo

- Frontend: `client/`
- Backend: `server/`
- Cultural data: `data/`
- Design reference: `design.html`

## Quick start

```bash
npm install
cp .env.example .env
npm --workspace server run db:generate
npm run dev
```

Open http://localhost:5173

## Notes

This project is designed to run in demo mode without all external credentials configured, while still exposing the real product flows and verification logic.
