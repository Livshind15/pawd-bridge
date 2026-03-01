import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

// ── Types ────────────────────────────────────────────────────

export interface DeviceRecord {
  deviceId: string;
  name: string;
  pairedAt: string;   // ISO-8601
  lastSeen: string;   // ISO-8601
}

interface TokenPayload {
  sub: string;  // deviceId
  iat: number;  // issued-at  (seconds)
  exp: number;  // expiry     (seconds)
}

export interface VerifyResult {
  deviceId: string;
}

export interface RegisterResult {
  deviceToken: string;
  deviceId: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Standard base64-url encoding (no padding). */
function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode a base64-url string back to a Buffer. */
function base64urlDecode(str: string): Buffer {
  // Restore standard base64 chars and padding
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (b64.length % 4);
  if (pad < 4) b64 += '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

/** Atomically write JSON to a file with restrictive permissions (0600). */
function writeJsonSync(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(filePath, content, { mode: 0o600 });
  try { chmodSync(filePath, 0o600); } catch { /* best-effort on platforms that don't support chmod */ }
}

/** Read and parse a JSON file, returning undefined on any failure. */
function readJsonSync<T = unknown>(filePath: string): T | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

// ── DeviceManager ────────────────────────────────────────────

export class DeviceManager {
  private readonly authDir: string;
  private readonly secretPath: string;
  private readonly pairingPath: string;
  private readonly devicesPath: string;

  private bridgeSecret!: Buffer;          // 64 random bytes — HMAC key
  private pairingSecret!: string;         // 32-char hex — shown to user for pairing
  private devices: DeviceRecord[] = [];

  constructor(dataDir: string) {
    this.authDir     = join(dataDir, 'auth');
    this.secretPath  = join(this.authDir, 'bridge-secret.json');
    this.pairingPath = join(this.authDir, 'pairing-secret.json');
    this.devicesPath = join(this.authDir, 'devices.json');

    this.init();
  }

  // ── Initialisation ───────────────────────────────────────

  private init(): void {
    // Ensure the auth directory exists with tight permissions.
    if (!existsSync(this.authDir)) {
      mkdirSync(this.authDir, { recursive: true });
    }

    this.loadOrGenerateBridgeSecret();
    this.loadOrGeneratePairingSecret();
    this.loadDeviceRegistry();
  }

  /** Load the 64-byte HMAC signing secret, or generate and persist a new one. */
  private loadOrGenerateBridgeSecret(): void {
    const stored = readJsonSync<{ secret: string }>(this.secretPath);
    if (stored?.secret) {
      this.bridgeSecret = Buffer.from(stored.secret, 'hex');
      if (this.bridgeSecret.length === 64) return;
      // Length mismatch — regenerate.
    }
    this.bridgeSecret = randomBytes(64);
    writeJsonSync(this.secretPath, { secret: this.bridgeSecret.toString('hex') });
  }

  /**
   * Load or generate the pairing secret.
   * The pairing secret is always kept on disk so it survives restarts
   * and can be displayed to the user at any time.
   */
  private loadOrGeneratePairingSecret(): void {
    const stored = readJsonSync<{ pairingSecret: string }>(this.pairingPath);
    if (stored?.pairingSecret && typeof stored.pairingSecret === 'string' && stored.pairingSecret.length === 32) {
      this.pairingSecret = stored.pairingSecret;
      return;
    }
    // 16 random bytes → 32 hex characters
    this.pairingSecret = randomBytes(16).toString('hex');
    writeJsonSync(this.pairingPath, { pairingSecret: this.pairingSecret });
  }

  /** Load the device registry from disk. */
  private loadDeviceRegistry(): void {
    const stored = readJsonSync<DeviceRecord[]>(this.devicesPath);
    if (Array.isArray(stored)) {
      this.devices = stored;
    } else {
      this.devices = [];
      this.persistDevices();
    }
  }

  /** Flush the current in-memory device list to disk. */
  private persistDevices(): void {
    writeJsonSync(this.devicesPath, this.devices);
  }

  // ── Token Signing & Verification ─────────────────────────

  /**
   * Create an HMAC-SHA256 signed device token.
   *
   * Format:  <base64url-payload>.<base64url-signature>
   *
   * Payload JSON: { sub: deviceId, iat: <seconds>, exp: iat + 365*86400 }
   */
  signDeviceToken(deviceId: string): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 365 * 86400; // 1 year

    const payload: TokenPayload = { sub: deviceId, iat, exp };
    const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf-8'));

    const sig = createHmac('sha256', this.bridgeSecret)
      .update(payloadB64, 'utf-8')
      .digest();
    const sigB64 = base64url(sig);

    return `${payloadB64}.${sigB64}`;
  }

  /**
   * Verify an HMAC-SHA256 signed device token.
   *
   * Returns { deviceId } on success, or null if the token is invalid,
   * expired, or the device is no longer in the registry.
   */
  verifyDeviceToken(token: string): VerifyResult | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts;

    // Recompute the expected signature.
    const expectedSig = base64url(
      createHmac('sha256', this.bridgeSecret)
        .update(payloadB64, 'utf-8')
        .digest(),
    );

    // Constant-time comparison to prevent timing attacks.
    const a = Buffer.from(sigB64, 'utf-8');
    const b = Buffer.from(expectedSig, 'utf-8');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    // Decode and validate the payload.
    let payload: TokenPayload;
    try {
      payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8')) as TokenPayload;
    } catch {
      return null;
    }

    if (!payload.sub || typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number') return null;

    // Check expiry.
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) return null;

    // Ensure the device is still registered.
    const registered = this.devices.some((d) => d.deviceId === payload.sub);
    if (!registered) return null;

    // Update lastSeen timestamp.
    const device = this.devices.find((d) => d.deviceId === payload.sub);
    if (device) {
      device.lastSeen = new Date().toISOString();
      this.persistDevices();
    }

    return { deviceId: payload.sub };
  }

