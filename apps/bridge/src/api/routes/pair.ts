import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import {
  getPairingSecret,
  registerDevice,
  listDevices,
  revokeDevice,
} from '../../auth/index.js';
import { logger } from '../../utils/logger.js';

// ── QR SVG Generator ────────────────────────────────────────
//
// Minimal QR Code encoder targeting Mode Byte (ISO 18004), version 1-6,
// error-correction level L.  This is intentionally self-contained so the
// bridge has zero runtime dependencies for QR generation.

/** Galois-field arithmetic helpers for GF(2^8) with polynomial 0x11d. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generate Reed-Solomon error-correction codewords. */
function rsEncode(data: number[], ecCount: number): number[] {
  // Build generator polynomial
  let gen = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
    }
    gen = next;
  }

  const msg = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// ── QR version tables (byte mode, EC level L) ──────────────

interface QRVersion {
  version: number;
  size: number;
  dataCapacity: number;   // total data codewords
  ecPerBlock: number;     // EC codewords per block
  blocks: number;         // number of blocks
  alignmentPatterns: number[];
}

const QR_VERSIONS: QRVersion[] = [
  { version: 1,  size: 21, dataCapacity: 19,  ecPerBlock: 7,  blocks: 1, alignmentPatterns: [] },
  { version: 2,  size: 25, dataCapacity: 34,  ecPerBlock: 10, blocks: 1, alignmentPatterns: [18] },
  { version: 3,  size: 29, dataCapacity: 55,  ecPerBlock: 15, blocks: 1, alignmentPatterns: [22] },
  { version: 4,  size: 33, dataCapacity: 80,  ecPerBlock: 20, blocks: 1, alignmentPatterns: [26] },
  { version: 5,  size: 37, dataCapacity: 108, ecPerBlock: 26, blocks: 1, alignmentPatterns: [30] },
  { version: 6,  size: 41, dataCapacity: 136, ecPerBlock: 18, blocks: 2, alignmentPatterns: [34] },
  { version: 7,  size: 45, dataCapacity: 156, ecPerBlock: 20, blocks: 2, alignmentPatterns: [6, 22, 38] },
  { version: 8,  size: 49, dataCapacity: 194, ecPerBlock: 24, blocks: 2, alignmentPatterns: [6, 24, 42] },
  { version: 9,  size: 53, dataCapacity: 232, ecPerBlock: 30, blocks: 2, alignmentPatterns: [6, 26, 46] },
  { version: 10, size: 57, dataCapacity: 271, ecPerBlock: 18, blocks: 4, alignmentPatterns: [6, 28, 50] },
];

function pickVersion(byteLen: number): QRVersion {
  for (const v of QR_VERSIONS) {
    // Byte mode overhead: 4 bits mode + length bits + data + terminator
    const lengthBits = v.version <= 9 ? 8 : 16;
    const availBits = v.dataCapacity * 8;
    const needed = 4 + lengthBits + byteLen * 8;
    if (needed <= availBits) return v;
  }
  return QR_VERSIONS[QR_VERSIONS.length - 1];
}

/** Encode data bytes into QR codewords (data + EC) for the given version. */
function encodeData(bytes: number[], ver: QRVersion): number[] {
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Mode indicator: 0100 = byte mode
  pushBits(0b0100, 4);
  // Character count
  const lengthBits = ver.version <= 9 ? 8 : 16;
  pushBits(bytes.length, lengthBits);
  // Data
  for (const b of bytes) pushBits(b, 8);
  // Terminator (up to 4 zeros)
  const maxBits = ver.dataCapacity * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad codewords
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[pi % 2], 8);
    pi++;
  }

  // Convert bits to codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    codewords.push(byte);
  }

  // Split into blocks and compute EC
  const blockSize = Math.floor(ver.dataCapacity / ver.blocks);
  const remainder = ver.dataCapacity % ver.blocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < ver.blocks; b++) {
    const sz = blockSize + (b >= ver.blocks - remainder ? 1 : 0);
    const block = codewords.slice(offset, offset + sz);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ver.ecPerBlock));
    offset += sz;
  }

  // Interleave data blocks
  const result: number[] = [];
  const maxDataBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  // Interleave EC blocks
  for (let i = 0; i < ver.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  return result;
}

