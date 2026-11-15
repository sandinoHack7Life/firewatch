import type { FireObservation } from '../services/api';

export type FirmsSensor = 'MODIS' | 'VIIRS';

export const FIRMS_SENSOR_COLORS: Readonly<Record<FirmsSensor, string>> = {
  MODIS: '#20B6D2',
  VIIRS: '#F4772E',
};

export function getFirmsSensor(
  record: Pick<FireObservation, 'instrument' | 'product' | 'feed' | 'satellite'>,
): FirmsSensor | null {
  const instrument = record.instrument.trim().toUpperCase();
  if (instrument === 'MODIS' || instrument === 'VIIRS') return instrument;

  const source = `${record.feed ?? ''} ${record.product ?? ''}`.toUpperCase();
  if (source.includes('MODIS')) return 'MODIS';
  if (source.includes('VIIRS')) return 'VIIRS';

  const satellite = record.satellite.trim().toUpperCase();
  if (satellite === 'AQUA' || satellite === 'TERRA') return 'MODIS';
  if (/^(SNPP|SUOMI\s*NPP|NOAA[\s-]?20|NOAA[\s-]?21|N20|N21)$/.test(satellite)) return 'VIIRS';

  return null;
}
