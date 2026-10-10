'use strict';
// Innsendte bilder: én JSON-fil per innsending og ett behandlet JPEG-bilde. Alt ligger på volumet.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATUSES = ['received', 'approved', 'held', 'rejected', 'posting', 'posted', 'failed', 'withdrawn'];
const DAY = 24 * 60 * 60 * 1000;
const RETENTION = {
  // Avviste, trukne og mislykkede innsendinger slettes helt etter 30 dager.
  removeAfter: { rejected: 30 * DAY, withdrawn: 30 * DAY, failed: 30 * DAY },
  // Publiserte: selve bildefilen slettes etter 30 dager. Samtykkeposten beholdes som dokumentasjon.
  postedImageAfter: 30 * DAY,
};

function createSubmissionStore(dataDir) {
  const dir = path.join(dataDir, 'submissions');
  const imgDir = path.join(dir, 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  const items = new Map();

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && s.id) items.set(s.id, s);
    } catch { /* hopp over skadet fil */ }
  }

  const metaPath = (id) => path.join(dir, `${id}.json`);
  const imagePath = (id) => path.join(imgDir, `${id}.jpg`);

  function persist(s) {
    s.updatedAt = new Date().toISOString();
    const tmp = `${metaPath(s.id)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, metaPath(s.id));
  }

  return {
    imagePath,
    create({ jpeg, peak, name, handle, email, consent }) {
      const id = crypto.randomBytes(8).toString('hex');
      fs.writeFileSync(imagePath(id), jpeg);
      const s = {
        id,
        createdAt: new Date().toISOString(),
        status: 'received',
        peak, name, handle, email,
        consent,
        imageToken: crypto.randomBytes(12).toString('hex'),
        caption: '',
        ai: null,
        instagram: null,
        notes: [],
      };
      items.set(id, s);
      persist(s);
      return s;
    },
    get: (id) => items.get(id) || null,
    list({ status } = {}) {
      const want = status ? [].concat(status) : null;
      return [...items.values()]
        .filter((s) => !want || want.includes(s.status))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    update(id, patch, note) {
      const s = items.get(id);
      if (!s) return null;
      Object.assign(s, patch);
      if (note) s.notes.push({ at: new Date().toISOString(), text: String(note).slice(0, 300) });
      persist(s);
      return s;
    },
    counts() {
      const out = Object.fromEntries(STATUSES.map((k) => [k, 0]));
      for (const s of items.values()) out[s.status] = (out[s.status] || 0) + 1;
      return out;
    },
    postedSince(ms) {
      const cutoff = Date.now() - ms;
      return [...items.values()].filter((s) => s.status === 'posted' && s.instagram && !s.instagram.dryRun && Date.parse(s.instagram.postedAt) >= cutoff);
    },
    lastPostedAt() {
      const t = [...items.values()].filter((s) => s.status === 'posted' && s.instagram && !s.instagram.dryRun).map((s) => Date.parse(s.instagram.postedAt));
      return t.length ? Math.max(...t) : 0;
    },
    /** Slett det loven og vår egen policy sier skal slettes. Returnerer antall fjernet. */
    purge(now = Date.now()) {
      let removed = 0;
      for (const s of [...items.values()]) {
        const age = now - Date.parse(s.updatedAt || s.createdAt);
        const limit = RETENTION.removeAfter[s.status];
        if (limit && age > limit) {
          for (const p of [imagePath(s.id), metaPath(s.id)]) fs.rmSync(p, { force: true });
          items.delete(s.id);
          removed += 1;
        } else if (s.status === 'posted' && age > RETENTION.postedImageAfter && fs.existsSync(imagePath(s.id))) {
          fs.rmSync(imagePath(s.id), { force: true });
          s.email = null;
          persist(s);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

module.exports = { createSubmissionStore, STATUSES, RETENTION };