/** Place modules on the QR matrix and return the 2D grid (true = dark). */
function buildMatrix(codewords: number[], ver: QRVersion): boolean[][] {
  const size = ver.size;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // ── Finder patterns (7x7) at three corners ──
  const drawFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isDark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        grid[rr][cc] = isDark;
        reserved[rr][cc] = true;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // ── Alignment patterns ──
  if (ver.alignmentPatterns.length > 0) {
    const centers: [number, number][] = [];
    const aps = ver.version >= 7 ? ver.alignmentPatterns : [6, ...ver.alignmentPatterns];
    for (const r of aps) {
      for (const c of aps) {
        // Skip if overlapping finder patterns
        if (r <= 8 && c <= 8) continue;
        if (r <= 8 && c >= size - 8) continue;
        if (r >= size - 8 && c <= 8) continue;
        centers.push([r, c]);
      }
    }
    for (const [cr, cc] of centers) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = cr + dr, rc = cc + dc;
          if (rr < 0 || rr >= size || rc < 0 || rc >= size) continue;
          grid[rr][rc] =
            Math.abs(dr) === 2 || Math.abs(dc) === 2 ||
            (dr === 0 && dc === 0);
          reserved[rr][rc] = true;
        }
      }
    }
  }

  // ── Timing patterns ──
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    reserved[6][i] = true;
    grid[i][6] = i % 2 === 0;
    reserved[i][6] = true;
  }

  // ── Dark module ──
  grid[size - 8][8] = true;
  reserved[size - 8][8] = true;

  // ── Reserve format info areas ──
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = true;
    reserved[8][size - 1 - i] = true;
    reserved[i][8] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[8][8] = true;

  // ── Reserve version info areas (versions >= 7) ──
  if (ver.version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = true;
        reserved[size - 11 + j][i] = true;
      }
    }
  }

  // ── Place data bits ──
  const totalBits = codewords.length * 8;
  let bitIdx = 0;
  let col = size - 1;
  let goingUp = true;

  while (col >= 0) {
    if (col === 6) col--; // skip timing column
    const rows = goingUp
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || reserved[row][c]) continue;
        if (bitIdx < totalBits) {
          const codewordIdx = Math.floor(bitIdx / 8);
          const bitPos = 7 - (bitIdx % 8);
          grid[row][c] = ((codewords[codewordIdx] >> bitPos) & 1) === 1;
          bitIdx++;
        }
        reserved[row][c] = true; // mark as placed
      }
    }
    col -= 2;
    goingUp = !goingUp;
  }

  // ── Apply mask pattern 0 (checkerboard: (row + col) % 2 === 0) ──
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Only XOR data modules (not reserved from finder/timing/alignment)
      // We re-check the original "reserved" before data placement.
      // Since we used reserved[][] for both purposes, we need a second pass.
      // The simplest correct approach: mask all modules that aren't part of
      // function patterns. We do this by re-drawing function patterns after masking.
    }
  }

  // Simpler approach: apply mask to ALL modules, then re-draw function patterns.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if ((r + c) % 2 === 0) {
        grid[r][c] = !grid[r][c];
      }
    }
  }

  // Re-draw function patterns on top
  const drawFinder2 = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isDark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        grid[rr][cc] = isDark;
      }
    }
  };
  drawFinder2(0, 0);
  drawFinder2(0, size - 7);
  drawFinder2(size - 7, 0);

  // Re-draw timing
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Re-draw dark module
  grid[size - 8][8] = true;

  // Re-draw alignment
  if (ver.alignmentPatterns.length > 0) {
    const aps = ver.version >= 7 ? ver.alignmentPatterns : [6, ...ver.alignmentPatterns];
    for (const cr of aps) {
      for (const cc of aps) {
        if (cr <= 8 && cc <= 8) continue;
        if (cr <= 8 && cc >= size - 8) continue;
        if (cr >= size - 8 && cc <= 8) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = cr + dr, rc = cc + dc;
            if (rr < 0 || rr >= size || rc < 0 || rc >= size) continue;
            grid[rr][rc] =
              Math.abs(dr) === 2 || Math.abs(dc) === 2 ||
              (dr === 0 && dc === 0);
          }
        }
      }
    }
  }

  // ── Format info (mask 0, EC level L = 01) ──
  // Pre-computed format bits for EC-L + mask 0 = 0b01_000 -> after BCH: 0x77C0
  // Actually the standard format string for (L, mask 0) is: 111011111000100
  const formatBits = 0b111011111000100;
  // Place format info around finder patterns
  const formatPositions1: [number, number][] = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  const formatPositions2: [number, number][] = [
    [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4],
    [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
    [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8],
    [size - 3, 8], [size - 2, 8], [size - 1, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> (14 - i)) & 1) === 1;
    const [r1, c1] = formatPositions1[i];
    grid[r1][c1] = bit;
    const [r2, c2] = formatPositions2[i];
    grid[r2][c2] = bit;
  }

  return grid;
}

