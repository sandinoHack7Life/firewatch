import { useOutletContext } from 'react-router-dom';

import type { GlobalQuery, Telemetry } from '../../services/api';

export interface OperationalContextValue {
  filters: GlobalQuery & { region: string };
  setMapBounds: (bbox: string) => void;
  telemetry: Telemetry | null;
  telemetryError: string | null;
  refreshTelemetry: () => Promise<void>;
}

export function useOperationalContext(): OperationalContextValue {
  return useOutletContext<OperationalContextValue>();
}
