'use strict';
// Normaliserer innsendte bilder: snur etter EXIF, fjerner ALL metadata (inkl. GPS), begrenser størrelse
// og tilpasser sideforholdet til det Instagram godtar for feed-bilder (4:5 til 1,91:1).
const sharp = require('sharp');

const MIN_SIDE = 600;
const MAX_EDGE = 1440;
const MIN_RATIO = 0.8; // 4:5
const MAX_RATIO = 1.91;

class ImageError extends Error {}

async function normalizeImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata();
  } catch {
    throw new ImageError('Bildet kunne ikke leses.');
  }
  // Etter rotasjon bytter bredde og høyde plass for noen EXIF-orienteringer
  const swap = meta.orientation && meta.orientation >= 5;
  const w0 = swap ? meta.height : meta.width;
  const h0 = swap ? meta.width : meta.height;
  if (!w0 || !h0 || Math.min(w0, h0) < MIN_SIDE) throw new ImageError(`Bildet er for lite (minst ${MIN_SIDE} piksler på korteste side).`);

  let pipeline = sharp(buffer, { limitInputPixels: 80_000_000 }).rotate();
  const ratio = w0 / h0;
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
    // Beskjær minst mulig til nærmeste tillatte sideforhold, med fokus på det mest interessante i bildet
    const cropW = ratio > MAX_RATIO ? h0 * MAX_RATIO : w0;
    const cropH = ratio < MIN_RATIO ? w0 / MIN_RATIO : h0;
    const s = Math.min(1, MAX_EDGE / Math.max(cropW, cropH));
    pipeline = pipeline.resize(Math.round(cropW * s), Math.round(cropH * s), { fit: 'cover', position: sharp.strategy.attention });
  } else {
    pipeline = pipeline.resize(Math.round(w0 * scale), Math.round(h0 * scale), { fit: 'fill' });
  }
  const jpeg = await pipeline
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer(); // uten withMetadata(): EXIF, GPS og ICC strippes
  const out = await sharp(jpeg).metadata();
  return { jpeg, width: out.width, height: out.height };
}

module.exports = { normalizeImage, ImageError };