/** Generate an SVG string for the given text. */
function generateQRSvg(text: string, moduleSize = 4, quietZone = 4): string {
  const bytes = Array.from(Buffer.from(text, 'utf-8'));
  const ver = pickVersion(bytes.length);
  const codewords = encodeData(bytes, ver);
  const matrix = buildMatrix(codewords, ver);

  const size = ver.size;
  const svgSize = (size + quietZone * 2) * moduleSize;

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        const x = (c + quietZone) * moduleSize;
        const y = (r + quietZone) * moduleSize;
        rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<g fill="#000">`,
    ...rects,
    `</g>`,
    `</svg>`,
  ].join('\n');
}

// ── HTML page ───────────────────────────────────────────────

function buildPairingPage(
  bridgeUrl: string,
  pairingSecret: string,
  deviceCount: number,
  qrSvg: string,
): string {
  const escapedSecret = pairingSecret.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const escapedUrl = bridgeUrl.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pawd Bridge Pairing</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:#0a0a0a;color:#fff;
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;padding:2rem;
  }
  .card{
    max-width:420px;width:100%;text-align:center;
  }
  h1{font-size:1.4rem;font-weight:600;margin-bottom:.25rem}
  .subtitle{color:#888;font-size:.85rem;margin-bottom:1.5rem}
  .qr-wrap{
    background:#fff;border-radius:12px;padding:16px;
    display:inline-block;margin-bottom:1.5rem;
  }
  .qr-wrap svg{display:block;width:240px;height:240px}
  .secret-label{color:#888;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem}
  .secret{
    font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;
    font-size:1.1rem;letter-spacing:.12em;word-break:break-all;
    margin-bottom:.75rem;
  }
  .copy-btn{
    background:#222;border:1px solid #333;color:#fff;
    padding:.45rem 1.2rem;border-radius:6px;cursor:pointer;
    font-size:.8rem;transition:background .15s;
    margin-bottom:1.5rem;
  }
  .copy-btn:hover{background:#333}
  .meta{color:#666;font-size:.75rem;line-height:1.6}
  .meta span{color:#888}
</style>
</head>
<body>
<div class="card">
  <h1>Scan with Pawd to pair</h1>
  <p class="subtitle">${deviceCount} device${deviceCount !== 1 ? 's' : ''} currently paired</p>
  <div class="qr-wrap">${qrSvg}</div>
  <p class="secret-label">Pairing Secret</p>
  <p class="secret" id="secret">${escapedSecret}</p>
  <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapedSecret}').then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy secret'},1500)})">Copy secret</button>
  <div class="meta">
    <p>Bridge URL: <span>${escapedUrl}</span></p>
  </div>
</div>
</body>
</html>`;
}

// ── Route registration ──────────────────────────────────────

export function pairRoutes(fastify: FastifyInstance): void {
  // ── GET /pair — Self-contained HTML pairing page ──────────
  fastify.get('/pair', async (request, reply) => {
    const hostname = request.hostname.split(':')[0]; // strip port if present
    const bridgeUrl = `https://${hostname}`;
    const pairingSecret = getPairingSecret();
    const devices = listDevices();

    const qrPayload = JSON.stringify({ bridgeUrl, secret: pairingSecret });
    const qrSvg = generateQRSvg(qrPayload);

    const html = buildPairingPage(bridgeUrl, pairingSecret, devices.length, qrSvg);
    return reply.type('text/html').send(html);
  });

  // ── GET /api/devices/pair-info — Public JSON pairing info ─
  fastify.get('/api/devices/pair-info', async (request) => {
    const hostname = request.hostname.split(':')[0];
    const bridgeUrl = `https://${hostname}`;
    return {
      bridgeUrl,
      pairingSecret: getPairingSecret(),
    };
  });

  // ── POST /api/devices/pair — Pair a new device (public) ───
  fastify.post('/api/devices/pair', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.pairingSecret !== 'string') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing pairingSecret in request body' } });
    }

    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : 'Unnamed Device';
    const result = registerDevice(body.pairingSecret, deviceName);

    if (!result) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid pairing secret' } });
    }

    logger.info({ deviceId: result.deviceId, deviceName }, 'New device paired');
    return { deviceToken: result.deviceToken, deviceId: result.deviceId };
  });

  // ── GET /api/devices — List paired devices (auth required) ─
  fastify.get('/api/devices', async () => {
    return { devices: listDevices() };
  });

  // ── DELETE /api/devices/:deviceId — Revoke a device (auth) ─
  fastify.delete<{ Params: { deviceId: string } }>(
    '/api/devices/:deviceId',
    async (request, reply) => {
      const { deviceId } = request.params;
      const removed = revokeDevice(deviceId);
      if (!removed) {
        return reply.status(404).send({ error: 'Device not found' });
      }
      logger.info({ deviceId }, 'Device revoked');
      return { ok: true };
    },
  );
}