  // ── Device Registration & Management ─────────────────────

  /**
   * Register a new device.
   *
   * The caller must present the correct pairing secret (displayed in the
   * bridge UI / logs). On success, a new device record is persisted and a
   * signed token is returned.
   */
  registerDevice(pairingSecret: string, deviceName: string): RegisterResult | null {
    // Constant-time comparison of pairing secret to prevent timing attacks.
    const expected = Buffer.from(this.pairingSecret, 'utf-8');
    const received = Buffer.from(String(pairingSecret), 'utf-8');
    if (expected.length !== received.length) return null;
    if (!timingSafeEqual(expected, received)) return null;

    const deviceId = randomUUID();
    const now = new Date().toISOString();

    const record: DeviceRecord = {
      deviceId,
      name: deviceName || 'Unnamed Device',
      pairedAt: now,
      lastSeen: now,
    };

    this.devices.push(record);
    this.persistDevices();

    const deviceToken = this.signDeviceToken(deviceId);

    return { deviceToken, deviceId };
  }

  /**
   * Return the current pairing secret.
   * This is always available so multiple devices can pair at any time.
   */
  getPairingSecret(): string {
    return this.pairingSecret;
  }

  /** List all registered devices (safe — no secrets are included). */
  listDevices(): DeviceRecord[] {
    return this.devices.map((d) => ({ ...d }));
  }

  /** Revoke (remove) a device from the registry by deviceId. */
  revokeDevice(deviceId: string): boolean {
    const idx = this.devices.findIndex((d) => d.deviceId === deviceId);
    if (idx === -1) return false;
    this.devices.splice(idx, 1);
    this.persistDevices();
    return true;
  }

  /** Whether at least one device is currently registered. */
  hasDevices(): boolean {
    return this.devices.length > 0;
  }
}
