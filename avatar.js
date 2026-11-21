const sharp = require('sharp');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const badImage = () => Object.assign(new Error('Ảnh không hợp lệ. Vui lòng chọn lại ảnh và thử lưu lần nữa.'), { c: 400 });

// Only raster data is persisted. Decode and encode again so uploaded file contents
// cannot be served as executable SVG/HTML or carry the original image metadata.
async function normalizeAvatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_AVATAR_BYTES * 4 / 3) + 64) throw badImage();
  const match = value.match(/^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw badImage();
  const input = Buffer.from(match[2], 'base64');
  if (!input.length || input.length > MAX_AVATAR_BYTES || input.toString('base64') !== match[2]) throw badImage();
  try {
    const image = sharp(input, { limitInputPixels: 16 * 1024 * 1024, animated: false, failOn: 'warning' });
    const meta = await image.metadata();
    const expected = match[1] === 'avif' ? 'heif' : match[1];
    if (meta.format !== expected || !meta.width || !meta.height) throw badImage();
    const output = await image.rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    return 'data:image/webp;base64,' + output.toString('base64');
  } catch {
    throw badImage();
  }
}

// Original uploads are converted in a bounded worker before the browser cropper
// sees them, including TIFF and HEIC/HEIF files unsupported by some browsers.
async function prepareAvatar(value) {
  const maxBytes = 8 * 1024 * 1024;
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 128) throw badImage();
  const match = value.match(/^data:(?:image\/[a-z0-9.+-]+|application\/octet-stream)?;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw badImage();
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > maxBytes || buffer.toString('base64') !== match[1]) throw badImage();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'avatar-worker.js'), {
      workerData: buffer,
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    const timeout = setTimeout(() => { worker.terminate(); reject(badImage()); }, 20000);
    const finish = () => clearTimeout(timeout);
    worker.once('message', result => {
      finish();
      if (result.error) reject(badImage());
      else resolve('data:image/webp;base64,' + Buffer.from(result.image).toString('base64'));
    });
    worker.once('error', () => { finish(); reject(badImage()); });
    worker.once('exit', code => { finish(); if (code !== 0) reject(badImage()); });
  });
}

module.exports = { normalizeAvatar, prepareAvatar };
