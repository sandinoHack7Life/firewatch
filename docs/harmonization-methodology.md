# Harmonization methodology

## Goal

The core scientific goal of this platform is to compare MODIS and VIIRS detections in a transparent and explainable way without implying that one instrument is a perfect substitute for the other.

## Constraints

- Different sensors have different spatial resolution and detection characteristics.
- Observation timing differs by orbit and overpass schedule.
- Confidence definitions and product types vary by processing stream.
- Raw detections should never be silently merged without preserving provenance.

## Methodology

The platform will compute harmonized summaries from raw detections using configurable aggregation rules. Daily, weekly, and monthly totals will be reported separately for each sensor and in combined form when scientifically appropriate.

The methodology emphasizes:

- preserving original detections
- separating raw observations from harmonized summaries
- documenting assumptions and aggregation thresholds
- clearly labeling analytical outputs rather than factual sensor calibration

## Interpretation

Hotspot counts are not equivalent to burned area, and they do not represent confirmed fire ground truth. The platform should communicate this clearly in all charts, reports, and narrative summaries.

## AI assistant note

The AI Assistant is intentionally deferred. Results and analytics remain grounded in the scientific pipeline and not in AI-generated summaries.
