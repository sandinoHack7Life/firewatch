# API documentation

## Base URL

`http://localhost:8000/api/v1`

## Core endpoints

- `GET /health`
- `GET /dashboard/summary`
- `GET /fires`
- `GET /fires/{observation_id}`
- `GET /fire-map`
- `GET /calendar`
- `GET /analytics/trends`
- `GET /analytics/comparison`
- `GET /analytics/anomalies`
- `GET /harmonization/summary`
- `GET /harmonization/matches`
- `GET /data-sources`
- `GET /reports`
- `POST /reports/generate`
- `GET /system/telemetry`
- `POST /system/sync`
- `GET /planetary-computer/search`
- `GET /parks`
- `GET /field-visits`
- `POST /field-visits`
- `PUT /field-visits/{client_id}`
- `POST /field-visits/{client_id}/dispatch`
- `GET /alerts`
- `POST /alerts`
- `PUT /alerts/{watchlist_id}`
- `DELETE /alerts/{watchlist_id}`
- `POST /alerts/test`
- `GET /alerts/history`

The periodic sync interval is configured by `SYNC_INTERVAL_SECONDS` (300 seconds by default). `/system/telemetry` reports source-specific status, last sync time, active satellites, and time until the next sync. The first sync seeds the local observation store; it does not dispatch alerts for every record in that initial baseline.

FIRMS sensor feeds require `FIRMS_MAP_KEY`; NASA EONET is the zero-key live event feed. EONET records are not sensor observations and do not have FRP or confidence values. Report generation returns filtered data extracts immediately; generated reports are not persisted.

Alert email dispatch requires SMTP settings in the backend environment. SMTP credentials are never returned by the API. Park geofences use the same mapped park geometries as map filtering.

Field verification reports can be linked to a real FIRMS observation or submitted as a manual patrol record. The API validates linked detections and field coordinates against the selected park. Reports are stored separately from satellite observations; public fire-data exports do not include field reports or field GPS. Field-visit read, create, update, and email-dispatch endpoints do not require authentication. Anyone able to reach the API can view or modify these operational reports and request an email dispatch, so deploy the service only behind access controls appropriate for the sensitivity of field notes, evidence, and coordinates.

The browser generates PDF and DOCX report attachments. `POST /field-visits/{client_id}/dispatch` sends both to the configured operations address and, optionally, one validated additional email address. SMTP must be configured on the backend; delivery failures return HTTP 503.

`GET /parks` returns all 25 registered conservation areas: eight national parks, four wildlife reserves, and 13 forest reserves. Every item includes `area_type`, optional province, `bbox`, `boundary_source`, `boundary_license`, `boundary_url`, `boundary_quality` (`mapped` or `approximate`), and a `boundary_note`. The Lake Niassa partial reserve and Pomene have approximate extents; they are not legal boundaries. Forest-reserve province values are intentionally null where unsupported.

## Conservation-area scoping

The frontend uses one shared conservation-area selector across monitoring pages and always sends a registered `park_id`. Gorongosa is the default for first-time visitors and for missing or invalid saved/query selections. The API also defaults missing `park_id` values to Gorongosa; omitting the parameter never disables boundary filtering.

The following read endpoints accept an optional `park_id` query parameter: `/dashboard/summary`, `/fires`, `/fires/{observation_id}`, `/fire-map`, `/calendar`, `/analytics/trends`, `/analytics/comparison`, `/analytics/anomalies`, `/harmonization/summary`, `/harmonization/matches`, `/reports`, `/system/telemetry`, `/planetary-computer/search`, `/alerts/history`, and `/field-visits`. `POST /reports/generate` accepts an optional `park_id` in its JSON body.

For a selected protected area, observations are fetched from the existing Mozambique-wide FIRMS feeds and filtered against its registered polygon; a supplied bounding box is intersected with that area's bounding box first. Dashboard metrics, analytics, maps, alerts, and field-visit reads use the same validated `park_id`.

Use an ID returned by `GET /parks`. An unknown `park_id` returns HTTP 400. An observation detail outside the requested park returns HTTP 404. `GET /parks` is the registry endpoint and does not require `park_id`; synchronization remains national and does not accept a park filter.

## Validation

The API uses Pydantic models and FastAPI validation to ensure typed requests and responses. Errors should surface clear HTTP status codes and explanatory payloads.

## Future AI service

The AI Assistant is not included in this release. An `ai/chat` endpoint is intentionally deferred and would be added only after AI provider configuration is approved.
