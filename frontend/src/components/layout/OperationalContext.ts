import { useOutletContext } from 'react-router-dom';

import type { GlobalQuery, NationalPark, ParkId, Telemetry } from '../../services/api';

export interface OperationalContextValue {
  filters: GlobalQuery & { region: string };
  setMapBounds: (bbox: string | undefined) => void;
  parks: NationalPark[];
  selectedPark: NationalPark | null;
  selectedParkId: ParkId;
  selectedParkLabel: string;
  telemetry: Telemetry | null;
  telemetryError: string | null;
  refreshTelemetry: () => Promise<void>;
}

export function useOperationalContext(): OperationalContextValue {
  return useOutletContext<OperationalContextValue>();
}
