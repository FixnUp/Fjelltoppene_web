'use strict';
// Ruter for innsendte bilder: offentlig innsending, bildeadresse for Instagram, og admin-API.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { normalizeImage, ImageError } = require('./image');
const { sniffImage } = require('./content');
const { sanitizeText } = require('./moderation');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const CONSENT_VERSION = '2026-10-10';
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function mountSubmissionRoutes(app, deps) {
  const { submissions, moderatorPromise, publisher, instagram, settings, auth, guard, json, adminDir, secret, publicBaseUrl, maxPerDay } = deps;
  const limits = { perIpPerDay: deps.perIpPerDay ?? 5, perHour: deps.perHour ?? 40 };
  const ipHits = new Map();
  const globalHits = [];

  const ipKey = (ip) => crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 16);

  function rateLimited(ip, now = Date.now()) {
    const k = ipKey(ip);
    const mine = (ipHits.get(k) || []).filter((t) => now - t < DAY);
    while (globalHits.length && now - globalHits[0] > HOUR) globalHits.shift();
    if (mine.length >= limits.perIpPerDay) return 'Du har sendt inn mange bilder i dag. Prøv igjen i morgen.';
    if (globalHits.length >= limits.perHour) return 'Mange sender inn akkurat nå. Prøv igjen om en stund.';
    mine.push(now); ipHits.set(k, mine); globalHits.push(now);
    return null;
  }

  // ---- AI-behandling i kø, én om gangen ----
  let chain = Promise.resolve();
  function enqueue(id) {
    chain = chain.then(() => processSubmission(id)).catch(() => {});
    return chain;
  }

  async function processSubmission(id) {
    const s = submissions.get(id);
    if (!s || s.status !== 'received') return;
    const moderator = await moderatorPromise;
    const jpeg = fs.readFileSync(submissions.imagePath(id));
    if (!moderator) {
      submissions.update(id, { status: 'held', caption: require('./moderation').buildCaption({ peak: s.peak, name: s.name, handle: s.handle }), ai: { decision: 'hold', reasons: ['AI-vurdering er ikke satt opp'] } }, 'Venter på manuell godkjenning');
      return;
    }
    const r = await moderator.moderate({ jpeg, peak: s.peak, name: s.name, handle: s.handle });
    const status = { approve: 'approved', hold: 'held', reject: 'rejected' }[r.decision] || 'held';
    submissions.update(id, { status, caption: r.caption, ai: { decision: r.decision, reasons: r.reasons, verdict: r.verdict } }, `AI: ${r.decision}`);
    if (status === 'approved') publisher.tick().catch(() => {});
  }

  // ---- Offentlig innsending ----
  app.post('/api/innsending', express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const bad = (code, error) => res.status(code).json({ error });
    let meta;
    try { meta = JSON.parse(decodeURIComponent(req.headers['x-innsending'] || '')); } catch { return bad(400, 'Ugyldig skjema.'); }
    if (meta.website) return res.status(202).json({ ok: true }); // honeypot: lat som alt gikk bra
    if (!(Number(meta.t) >= 2500)) return bad(400, 'Skjemaet ble sendt for raskt. Prøv igjen.');
    if (meta.consent !== true) return bad(400, 'Du må godta at bildet kan brukes.');
    const peak = sanitizeText(meta.peak, 80);
    if (peak.length < 2) return bad(400, 'Skriv hvilken topp bildet er fra.');
    const name = sanitizeText(meta.name, 60) || null;
    const handle = meta.handle ? String(meta.handle).replace(/^@/, '').trim() : null;
    if (handle && !HANDLE_RE.test(handle)) return bad(400, 'Instagram-brukernavnet ser ikke riktig ut.');
    const email = meta.email ? String(meta.email).trim() : null;
    if (email && !EMAIL_RE.test(email)) return bad(400, 'E-postadressen ser ikke riktig ut.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(400, 'Ingen bildefil mottatt.');
    if (!sniffImage(req.body)) return bad(415, 'Filen er ikke et støttet bilde (JPG, PNG, WebP).');

    const limited = rateLimited(req.ip);
    if (limited) return bad(429, limited);

    let normalized;
    try { normalized = await normalizeImage(req.body); } catch (e) {
      return bad(e instanceof ImageError ? 422 : 500, e instanceof ImageError ? e.message : 'Kunne ikke behandle bildet.');
    }
    const s = submissions.create({
      jpeg: normalized.jpeg, peak, name, handle, email,
      consent: { at: new Date().toISOString(), version: CONSENT_VERSION, ipHash: ipKey(req.ip) },
    });
    enqueue(s.id);
    return res.status(202).json({ ok: true });
  });

  // ---- Bildeadresse som Instagram henter fra (uforutsigbar adresse, bare for godkjente bilder) ----
  app.get('/innsendt/:file', (req, res) => {
    const m = /^([0-9a-f]{16})-([0-9a-f]{24})\.jpg$/.exec(req.params.file);
    const s = m && submissions.get(m[1]);
    if (!s || s.imageToken !== m[2] || !['approved', 'posting', 'posted'].includes(s.status)) return res.status(404).end();
    res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex' });
    res.type('jpeg').sendFile(submissions.imagePath(s.id), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---- Admin ----
  app.get('/admin/innsendinger', (req, res) => {
    if (!auth.isAuthed(req)) return res.redirect('/admin');
    res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(path.join(adminDir, 'submissions.html'), 'utf8'));
  });

  const view = (s) => ({
    id: s.id, createdAt: s.createdAt, status: s.status, peak: s.peak, name: s.name, handle: s.handle, email: s.email,
    caption: s.caption, ai: s.ai ? { decision: s.ai.decision, reasons: s.ai.reasons, contains_people: s.ai.verdict?.contains_people ?? null, confidence: s.ai.verdict?.confidence ?? null } : null,
    instagram: s.instagram, notes: s.notes.slice(-6), imageUrl: `/admin/api/innsendinger/${s.id}/bilde`,
    hasImage: fs.existsSync(submissions.imagePath(s.id)),
  });

  app.get('/admin/api/innsendinger', guard, (req, res) => {
    const status = req.query.status ? String(req.query.status).split(',') : undefined;
    res.json({ items: submissions.list({ status }).slice(0, 200).map(view) });
  });

  app.get('/admin/api/innsendinger/:id/bilde', (req, res) => {
    if (!auth.isAuthed(req)) return res.status(401).end();
    const s = submissions.get(req.params.id);
    if (!s || !fs.existsSync(submissions.imagePath(s.id))) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300').type('jpeg').sendFile(submissions.imagePath(s.id));
  });

  app.put('/admin/api/innsendinger/:id/caption', guard, json, (req, res) => {
    const s = submissions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Fant ikke innsendingen' });
    if (['posted', 'posting'].includes(s.status)) return res.status(409).json({ error: 'Allerede publisert' });
    const caption = String(req.body?.caption ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 2000);
    submissions.update(s.id, { caption }, 'Bildetekst endret av admin');
    res.json({ ok: true });
  });

  app.post('/admin/api/innsendinger/:id/:action', guard, json, (req, res) => {
    const s = submissions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Fant ikke innsendingen' });
    const a = req.params.action;
    const busy = ['posting'].includes(s.status);
    if (busy) return res.status(409).json({ error: 'Publiseres akkurat nå. Prøv igjen om litt.' });
    if (a === 'approve' && ['held', 'failed'].includes(s.status)) {
      submissions.update(s.id, { status: 'approved', instagram: null }, 'Godkjent av admin');
      publisher.tick().catch(() => {});
    } else if (a === 'reject' && ['held', 'approved', 'failed'].includes(s.status)) {
      submissions.update(s.id, { status: 'rejected' }, 'Avvist av admin');
    } else if (a === 'withdraw') {
      submissions.update(s.id, { status: 'withdrawn' }, s.status === 'posted' ? 'Trukket tilbake. Fjern innlegget manuelt i Instagram.' : 'Trukket tilbake');
    } else {
      return res.status(409).json({ error: `Kan ikke ${a} når status er ${s.status}` });
    }
    res.json({ ok: true, item: view(submissions.get(s.id)) });
  });

  app.get('/admin/api/instagram', guard, (_req, res) => {
    res.json({
      ...instagram.status(),
      paused: settings.get().paused,
      aiConfigured: deps.aiConfigured(),
      publicBaseUrl: publicBaseUrl || null,
      maxPerDay,
      postedLast24h: submissions.postedSince(DAY).length,
      counts: submissions.counts(),
    });
  });

  app.post('/admin/api/instagram/pause', guard, json, (req, res) => {
    res.json(settings.setPaused(Boolean(req.body?.paused)));
  });

  return { enqueue, processSubmission, rateLimited };
}

module.exports = { mountSubmissionRoutes, CONSENT_VERSION };
