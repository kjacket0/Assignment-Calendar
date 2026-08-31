// One-off generator for the PWA app icons. Run with `node scripts/gen-icons.js`.
// Draws a flat rounded-square badge with a checkmark, encoded as raw PNG via zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x65, 0x06, 0x3e]; // brand wine, matches app accent
const WHITE = [245, 251, 245];

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function distToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function roundedSquareMask(x, y, size, radius) {
  // returns true if pixel (x,y) is inside a rounded square of given size/radius
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const strokeW = size * 0.09;
  // checkmark points (in a 0..1 box), thick stroke via distance to two segments
  const p1 = [size * 0.27, size * 0.53];
  const p2 = [size * 0.44, size * 0.70];
  const p3 = [size * 0.74, size * 0.32];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inSquare = roundedSquareMask(x, y, size, radius);
      let r, g, b, a;
      if (!inSquare) {
        r = g = b = 0; a = 0;
      } else {
        const d1 = distToSeg(x, y, p1[0], p1[1], p2[0], p2[1]);
        const d2 = distToSeg(x, y, p2[0], p2[1], p3[0], p3[1]);
        const onCheck = d1 <= strokeW / 2 || d2 <= strokeW / 2;
        if (onCheck) {
          r = WHITE[0]; g = WHITE[1]; b = WHITE[2]; a = 255;
        } else {
          r = BG[0]; g = BG[1]; b = BG[2]; a = 255;
        }
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
  console.log(`wrote icon-${size}.png`);
}
