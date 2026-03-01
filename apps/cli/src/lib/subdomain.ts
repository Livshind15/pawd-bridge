import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { generateKeyPairSync, createHash, createPublicKey } from 'crypto';
import { SUBDOMAIN_FILE, IDENTITY_FILE } from './paths.js';

const SUPABASE_URL = 'https://nnhzfiifzcocvcpkweol.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uaHpmaWlmemNvY3ZjcGt3ZW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzk1NDksImV4cCI6MjA4NzM1NTU0OX0.Z_9r4FUKGNIx0kS5p1o8_O4K9FVb4dNPEo9RfkB8KaA';

/** The fixed SPKI prefix for Ed25519 public keys (12 bytes). */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface SubdomainInfo {
  subdomain: string;
  fullDomain: string;
  ip: string;
  provisionedAt: string;
}

/** Detect the machine's public IP address. */
export async function detectPublicIp(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`ipify returned ${res.status}`);
    const data = (await res.json()) as { ip: string };
    return data.ip;
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(
      `Failed to detect public IP: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
}

/** Extract raw 32-byte Ed25519 public key from a PEM string. */
function extractRawPublicKey(publicKeyPem: string): Buffer {
  const keyObj = createPublicKey(publicKeyPem);
  const spki = keyObj.export({ type: 'spki', format: 'der' }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

/** SHA-256 hash of the raw public key bytes -> hex device ID. */
function deriveDeviceIdFromKey(rawPublicKey: Buffer): string {
  return createHash('sha256').update(rawPublicKey).digest('hex');
}

/** Generate Ed25519 keypair and persist to identity file (same format as bridge). */
function generateIdentity(): string {
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const stored = {
    version: 2,
    algorithm: 'ed25519',
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  };

  const dir = dirname(IDENTITY_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(IDENTITY_FILE, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(IDENTITY_FILE, 0o600); } catch { /* best-effort */ }

  const rawPub = extractRawPublicKey(publicKeyPem);
  return deriveDeviceIdFromKey(rawPub);
}

/**
 * Get the device ID, generating the identity if it doesn't exist.
 * Always returns a device ID — never null.
 */
export function ensureDeviceId(): string {
  if (existsSync(IDENTITY_FILE)) {
    try {
      const data = JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
      if (data.publicKeyPem) {
        const rawPub = extractRawPublicKey(data.publicKeyPem);
        return deriveDeviceIdFromKey(rawPub);
      }
    } catch {
      // fall through to regenerate
    }
  }
  return generateIdentity();
}

/** Call the Supabase Edge Function to provision a subdomain. */
export async function provisionSubdomain(
  deviceId: string,
  ip: string
): Promise<SubdomainInfo> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/provision-subdomain`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId, ip }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Subdomain provisioning failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    success: boolean;
    subdomain: string;
    fullDomain: string;
    ip: string;
    error?: string;
  };

  if (!data.success) {
    throw new Error(data.error || 'Provisioning returned success=false');
  }

  const info: SubdomainInfo = {
    subdomain: data.subdomain,
    fullDomain: data.fullDomain,
    ip: data.ip,
    provisionedAt: new Date().toISOString(),
  };

  saveSubdomain(info);
  return info;
}

/** Read stored subdomain info from disk. */
export function getStoredSubdomain(): SubdomainInfo | null {
  if (!existsSync(SUBDOMAIN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SUBDOMAIN_FILE, 'utf-8')) as SubdomainInfo;
  } catch {
    return null;
  }
}

/** Save subdomain info to disk. */
export function saveSubdomain(info: SubdomainInfo): void {
  const dir = dirname(SUBDOMAIN_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SUBDOMAIN_FILE, JSON.stringify(info, null, 2), 'utf-8');
}
