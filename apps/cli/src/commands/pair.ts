import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { createHash, createPublicKey } from 'crypto';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { IDENTITY_FILE, PAIRING_SECRET_FILE } from '../lib/paths.js';
import { checkPort } from '../lib/ports.js';
import { getStoredSubdomain } from '../lib/subdomain.js';

/** The fixed SPKI prefix for Ed25519 public keys (12 bytes). */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Extract the raw 32-byte Ed25519 public key from a PEM string. */
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

/** SHA-256 hash of the raw public key bytes -> hex string. */
function deriveDeviceId(rawPublicKey: Buffer): string {
  return createHash('sha256').update(rawPublicKey).digest('hex');
}

interface PairInfo {
  bridgeUrl: string;
  pairingSecret: string;
  deviceId: string | null;
}

/** Try to get pairing info from the running bridge API. */
async function fetchFromBridge(port: number): Promise<{ bridgeUrl: string; pairingSecret: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}/api/devices/pair-info`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as Record<string, string>;
      return {
        bridgeUrl: data.bridgeUrl || `http://localhost:${port}`,
        pairingSecret: data.pairingSecret || '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read pairing info from files on disk. */
function readFromDisk(): { bridgeUrl: string; pairingSecret: string } | null {
  if (!existsSync(PAIRING_SECRET_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(PAIRING_SECRET_FILE, 'utf-8'));
    if (!data.pairingSecret) return null;
    return {
      bridgeUrl: 'http://localhost:3001',
      pairingSecret: data.pairingSecret,
    };
  } catch {
    return null;
  }
}

/** Read device identity and compute deviceId. */
function readDeviceId(): string | null {
  if (!existsSync(IDENTITY_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
    if (!data.publicKeyPem) return null;
    const rawPub = extractRawPublicKey(data.publicKeyPem);
    return deriveDeviceId(rawPub);
  } catch {
    return null;
  }
}

export function pairCommand(): Command {
  return new Command('pair')
    .description('Show pairing QR code and device ID')
    .option('--json', 'Output as JSON')
    .option('--no-qr', 'Skip QR code display')
    .option('--port <port>', 'Bridge port to query', '3001')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);

      // Try bridge API first, then fall back to disk
      let pairSource: { bridgeUrl: string; pairingSecret: string } | null = null;
      const bridgeUp = await checkPort(port);
      if (bridgeUp) {
        pairSource = await fetchFromBridge(port);
      }
      if (!pairSource) {
        pairSource = readFromDisk();
      }

      if (!pairSource || !pairSource.pairingSecret) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'Pairing info not available' }));
        } else {
          console.log(chalk.red('\n  Pairing info not available.'));
          console.log(chalk.dim('  Start the bridge first: pawd start'));
          console.log(chalk.dim('  Or ensure pairing secret exists at:'));
          console.log(chalk.dim(`    ${PAIRING_SECRET_FILE}\n`));
        }
        process.exit(1);
      }

      const { bridgeUrl, pairingSecret } = pairSource;
      const deviceId = readDeviceId();

      // Use subdomain URL if available
      const subdomain = getStoredSubdomain();
      const effectiveBridgeUrl = subdomain
        ? `https://${subdomain.fullDomain}`
        : bridgeUrl;

      // JSON output mode
      if (opts.json) {
        const output: PairInfo = { bridgeUrl: effectiveBridgeUrl, pairingSecret, deviceId };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Pretty output
      console.log(chalk.bold('\n  Pawd Bridge — Pairing\n'));

      if (deviceId) {
        console.log(`  ${chalk.dim('Device ID:')}  ${chalk.cyan(deviceId)}`);
      } else {
        console.log(`  ${chalk.dim('Device ID:')}  ${chalk.yellow('not yet generated (start bridge first)')}`);
      }

      console.log(`  ${chalk.dim('Bridge URL:')} ${chalk.white(effectiveBridgeUrl)}`);
      if (subdomain) {
        console.log(`  ${chalk.dim('Subdomain:')}  ${chalk.cyan(subdomain.fullDomain)}`);
      }
      console.log(`  ${chalk.dim('Secret:')}     ${chalk.white(pairingSecret)}`);

      // QR code
      if (opts.qr !== false) {
        const qrPayload = JSON.stringify({ bridgeUrl: effectiveBridgeUrl, secret: pairingSecret });
        console.log('');
        await new Promise<void>((resolve) => {
          qrcode.generate(qrPayload, { small: true }, (qr: string) => {
            // Indent each line of the QR code
            const indented = qr
              .split('\n')
              .map((line: string) => `  ${line}`)
              .join('\n');
            console.log(indented);
            resolve();
          });
        });
      }

      console.log('');
      console.log(chalk.dim('  Scan the QR code with the Pawd app to pair this device.'));
      if (deviceId) {
        console.log(chalk.dim(`  Or run: ${chalk.white(`pawd devices approve ${deviceId}`)}`));
      }
      console.log('');
    });
}
