'use strict';
// Lagring av redigert innhold: én JSON-fil + opplastede bilder på volumet.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MAX_BACKUPS = 40;

const EMPTY = () => ({ text: {}, img: {}, href: {}, lists: {}, updatedAt: null });

function createStore(dataDir) {
  const file = path.join(dataDir, 'content.json');
  const backupDir = path.join(dataDir, 'backups');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  let data = load();
  let version = 1;

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...EMPTY(), ...parsed };
    } catch {
      return EMPTY();
    }
  }

  function persist(next) {
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(file, path.join(backupDir, `content-${stamp}.json`));
      const old = fs.readdirSync(backupDir).filter((f) => f.endsWith('.json')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) fs.unlinkSync(path.join(backupDir, f));
    }
    next.updatedAt = new Date().toISOString();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    data = next;
    version += 1;
  }

  return {
    uploadDir,
    get: () => data,
    version: () => version,
    isValidKey: (k) => KEY_RE.test(k),
    save(next) { persist(next); },
    listBackups() {
      return fs.readdirSync(backupDir).filter((f) => /^content-[\w-]+\.json$/.test(f)).sort().reverse();
    },
    restore(name) {
      if (!/^content-[\w-]+\.json$/.test(name)) throw new Error('Ugyldig sikkerhetskopi');
      const parsed = JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8'));
      persist({ ...EMPTY(), ...parsed });
    },
    saveUpload(buffer) {
      const type = sniffImage(buffer);
      if (!type) throw new Error('Filen er ikke et støttet bilde (JPG, PNG, WebP eller GIF)');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const name = `${hash}.${type.ext}`;
      const dest = path.join(uploadDir, name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buffer);
      return `/media/${name}`;
    },
  };
}

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg' };
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png' };
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp' };
  if (b.slice(0, 4).toString('latin1') === 'GIF8') return { ext: 'gif' };
  return null;
}

module.exports = { createStore, sniffImage };
