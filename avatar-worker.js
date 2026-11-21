const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');
const input = Buffer.from(workerData);
const maxPixels = 40 * 1024 * 1024;
const output = image => image.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();

(async () => {
  let image;
  try {
    image = await output(sharp(input, { limitInputPixels: maxPixels, animated: false, failOn: 'warning' }));
  } catch {
    // HEIC decoding is isolated from the web server. Inspect actual decoded
    // image dimensions before allowing libheif to allocate a pixel buffer.
    const decode = require('heic-decode');
    const images = await decode.all({ buffer: input });
    try {
      if (!images.length || images.some(i => !i.width || !i.height || i.width * i.height > maxPixels)) throw new Error('Image too large');
      const pixels = await images[0].decode();
      image = await output(sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } }));
    } finally {
      images.dispose();
    }
  }
  parentPort.postMessage({ image });
})().catch(() => parentPort.postMessage({ error: true }));
