'use strict';
// Små innstillinger admin kan endre uten ny deploy (nødbrems for automatisk publisering).
const fs = require('node:fs');
const path = require('node:path');

function createSettings(dataDir) {
  const file = path.join(dataDir, 'settings.json');
  let data = { paused: false, pausedAt: null };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* standardverdier */ }
  return {
    get: () => ({ ...data }),
    setPaused(paused) {
      data = { ...data, paused: Boolean(paused), pausedAt: paused ? new Date().toISOString() : null };
      fs.writeFileSync(file, JSON.stringify(data));
      return { ...data };
    },
  };
}

module.exports = { createSettings };
