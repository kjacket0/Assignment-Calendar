// One-off generator for the PWA app icons. Run with `node scripts/gen-icons.js`.
// Draws a flat rounded-square badge with a calendar-and-checkmark glyph,
// encoded as raw PNG via zlib — no image libraries, no external assets.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x1b, 0x7e, 0x23]; // IHCC green, matches default app accent
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

// Signed distance from (x,y) to a rounded rectangle's boundary — negative
// inside, positive outside, zero exactly on the edge. Standard formula
// (Inigo Quilez's sdRoundBox), so "on the stroke" is just |sdf| <= half
// the desired line width — no separate inner/outer rect test needed.
function roundedRectSDF(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bx = (x1 - x0) / 2, by = (y1 - y0) / 2;
  const px = Math.abs(x - cx) - bx + r;
  const py = Math.abs(y - cy) - by + r;
  return Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
}

function onRoundedRectStroke(x, y, x0, y0, x1, y1, r, strokeW) {
  return Math.abs(roundedRectSDF(x, y, x0, y0, x1, y1, r)) <= strokeW / 2;
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const badgeRadius = size * 0.22;

  // Calendar-and-checkmark glyph, proportions carried over from an SVG
  // mockup (128x128 viewBox) — each coordinate below is that mockup's
  // value divided by 128, then scaled back up by the actual icon size.
  const bodyStroke = size * 0.0547;
  const body = { x0: size * 0.2031, y0: size * 0.2813, x1: size * 0.7969, y1: size * 0.7969, r: size * 0.0781 };
  const ringStroke = size * 0.0547;
  const ring1 = { x0: size * 0.3125, y0: size * 0.2031, x1: size * 0.3906, y1: size * 0.3594, r: size * 0.0391 };
  const ring2 = { x0: size * 0.6094, y0: size * 0.2031, x1: size * 0.6875, y1: size * 0.3594, r: size * 0.0391 };
  const headerY = size * 0.4219;
  const headerStroke = size * 0.0547;
  const checkStroke = size * 0.0703;
  const c1 = [size * 0.3281, size * 0.6094];
  const c2 = [size * 0.4531, size * 0.7188];
  const c3 = [size * 0.6875, size * 0.4844];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inSquare = roundedSquareMask(x, y, size, badgeRadius);
      let r, g, b, a;
      if (!inSquare) {
        r = g = b = 0; a = 0;
      } else {
        const onGlyph =
          onRoundedRectStroke(x, y, body.x0, body.y0, body.x1, body.y1, body.r, bodyStroke) ||
          onRoundedRectStroke(x, y, ring1.x0, ring1.y0, ring1.x1, ring1.y1, ring1.r, ringStroke) ||
          onRoundedRectStroke(x, y, ring2.x0, ring2.y0, ring2.x1, ring2.y1, ring2.r, ringStroke) ||
          (x >= body.x0 && x <= body.x1 && Math.abs(y - headerY) <= headerStroke / 2) ||
          distToSeg(x, y, c1[0], c1[1], c2[0], c2[1]) <= checkStroke / 2 ||
          distToSeg(x, y, c2[0], c2[1], c3[0], c3[1]) <= checkStroke / 2;
        if (onGlyph) {
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
