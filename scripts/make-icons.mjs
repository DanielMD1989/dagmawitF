// Draws the DAGMAWIT icons: a green "D" with a row of stitches, on ivory.
// Run `npm run icons` after changing the design. The PNGs are committed, so this is not part of the build.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const IVORY = '#F6F2EA';
const GREEN = '#3F5A4B';
const THREAD = '#B9A472';

// The mark is drawn on a 512 grid. `scale` shrinks it toward the centre for the maskable icon,
// which must keep its content inside the central 80% so any phone's mask can crop safely.
function svg({ rounded, scale }) {
  const radius = rounded ? 112 : 0;
  const stitches = [0, 1, 2, 3, 4]
    .map((i) => `<rect x="${176 + i * 46}" y="404" width="26" height="12" rx="6" fill="${THREAD}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${IVORY}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path fill-rule="evenodd" fill="${GREEN}" d="M168 120 H250 C340 120 396 176 396 248 C396 320 340 376 250 376 H168 Z M212 164 V332 H248 C310 332 350 300 350 248 C350 196 310 164 248 164 Z"/>
    ${stitches}
  </g>
</svg>`;
}

const jobs = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];

await mkdir('public/icons', { recursive: true });
for (const { file, size, rounded, scale } of jobs) {
  await sharp(Buffer.from(svg({ rounded, scale })))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${file}`);
  console.log('wrote public/icons/' + file);
}
