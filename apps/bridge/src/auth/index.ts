import { config } from '../config.js';
import { DeviceManager } from './device-manager.js';
import type { DeviceRecord, VerifyResult, RegisterResult } from './device-manager.js';

// ── Singleton ────────────────────────────────────────────────

export const deviceManager = new DeviceManager(config.dataDir);

// ── Convenience re-exports ───────────────────────────────────

export function verifyDeviceToken(token: string): VerifyResult | null {
  return deviceManager.verifyDeviceToken(token);
}

export function registerDevice(pairingSecret: string, deviceName: string): RegisterResult | null {
  return deviceManager.registerDevice(pairingSecret, deviceName);
}

export function getPairingSecret(): string {
  return deviceManager.getPairingSecret();
}

export function listDevices(): DeviceRecord[] {
  return deviceManager.listDevices();
}

export function revokeDevice(deviceId: string): boolean {
  return deviceManager.revokeDevice(deviceId);
}

export function hasDevices(): boolean {
  return deviceManager.hasDevices();
}

// Re-export types for consumers.
export type { DeviceRecord, VerifyResult, RegisterResult } from './device-manager.js';
