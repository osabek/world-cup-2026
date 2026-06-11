/* Generates the app icons (soccer ball on a pitch) as PNGs — pure Node, no deps. */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const OUT = path.join(__dirname, "icons");
fs.mkdirSync(OUT, { recursive: true });

const lerp = (a, b, t) => a + (b - a) * t;
function inPolygon(px, py, pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    const s = Math.sign(cross);
    if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) return false; }
  }
  return true;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function regPoly(cx, cy, rad, n, rot) {
  const p = [];
  for (let k = 0; k < n; k++) { const a = rot + (k * 2 * Math.PI) / n; p.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); }
  return p;
}
function star(cx, cy, ro, ri, rot) {
  const p = [];
  for (let k = 0; k < 10; k++) { const r = k % 2 ? ri : ro; const a = rot + (k * Math.PI) / 5; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return p;
}

function drawIcon(size, { ballScale = 0.40, withStar = true } = {}) {
  const S = 3, W = size * S;                 // supersample
  const buf = Buffer.alloc(W * W * 3);
  const cx = W / 2, cy = W / 2;
  const ballR = W * ballScale;
  const pentR = ballR * 0.34;
  const pent = regPoly(cx, cy, pentR, 5, -Math.PI / 2);
  const seamThick = ballR * 0.05;
  const stCx = cx + W * 0.23, stCy = cy - W * 0.23;
  const stPts = withStar ? star(stCx, stCy, W * 0.085, W * 0.04, -Math.PI / 2) : null;

  for (let y = 0; y < W; y++) {
    const ty = y / W;
    // pitch gradient + subtle stripes
    let bg0 = lerp(0x2e, 0x1f, ty), bg1 = lerp(0x9e, 0x7a, ty), bg2 = lerp(0x44, 0x33, ty);
    const stripe = Math.sin(ty * Math.PI * 5) * 6;
    bg0 += stripe; bg1 += stripe; bg2 += stripe;
    for (let x = 0; x < W; x++) {
      let r, g, b;
      const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
      if (dist <= ballR) {
        // ball: white with black pentagon, seams, rim
        let black = false;
        if (inPolygon(x, y, pent)) black = true;
        if (!black) {
          for (let k = 0; k < 5; k++) {
            const ang = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
            const vx = cx + pentR * Math.cos(ang), vy = cy + pentR * Math.sin(ang);
            const ex = cx + ballR * Math.cos(ang), ey = cy + ballR * Math.sin(ang);
            if (distSeg(x, y, vx, vy, ex, ey) < seamThick) { black = true; break; }
          }
        }
        if (!black && dist > ballR * 0.93) black = true; // rim
        if (black) { r = 22; g = 22; b = 22; }
        else { const sh = 1 - (dy / ballR) * 0.10; r = g = b = Math.min(255, 248 * sh); } // subtle top-light
      } else {
        r = bg0; g = bg1; b = bg2;
      }
      // star on top
      if (stPts && inPolygon(x, y, stPts)) { r = 0xff; g = 0xc8; b = 0x3d; }
      const i = (y * W + x) * 3;
      buf[i] = Math.max(0, Math.min(255, r));
      buf[i + 1] = Math.max(0, Math.min(255, g));
      buf[i + 2] = Math.max(0, Math.min(255, b));
    }
  }

  // box-downsample S×S -> size
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const i = ((y * S + sy) * W + (x * S + sx)) * 3; r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const n = S * S, o = (y * size + x) * 3;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return encodePNG(size, size, out);
}

function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

const jobs = [
  ["icon-512.png", 512, { ballScale: 0.42, withStar: false }],
  ["icon-192.png", 192, { ballScale: 0.42, withStar: false }],
  ["apple-touch-icon.png", 180, { ballScale: 0.42, withStar: false }],
  ["icon-maskable-512.png", 512, { ballScale: 0.31, withStar: false }],
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size, opts));
  console.log("wrote icons/" + name + " (" + size + "px)");
}
