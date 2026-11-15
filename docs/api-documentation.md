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
- `GET /data-sources`
- `GET /reports`
- `POST /reports/generate`
- `GET /system/telemetry`
- `POST /system/sync`
- `GET /planetary-computer/search`
- `GET /parks`
- `GET /field-visits` (requires `X-Field-Data-Key`)
- `POST /field-visits` (requires `X-Field-Data-Key`)
- `PUT /field-visits/{client_id}` (requires `X-Field-Data-Key`)
- `GET /alerts`
- `POST /alerts`
- `PUT /alerts/{watchlist_id}`
- `DELETE /alerts/{watchlist_id}`
- `POST /alerts/test`
- `GET /alerts/history`

The periodic sync interval is configured by `SYNC_INTERVAL_SECONDS` (300 seconds by default). `/system/telemetry` reports source-specific status, last sync time, active satellites, and time until the next sync. The first sync seeds the local observation store; it does not dispatch alerts for every record in that initial baseline.

FIRMS sensor feeds require `FIRMS_MAP_KEY`; NASA EONET is the zero-key live event feed. EONET records are not sensor observations and do not have FRP or confidence values. Report generation returns filtered data extracts immediately; generated reports are not persisted.

Alert email dispatch requires SMTP settings in the backend environment. SMTP credentials are never returned by the API. Park geofences use the same mapped park geometries as map filtering.

Field-visit endpoints require the `X-Field-Data-Key` header and a server-side `FIELD_DATA_ACCESS_KEY` of at least 32 characters. Field records are stored separately from satellite observations. Public report generation never includes field visits or field GPS. This is shared-key access control, not user-specific authentication; keep the service on a trusted network and protect the shared key.

`GET /parks` returns all eight mapped park geometries and OpenStreetMap attribution metadata. The boundaries are estimates, not legal dispatch boundaries.

## Validation

The API uses Pydantic models and FastAPI validation to ensure typed requests and responses. Errors should surface clear HTTP status codes and explanatory payloads.

## Future AI service

The AI Assistant is not included in this release. An `ai/chat` endpoint is intentionally deferred and would be added only after AI provider configuration is approved.
