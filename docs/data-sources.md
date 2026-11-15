# Data sources

## NASA FIRMS

FIRMS is the source for satellite active-fire and thermal-anomaly observations. The live near-real-time CSV streams supported by this application are `MODIS_NRT`, `VIIRS_SNPP_NRT`, and `VIIRS_NOAA20_NRT`. Direct feed access requires a valid `FIRMS_MAP_KEY`.

Without a key, these FIRMS feeds report `credentials_required`; the application does not fabricate replacement MODIS/VIIRS observations. Configure `FIRMS_MAP_KEY` in the project-root `.env` and restart the backend to activate them.

For quota efficiency, each sync makes one request per FIRMS feed over Mozambique's national bbox (`30.2,-26.9,40.9,-10.4`), not one request per park. NASA FIRMS observations are selected by in-memory point-in-polygon filtering against the currently selected mapped protected area after retrieval.

## NASA EONET

The application also polls NASA's public EONET open-wildfire event catalog without a key. EONET reports natural-event geometries and event/source metadata; it is not a thermal-anomaly feed and does not provide FIRMS sensor, FRP, or confidence measurements. EONET records are identified as `EONET` and are excluded from MODIS/VIIRS sensor analytics and alert threshold evaluation.

## Microsoft Planetary Computer STAC

STAC searches are performed on demand for the `modis-14A1-061`, `modis-14A2-061`, `sentinel-2-l2a`, and `landsat-c2-l2` collections. These search results and their assets/preview links provide imagery and product context; they are not counted as fire detections. STAC availability depends on the public service and the requested collection, time range, and spatial extent.

## Provenance and scientific caveats

- Preserve original feed identifiers, sensor/product metadata, observation times, coordinates, and available confidence/FRP fields.
- EONET's representative point for non-point geometries is the mean of the source coordinates; the original event geometry remains available for mapping and export.
- Keep EONET event reports distinct from satellite observations in counts, charts, reports, and alerts.
- Different sensors have different resolution, overpass timing, confidence definitions, and processing streams. A cross-sensor spatial-temporal association is a candidate match, not ground-truth equivalence.
- A thermal anomaly or reported wildfire event is not, by itself, confirmation of a ground fire.

## Mozambique protected-area boundaries

The shared registry includes eight national parks, four wildlife reserves, and 13 forest reserves. It carries each area's source, license, and boundary-quality metadata through the `/parks` response and the global selector.

- National-park geometries are mapped boundaries from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0). Bazaruto is coarse and may be incomplete.
- Reserva Especial do Niassa uses OSM relation 6793881, named “Reserva do Niassa”; Reserva Nacional de Marromeu uses OSM way 1025552810, named “Marromeu Game Reserve.” These are mapped OSM polygons, not legal dispatch boundaries.
- The 13 forest-reserve geometries come from the Mozambique Forest Reserves dataset published through RCMRD OFESA and credited to Mozambique's National Directorate of Forests. The data are WDPA-derived and distributed as free/open for use with attribution. Forest-reserve province values remain unspecified in the application because the source used here does not establish them consistently.
- Reserva Parcial do Lago Niassa is represented by a clearly labeled approximate polygon connecting four vertices in Decree 59/2011. The polygon does not trace the shoreline or represent the contiguous land buffer.
- Reserva Nacional de Pomene is represented by a clearly labeled approximate rectangle centered on a documented reserve locator and scaled to its reported area; it is not a legal boundary.

All mapped boundaries are subject to source and positional limitations. Approximate extents are explicitly identified in map and field-visit metadata, and none should be treated as an authoritative operational boundary. Confirm boundary details with park authorities before dispatch.

## Source metadata

Each observation should retain:

- satellite or instrument
- product identifier
- processing stream
- acquisition timestamp
- confidence and FRP fields when available
- retrieval timestamp and source URL

## Scientific caveats

Different sensors have different resolution, overpass timing, confidence definitions, and processing streams. The platform should explicitly communicate those differences instead of collapsing them into a misleading single metric.
