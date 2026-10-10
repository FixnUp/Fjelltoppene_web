'use strict';
// Publisering til Instagram via Meta sitt API (to steg: lag container, publiser container).
// Modus: off = publiserer ikke, dry = later som og logger, live = publiserer på ekte.
const fs = require('node:fs');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;

function createInstagram({ mode = 'off', userId, token, apiBase = 'https://graph.instagram.com', apiVersion = '', dataDir, fetchImpl = fetch }) {
  const tokenFile = dataDir ? path.join(dataDir, 'ig-token.json') : null;
  const base = () => `${apiBase.replace(/\/$/, '')}${apiVersion ? `/${apiVersion}` : ''}`;
  let state = { token, refreshedAt: null, lastError: null };

  if (tokenFile && fs.existsSync(tokenFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (saved.token) state = { ...state, token: saved.token, refreshedAt: saved.refreshedAt || null };
    } catch { /* bruk token fra miljøet */ }
  }

  const configured = () => Boolean(userId && state.token);

  async function call(method, url, params) {
    const u = new URL(url);
    const init = { method, headers: { Accept: 'application/json' } };
    if (method === 'GET') for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
    else { init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(params).toString(); }
    const res = await fetchImpl(u, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const e = new Error(body.error?.message || `Instagram svarte ${res.status}`);
      e.status = res.status; e.code = body.error?.code; e.retryable = res.status >= 500 || res.status === 429;
      throw e;
    }
    return body;
  }

  async function waitForContainer(id) {
    for (let i = 0; i < 12; i++) {
      const st = await call('GET', `${base()}/${id}`, { fields: 'status_code', access_token: state.token });
      if (st.status_code === 'FINISHED') return;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram avviste bildet (${st.status_code})`);
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('Instagram brukte for lang tid på å behandle bildet');
  }

  return {
    mode,
    configured,
    status: () => ({ mode, configured: configured(), refreshedAt: state.refreshedAt, lastError: state.lastError }),

    async publish({ imageUrl, caption }) {
      if (mode === 'off') throw new Error('Instagram-publisering er avslått (INSTAGRAM_MODE=off)');
      if (mode === 'dry') return { dryRun: true, mediaId: null, permalink: null, postedAt: new Date().toISOString() };
      if (!configured()) throw new Error('Instagram er ikke satt opp (IG_USER_ID og IG_ACCESS_TOKEN mangler)');
      try {
        const container = await call('POST', `${base()}/${userId}/media`, { image_url: imageUrl, caption, access_token: state.token });
        await waitForContainer(container.id);
        const published = await call('POST', `${base()}/${userId}/media_publish`, { creation_id: container.id, access_token: state.token });
        let permalink = null;
        try { permalink = (await call('GET', `${base()}/${published.id}`, { fields: 'permalink', access_token: state.token })).permalink || null; } catch { /* ikke kritisk */ }
        state.lastError = null;
        return { dryRun: false, mediaId: published.id, permalink, postedAt: new Date().toISOString() };
      } catch (err) {
        state.lastError = String(err.message).slice(0, 200);
        throw err;
      }
    },

    /** Fornyer langlevd token hvis den er over 30 dager gammel. Trygt å kalle ofte. */
    async refreshIfNeeded() {
      if (mode !== 'live' || !configured()) return false;
      if (state.refreshedAt && Date.now() - Date.parse(state.refreshedAt) < 30 * DAY) return false;
      try {
        const r = await call('GET', 'https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: state.token });
        if (!r.access_token) throw new Error('Ingen ny token i svaret');
        state = { ...state, token: r.access_token, refreshedAt: new Date().toISOString(), lastError: null };
        if (tokenFile) fs.writeFileSync(tokenFile, JSON.stringify({ token: state.token, refreshedAt: state.refreshedAt }), { mode: 0o600 });
        return true;
      } catch (err) {
        state.lastError = `Token-fornyelse feilet: ${String(err.message).slice(0, 150)}`;
        return false;
      }
    },
  };
}

module.exports = { createInstagram };
