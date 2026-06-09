/**
 * 生成 248x248 应用图标（零依赖纯 Node + zlib 编码 PNG）
 * 风格对齐系统圆形扁平图标：满底色渐变圆（系统会裁成圆）+ 简洁白色计算器图形。
 * 输出覆盖 icon.png / assets/icon.png / assets/balance/icon.png
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SIZE = 248;
const buf = Buffer.alloc(SIZE * SIZE * 4); // RGBA

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function fillRect(x0, y0, w, h, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) setPx(x, y, r, g, b, a);
}
function fillCircle(cx, cy, rad, r, g, b, a) {
  const r2 = rad * rad;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPx(x, y, r, g, b, a);
    }
}
function roundRect(x0, y0, w, h, rad, r, g, b, a) {
  fillRect(x0 + rad, y0, w - 2 * rad, h, r, g, b, a);
  fillRect(x0, y0 + rad, w, h - 2 * rad, r, g, b, a);
  fillCircle(x0 + rad, y0 + rad, rad, r, g, b, a);
  fillCircle(x0 + w - rad, y0 + rad, rad, r, g, b, a);
  fillCircle(x0 + rad, y0 + h - rad, rad, r, g, b, a);
  fillCircle(x0 + w - rad, y0 + h - rad, rad, r, g, b, a);
}

// ── 橙色渐变圆（圆外透明，和系统圆形图标一致；不要满方块）──
const top = [0xFF, 0x9E, 0x52], bot = [0xEF, 0x72, 0x2C];
const CX = SIZE / 2, CY = SIZE / 2, R = 122, R2 = R * R;
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const r = Math.round(top[0] + (bot[0] - top[0]) * t);
  const g = Math.round(top[1] + (bot[1] - top[1]) * t);
  const b = Math.round(top[2] + (bot[2] - top[2]) * t);
  for (let x = 0; x < SIZE; x++) {
    const dx = x - CX, dy = y - CY;
    if (dx * dx + dy * dy <= R2) setPx(x, y, r, g, b, 255);   // 圆内填色，圆外保持透明
  }
}

// ── 白色计算器主体 ──
const bx = 70, by = 58, bw = 108, bh = 132;
roundRect(bx, by, bw, bh, 20, 0xFF, 0xFF, 0xFF, 255);

// 屏幕（深色）
const SCR = [0x32, 0x37, 0x40];
roundRect(bx + 13, by + 14, bw - 26, 30, 7, SCR[0], SCR[1], SCR[2], 255);

// 3x3 按钮圆点；右下角用橙色作为「=」点睛
const cols = [bx + 27, bx + 54, bx + 81];
const rows = [by + 70, by + 96, by + 122];
const dot = 8;
for (let ri = 0; ri < 3; ri++) {
  for (let ci = 0; ci < 3; ci++) {
    if (ri === 2 && ci === 2) fillCircle(cols[ci], rows[ri], dot, 0xEF, 0x72, 0x2C, 255);
    else fillCircle(cols[ci], rows[ri], dot, SCR[0], SCR[1], SCR[2], 255);
  }
}

// ── 编码 PNG ──
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const targets = [
  path.join(__dirname, 'icon.png'),
  path.join(__dirname, 'assets', 'icon.png'),
  path.join(__dirname, 'assets', 'balance', 'icon.png'),
];
for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, png);
  console.log('wrote', t, png.length, 'bytes');
}
