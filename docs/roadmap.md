# Roadmap

## Current release status

The current release focuses on the scientific platform and Mozambique park operations: NASA data ingestion, harmonization, park-scoped exploration, human field verification, park alerts, analytics, reports, and documentation.

## Deferred feature: AI Assistant

The AI Assistant is a planned future feature. It is not implemented in the initial working application and is explicitly excluded from the current release.

Planned future scope:

- Provider abstraction and model configuration
- Server-side AI integration for contextual Q&A
- Data-grounded responses using platform analytics and stored observation metadata
- Modular off-switch that can be enabled only after the scientific platform is stable

The project architecture is AI-ready, but the implementation remains deferred until a suitable provider, model, and governance plan are selected and configured.

## Milestones

### Phase 1 — Foundation
- Repository and service layout
- Frontend + backend bootstrapping
- Docker Compose runtime
- Database and environment configuration

### Phase 2 — Data platform
- FIRMS integration
- Validation and normalization
- Historical ingestion workflows

### Phase 3 — Scientific processing
- Harmonization pipeline
- Calendar and trend aggregation
- Analytical baselines and anomaly logic

### Phase 4 — Mozambique experience
- National park registry and park-scoped map/calendar/report views
- Gorongosa as the default park
- Historical analytics and scientific transparency

### Phase 5 — Human verification
- Shared-key protected field-visit records
- Separate satellite and field coordinates and timestamps
- Encrypted local drafts with online synchronization
- Park-specific email watchlists

### Phase 6 — Reports and operations
- Reports and exports restricted to satellite observations
- Historical recurrence and anomaly analysis

### Future phase — Deferred AI
- Provider selection
- Context retrieval and prompt orchestration
- AI assistant interface

## Design guardrails

- No AI APIs, keys, chat interfaces, or placeholder responses in the working application
- No simulated AI insights or fabricated analytical conclusions
- AI remains an architectural future concern rather than a shipped feature
