import type { Page } from '@playwright/test';

export interface Picture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Draws a picture in the browser (no binary files in the repository) and returns it as a file to upload. */
async function draw(page: Page, kind: 'sketch' | 'swatch' | 'noise'): Promise<Picture> {
  const base64 = await page.evaluate(async (k) => {
    const [w, h] = k === 'sketch' ? [3000, 4000] : k === 'swatch' ? [240, 240] : [1700, 1400];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d')!;
    if (k === 'noise') {
      // Random pixels do not compress: a PNG of them is over 5 MB, above what storage takes.
      const img = g.createImageData(w, h);
      const bytes = new Uint32Array(img.data.buffer);
      for (let i = 0; i < bytes.length; i += 16384) crypto.getRandomValues(bytes.subarray(i, i + 16384));
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      g.putImageData(img, 0, 0);
    } else {
      g.fillStyle = k === 'sketch' ? '#fbf8f1' : '#e8dabb';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#25231f';
      g.lineWidth = k === 'sketch' ? 6 : 2;
      for (let i = 0; i < (k === 'sketch' ? 4000 : 60); i++) {
        g.beginPath();
        g.moveTo(Math.random() * w, Math.random() * h);
        g.quadraticCurveTo(Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h);
        g.stroke();
      }
    }
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), k === 'sketch' ? 'image/jpeg' : 'image/png', 0.95),
    );
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  }, kind);
  const names = { sketch: 'gown-sketch.jpg', swatch: 'lace-swatch.png', noise: 'noise.png' };
  return {
    name: names[kind],
    mimeType: kind === 'sketch' ? 'image/jpeg' : 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  };
}

export const bigSketch = (page: Page) => draw(page, 'sketch');
export const smallSwatch = (page: Page) => draw(page, 'swatch');
export const noise = (page: Page) => draw(page, 'noise');
export const notAPicture: Picture = {
  name: 'not-a-picture.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('This is a shopping list, not a picture.\n'),
};
