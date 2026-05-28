/**
 * Generates PWA PNG icons from raw pixel data.
 * Produces 192x192 and 512x512 icons with Swell branding (#060d1a bg + #ff6b35 coral Q).
 * Runs during build — no external dependencies (uses only Node built-ins).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

function createPNG(size) {
  const bg = { r: 6, g: 13, b: 26 };       // #060d1a
  const coral = { r: 255, g: 107, b: 53 };  // #ff6b35
  const coralLight = { r: 255, g: 140, b: 90 }; // #ff8c5a

  // Create raw pixel data (RGBA)
  const pixels = Buffer.alloc(size * size * 4);

  const cx = size / 2;
  const cy = size * 0.45; // Q center slightly above middle
  const outerR = size * 0.235;
  const innerR = outerR - size * 0.04;
  const strokeW = size * 0.04;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Gradient factor for coral (top-left to bottom-right)
      const gf = (x + y) / (size * 2);
      const cr = Math.round(coral.r + (coralLight.r - coral.r) * gf);
      const cg = Math.round(coral.g + (coralLight.g - coral.g) * gf);
      const cb = Math.round(coral.b + (coralLight.b - coral.b) * gf);

      // Q circle ring
      const ringDist = Math.abs(dist - (outerR + innerR) / 2);
      const halfStroke = strokeW;

      // Q tail: diagonal line from bottom-right of circle
      const tailStartX = cx + outerR * 0.5;
      const tailStartY = cy + outerR * 0.65;
      const tailEndX = cx + outerR * 1.1;
      const tailEndY = cy + outerR * 1.35;
      const tailDx = tailEndX - tailStartX;
      const tailDy = tailEndY - tailStartY;
      const tailLen = Math.sqrt(tailDx * tailDx + tailDy * tailDy);
      const tailNx = -tailDy / tailLen;
      const tailNy = tailDx / tailLen;
      const projAlong = ((x - tailStartX) * tailDx + (y - tailStartY) * tailDy) / (tailLen * tailLen);
      const projPerp = Math.abs((x - tailStartX) * tailNx + (y - tailStartY) * tailNy);
      const isTail = projAlong >= -0.05 && projAlong <= 1.05 && projPerp < halfStroke;

      // Anti-aliased ring
      const ringAA = Math.max(0, 1 - Math.max(0, ringDist - halfStroke + 1));

      if (ringAA > 0 || isTail) {
        const alpha = isTail ? 1 : ringAA;
        pixels[idx]     = Math.round(bg.r * (1 - alpha) + cr * alpha);
        pixels[idx + 1] = Math.round(bg.g * (1 - alpha) + cg * alpha);
        pixels[idx + 2] = Math.round(bg.b * (1 - alpha) + cb * alpha);
        pixels[idx + 3] = 255;
      } else {
        // Background
        pixels[idx]     = bg.r;
        pixels[idx + 1] = bg.g;
        pixels[idx + 2] = bg.b;
        pixels[idx + 3] = 255;
      }
    }
  }

  // Encode as PNG
  // PNG filter: none (0) per row
  const rawData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0; // filter byte: none
    pixels.copy(rawData, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuffer, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuffer, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend)
  ]);
}

// CRC32 implementation for PNG chunks
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate both sizes
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

for (const size of [192, 512]) {
  const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
  console.log(`Generating ${size}x${size} icon...`);
  const png = createPNG(size);
  fs.writeFileSync(outPath, png);
  console.log(`  -> ${outPath} (${png.length} bytes)`);
}

console.log('PWA icons generated.');
