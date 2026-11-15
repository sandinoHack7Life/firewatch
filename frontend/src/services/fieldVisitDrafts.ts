import type { FieldVisitPayload } from './api';

const STORAGE_KEY = 'firewatch.field-visits.drafts.v1';
const ENCRYPTION_CONTEXT = 'MODIS-VIIRS-FIREWATCH-FIELD-VISITS';

interface EncryptedDrafts {
  version: 1;
  iv: string;
  ciphertext: string;
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = window.atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function deriveEncryptionKey(accessKey: string): Promise<CryptoKey> {
  if (!window.crypto?.subtle) {
    throw new Error('Secure browser storage is unavailable; field visit drafts cannot be saved on this device.');
  }
  const keyMaterial = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ENCRYPTION_CONTEXT}:${accessKey}`),
  );
  return window.crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function isFieldVisitPayload(value: unknown): value is FieldVisitPayload {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.client_id === 'string'
    && typeof item.park_id === 'string'
    && typeof item.satellite_observation_id === 'string'
    && typeof item.satellite_feed === 'string'
    && typeof item.form_created_at_utc === 'string'
    && (item.scheduled_at_utc === null || typeof item.scheduled_at_utc === 'string')
    && (item.actual_visit_at_utc === null || typeof item.actual_visit_at_utc === 'string')
    && typeof item.status === 'string'
    && (item.observed_result === null || typeof item.observed_result === 'string')
    && (item.field_latitude === null || typeof item.field_latitude === 'number')
    && (item.field_longitude === null || typeof item.field_longitude === 'number')
    && typeof item.notes === 'string';
}

export async function loadFieldVisitDrafts(accessKey: string): Promise<FieldVisitPayload[]> {
  const serialized = window.localStorage.getItem(STORAGE_KEY);
  if (serialized === null) return [];

  const envelope = JSON.parse(serialized) as EncryptedDrafts;
  if (envelope.version !== 1 || !envelope.iv || !envelope.ciphertext) {
    throw new Error('The saved field visit draft data has an unsupported format.');
  }
  const key = await deriveEncryptionKey(accessKey);
  let cleartext: ArrayBuffer;
  try {
    cleartext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(decodeBase64(envelope.iv)) },
      key,
      decodeBase64(envelope.ciphertext),
    );
  } catch {
    throw new Error('The shared key could not unlock the field visit drafts on this device.');
  }

  const drafts: unknown = JSON.parse(new TextDecoder().decode(cleartext));
  if (!Array.isArray(drafts) || !drafts.every(isFieldVisitPayload)) {
    throw new Error('The saved field visit drafts are invalid and were not loaded.');
  }
  return drafts;
}

export async function saveFieldVisitDrafts(
  accessKey: string,
  drafts: FieldVisitPayload[],
): Promise<void> {
  const key = await deriveEncryptionKey(accessKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(drafts)),
  );
  const envelope: EncryptedDrafts = {
    version: 1,
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}
