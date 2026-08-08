import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { execSync } from 'child_process';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

/**
 * Generate the Planrla logo/icon SVG.
 *
 * The P shape and the arc above it are shifted upward compared with the
 * original layout so that the blank area at the top of the logo is reduced.
 * In the 32x32 base coordinate system the arc peak moved from y=4.16 to
 * y=1.66 (a 2.5 unit reduction in top margin).
 */
function createIconSVG(size) {
  const radius = Math.round(size * 0.22);
  const stroke = Math.max(3, Math.round(size * 0.085));
  const accentStroke = Math.max(2, Math.round(stroke * 0.45));

  // P shape geometry (32px base values in comments)
  const pLeft = size * 0.3125; // 10
  const pRight = size * 0.53125; // 17
  const pTop = size * 0.171875; // 5.5 (was 8)
  const pBottom = size * 0.671875; // 21.5 (was 24)
  const bowlRx = size * 0.171875; // 5.5
  const bowlHeight = size * 0.34375; // 11

  // Arc above the P (32px base values in comments)
  const arcLeft = size * 0.3; // 9.6
  const arcRight = size * 0.7; // 22.4
  const arcY = pTop; // arc endpoints align with the P top
  const arcPeak = size * 0.051875; // 1.66 (was 4.16)
  const arcCp1x = size * 0.42; // 13.44
  const arcCp2x = size * 0.58; // 18.56

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    <linearGradient id="g" x1="${size * 0.12}" y1="${size * 0.08}" x2="${size * 0.92}" y2="${size * 0.95}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0f172a"/>
      <stop offset="0.52" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
  <path d="M${pLeft} ${pBottom}V${pTop} H${pRight} a${bowlRx} ${bowlRx} 0 0 1 0 ${bowlHeight} H${pLeft}" stroke="white" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M${arcLeft} ${arcY}C${arcCp1x} ${arcPeak} ${arcCp2x} ${arcPeak} ${arcRight} ${arcY}" stroke="white" stroke-opacity="0.68" stroke-width="${accentStroke}" stroke-linecap="round"/>
</svg>`;
}

function generateIco(pngPath, icoPath) {
  const pyPath = path.join(path.dirname(pngPath), `.tmp-favicon-${Date.now()}.py`);
  const script = [
    'from PIL import Image',
    `img = Image.open(r'${pngPath.replace(/'/g, "\\'")}')`,
    `img.save(r'${icoPath.replace(/'/g, "\\'")}', format='ICO', sizes=[(img.width, img.height)])`,
  ].join('\n');
  fs.writeFileSync(pyPath, script);
  try {
    execSync(`python "${pyPath}"`, { stdio: 'inherit' });
  } finally {
    fs.unlinkSync(pyPath);
  }
}

async function main() {
  const publicDir = import.meta.dirname;
  const iconsDir = path.join(publicDir, 'icons');
  const landingPublicDir = path.join(publicDir, '..', 'landing', 'public');
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(landingPublicDir, { recursive: true });

  // Logo / favicon SVGs
  const logoSvg = createIconSVG(32);
  fs.writeFileSync(path.join(publicDir, 'logo.svg'), logoSvg);
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), logoSvg);
  fs.writeFileSync(path.join(landingPublicDir, 'logo.svg'), logoSvg);
  fs.writeFileSync(path.join(landingPublicDir, 'favicon.svg'), logoSvg);

  // App icon template and per-size SVG/PNG assets
  fs.writeFileSync(path.join(iconsDir, 'icon-template.svg'), createIconSVG(512));
  for (const size of sizes) {
    const svg = createIconSVG(size);
    fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(iconsDir, `icon-${size}x${size}.png`));
  }

  // Logo PNGs at common sizes
  for (const size of [32, 64, 128, 256, 512]) {
    await sharp(Buffer.from(createIconSVG(size))).png().toFile(path.join(publicDir, `logo-${size}.png`));
  }

  // Favicon PNG and ICO
  await sharp(Buffer.from(createIconSVG(32))).png().toFile(path.join(publicDir, 'favicon.png'));
  await sharp(Buffer.from(createIconSVG(32))).png().toFile(path.join(landingPublicDir, 'favicon.png'));
  await sharp(Buffer.from(createIconSVG(256))).png().toFile(path.join(publicDir, 'favicon-256.png'));
  generateIco(path.join(publicDir, 'favicon-256.png'), path.join(publicDir, 'favicon.ico'));
  generateIco(path.join(publicDir, 'favicon-256.png'), path.join(landingPublicDir, 'favicon.ico'));

  // Landing also uses a larger logo PNG
  await sharp(Buffer.from(createIconSVG(512))).png().toFile(path.join(landingPublicDir, 'logo-512.png'));

  // Android in-app logo drawables (used in ProjectsScreen.kt)
  const androidResDir = path.join(publicDir, '..', 'apps', 'android', 'app', 'src', 'main', 'res');
  const androidLogoSizes = {
    'drawable-mdpi': 32,
    'drawable-hdpi': 48,
    'drawable-xhdpi': 64,
    'drawable-xxhdpi': 96,
    'drawable-xxxhdpi': 128,
  };
  for (const [dir, size] of Object.entries(androidLogoSizes)) {
    const outDir = path.join(androidResDir, dir);
    fs.mkdirSync(outDir, { recursive: true });
    await sharp(Buffer.from(createIconSVG(size))).png().toFile(path.join(outDir, 'ic_logo.png'));
  }

  // Clean up temporary favicon-256.png
  fs.unlinkSync(path.join(publicDir, 'favicon-256.png'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
