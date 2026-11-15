# Architecture

## Overview

The application follows a modular monorepo structure to keep scientific logic, API services, and UI concerns separated.

## Frontend

The frontend is a Vite React + TypeScript application using a feature-oriented layout:

- `app/` – application shell and routing
- `components/` – reusable UI, map, chart, and layout components
- `features/` – dashboard, park map, calendar, analytics, reports, alerts, and field visits
- `services/` – API clients and data adapters
- `types/` – domain types
- `utils/` – helpers and formatting

## Backend

The backend is a FastAPI service with the following responsibilities:

- data retrieval from NASA FIRMS
- validation and normalization of observations
- harmonization and aggregation logic
- API endpoints for dashboard and map views
- reporting and export flows
- future AI service integration behind a provider abstraction layer

## Data flow

1. A periodic or on-demand sync requests each configured NASA FIRMS feed once using the Mozambique bounding box `30.2,-26.9,40.9,-10.4`; EONET is polled separately.
2. The ingestion layer validates, normalizes, and stores source observations.
3. Park selection filters stored observations in memory against mapped Polygon/MultiPolygon boundaries.
4. Harmonization, calendar, analytics, and report services operate on source records and keep provenance attached.
5. Field-visit APIs validate references to real FIRMS observations and store human verification separately from satellite data.
6. The frontend renders the selected park geometry, real observation layers, and field-report workflows. Public fire-data exports never include field visits.

## Mozambique park boundaries and field data

The eight park geometries are attributed to OpenStreetMap contributors under ODbL 1.0. They are mapped estimates, not legal or dispatch boundaries. Field reports use a separate SQLite database and keep satellite and confirmed field coordinates distinct. Field-report API endpoints do not require authentication; protect access to the service at the network or deployment layer because records may contain sensitive operational notes, evidence, and coordinates. PDF and DOCX exports are generated in the browser and can be dispatched through the configured backend email service.

Docker Compose exposes the frontend on port 5174 and backend/API on port 8000. A named volume persists the SQLite operational data independently from the PostgreSQL service volume.

## AI readiness

The architecture leaves space for a future AI Assistant module without deploying it in the working application. No AI API, provider, chat interface, or generated insight is active.
