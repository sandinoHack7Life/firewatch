# MODIS–VIIRS Firewatch

MODIS–VIIRS Firewatch is a geospatial intelligence platform supporting field planning in Mozambique's eight national parks, with Gorongosa selected by default. It links country-wide NASA FIRMS thermal-anomaly observations to mapped park boundaries and private ranger verification records. The platform supports human decision-making; it does not predict fires or automatically confirm that an anomaly is a wildfire.

## Core principles

- Scientific integrity over visual polish.
- Real NASA/FIRMS data integration as the foundation.
- One national Mozambique FIRMS bounding-box request per feed and sync, followed by local park filtering.
- Private field verification with separate satellite and field coordinates, protected shared-key API access, and encrypted offline drafts.
- Modular architecture with clear separation between ingestion, normalization, analytics, and reporting.
- AI-ready design without embedding AI functionality in the initial release.

## AI assistant status

The AI Assistant is part of the long-term product roadmap, but it is intentionally deferred for the initial release. No AI APIs, providers, chat interfaces, or simulated insights are implemented in the working application. The platform remains architecture-ready for a future AI assistant after the core scientific platform is validated and product requirements are finalized.

## Live data behavior

- NASA EONET provides a live, zero-key catalog of open wildfire events. These are event reports and are not represented as sensor-level hotspots, FRP, or confidence measurements.
- NASA FIRMS MODIS and VIIRS NRT CSV feeds require a configured `FIRMS_MAP_KEY`. Without it, those streams remain unavailable; the application does not substitute generated observations.
- FIRMS requests use the single Mozambique bounding box `30.2,-26.9,40.9,-10.4`; park-specific results are filtered in memory.
- The eight supported parks are Gorongosa, Limpopo, Banhine, Zinave, Bazaruto, Maputo, Mágoè, and Quirimbas.
- Park boundaries are mapped OpenStreetMap geometries (© OpenStreetMap contributors, ODbL 1.0), not legal or dispatch boundaries. Confirm boundaries with park authorities before operational use.
- Microsoft Planetary Computer STAC metadata and imagery assets are queried on demand. They are contextual imagery/product records, not an independent active-fire detection feed.
- Observations, alert history, and private field visits are stored in separate SQLite databases under the user's home directory by default. Field visit APIs require `FIELD_DATA_ACCESS_KEY` (at least 32 characters); the browser keeps it in memory only. Offline visit drafts are AES-GCM encrypted using the entered key.
- Reports and public exports contain satellite observations only. Field visit notes, field GPS, and patrol details are never included.

## Quick start

1. Copy `.env.example` to `.env`; configure `FIRMS_MAP_KEY`, a strong random `FIELD_DATA_ACCESS_KEY`, and optional SMTP settings. Never commit `.env`.
2. Start the backend:
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
3. In a separate terminal, start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev -- --host 0.0.0.0 --port 5174
   ```
4. Visit the frontend at `http://localhost:5174`; API docs are at `http://localhost:8000/docs`.

The backend loads the project-root `.env` regardless of its working directory. A missing FIRMS key leaves FIRMS feeds unavailable; no synthetic records are inserted. The map's explicitly selected simulation view is illustrative only and cannot be used to create visits, alerts, or exports.

## Future roadmap

- Phase 1: project foundation, architecture, and data access layer
- Phase 2: NASA FIRMS ingestion and validation
- Phase 3: harmonization and analytical processing
- Phase 4: Mozambique park map, dashboard, calendar, and analytics
- Phase 5: protected field verification, park alerts, reports, and exports
- Future: AI Assistant (planned, explicitly deferred)

For more detail, see [docs/roadmap.md](./docs/roadmap.md).

## Documentation

- [docs/architecture.md](./docs/architecture.md)
- [docs/data-sources.md](./docs/data-sources.md)
- [docs/harmonization-methodology.md](./docs/harmonization-methodology.md)
- [docs/api-documentation.md](./docs/api-documentation.md)
- [docs/development-guide.md](./docs/development-guide.md)

## Credits and attribution

This project is designed to present satellite fire-detection data responsibly and transparently. It uses NASA FIRMS for satellite thermal-anomaly observations, NASA EONET for open wildfire-event reports, and Microsoft Planetary Computer STAC for contextual product metadata and imagery. Preserve the source attribution and scientific caveats shown in [docs/data-sources.md](./docs/data-sources.md).
