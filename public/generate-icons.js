const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

function createIconSVG(size) {
  const radius = Math.round(size * 0.22);
  const stroke = Math.max(3, Math.round(size * 0.085));
  const accentStroke = Math.max(2, Math.round(stroke * 0.45));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    <linearGradient id="g" x1="${size * 0.12}" y1="${size * 0.08}" x2="${size * 0.92}" y2="${size * 0.95}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0f172a"/>
      <stop offset="0.52" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
  <path d="M${size * 0.25} ${size * 0.75}V${size * 0.25}L${size * 0.75} ${size * 0.75}V${size * 0.25}" stroke="white" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M${size * 0.30} ${size * 0.25}C${size * 0.42} ${size * 0.13} ${size * 0.58} ${size * 0.13} ${size * 0.70} ${size * 0.25}" stroke="white" stroke-opacity="0.68" stroke-width="${accentStroke}" stroke-linecap="round"/>
</svg>`;
}

async function main() {
  const iconsDir = path.join(__dirname, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  fs.writeFileSync(path.join(__dirname, 'logo.svg'), createIconSVG(32));
  fs.writeFileSync(path.join(__dirname, 'favicon.svg'), createIconSVG(32));
  fs.writeFileSync(path.join(iconsDir, 'icon-template.svg'), createIconSVG(512));

  for (const size of sizes) {
    const svg = createIconSVG(size);
    fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(iconsDir, `icon-${size}x${size}.png`));
  }

  for (const size of [32, 64, 128, 256, 512]) {
    await sharp(Buffer.from(createIconSVG(size))).png().toFile(path.join(__dirname, `logo-${size}.png`));
  }
  await sharp(Buffer.from(createIconSVG(32))).png().toFile(path.join(__dirname, 'favicon.png'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
