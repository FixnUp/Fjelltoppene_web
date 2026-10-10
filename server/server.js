'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { createStore } = require('./lib/content');
const { createAuth } = require('./lib/auth');
const { createRenderer } = require('./lib/render');
const { cleanInline, cleanBlock, safeHref, safeSrc } = require('./lib/sanitize');

function createApp(opts = {}) {
  const root = path.resolve(__dirname, '..');
  const siteDir = opts.siteDir || process.env.SITE_DIR || root;
  const adminDir = opts.adminDir || path.join(root, 'admin');
  const dataDir = opts.dataDir || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(root, '.data');
  const store = createStore(dataDir);
  const secret = opts.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const auth = createAuth({
    user: opts.user || process.env.ADMIN_USER || 'admin',
    password: opts.password ?? process.env.ADMIN_PASSWORD,
    secret,
  });
  const renderer = createRenderer({ siteDir, store });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });

  const secure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

  // ---------- Offentlige sider ----------
  app.get('/healthz', (_req, res) => res.type('text').send('ok'));
  app.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /admin\n'));

  app.use('/assets', express.static(path.join(siteDir, 'assets'), { maxAge: '7d' }));
  app.use('/media', express.static(store.uploadDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }));
  app.use('/admin/static', express.static(adminDir, { index: false, maxAge: 0, etag: true }));

  function sendPage(page) {
    return (req, res, next) => {
      const edit = 'edit' in req.query && auth.isAuthed(req);
      if ('edit' in req.query && !edit) return res.redirect('/admin');
      const html = renderer.render(page, { edit });
      if (html == null) return next();
      res.set('Cache-Control', edit ? 'no-store' : 'public, max-age=0, must-revalidate');
      res.type('html').send(html);
    };
  }
  app.get(['/', '/index.html'], sendPage('index'));
  app.get(['/privacy', '/privacy.html'], sendPage('privacy'));
  app.get(['/feedback', '/feedback.html'], sendPage('feedback'));
  app.get(['/logo', '/logo.html'], sendPage('logo'));

  // ---------- Admin ----------
  app.get('/admin', (req, res) => {
    if (auth.isAuthed(req)) return res.redirect('/?edit');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(fs.readFileSync(path.join(adminDir, 'login.html'), 'utf8'));
  });

  const json = express.json({ limit: '2mb' });
  // Alle skriving krever egendefinert header (stopper kryss-side-forespørsler) og gyldig sesjon.
  const guard = (req, res, next) => {
    if (!auth.isAuthed(req)) return res.status(401).json({ error: 'Ikke innlogget' });
    if (req.headers['x-cms'] !== '1') return res.status(400).json({ error: 'Ugyldig forespørsel' });
    next();
  };

  app.post('/admin/login', json, (req, res) => {
    if (req.headers['x-cms'] !== '1') return res.status(400).json({ error: 'Ugyldig forespørsel' });
    const { user, password } = req.body || {};
    const r = auth.attempt(req.ip, user, password);
    const reply = () => {
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.set('Set-Cookie', auth.cookie(r.token, secure(req)));
      res.json({ ok: true });
    };
    if (r.ok) reply(); else setTimeout(reply, 400);
  });

  app.post('/admin/logout', guard, (req, res) => {
    res.set('Set-Cookie', auth.clearCookie(secure(req)));
    res.json({ ok: true });
  });

  app.put('/admin/api/content', guard, json, (req, res) => {
    const body = req.body || {};
    const cur = store.get();
    const next = {
      text: { ...cur.text }, img: { ...cur.img }, href: { ...cur.href }, lists: { ...cur.lists },
    };
    const okKey = (k) => store.isValidKey(k);
    for (const [k, v] of Object.entries(body.text || {})) if (okKey(k) && typeof v === 'string') next.text[k] = cleanInline(v);
    for (const [k, v] of Object.entries(body.lists || {})) if (okKey(k) && typeof v === 'string') next.lists[k] = cleanBlock(v);
    for (const [k, v] of Object.entries(body.href || {})) {
      const h = safeHref(v);
      if (okKey(k) && h) next.href[k] = h;
    }
    for (const [k, v] of Object.entries(body.img || {})) {
      const src = v && safeSrc(v.src);
      if (okKey(k) && src) next.img[k] = { src, alt: String(v.alt ?? '').slice(0, 300) };
    }
    for (const r of body.reset || []) {
      const [type, key] = String(r).split(':');
      if (next[type] && okKey(key)) delete next[type][key];
    }
    store.save(next);
    res.json({ ok: true, updatedAt: store.get().updatedAt });
  });

  app.get('/admin/api/backups', guard, (_req, res) => res.json({ backups: store.listBackups() }));
  app.post('/admin/api/restore', guard, json, (req, res) => {
    try { store.restore(String(req.body?.name || '')); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/admin/api/upload', guard, express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Ingen fil mottatt' });
    try { res.json({ src: store.saveUpload(req.body) }); }
    catch (e) { res.status(415).json({ error: e.message }); }
  });

  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'For stor fil (maks 10 MB)' });
    return next(err);
  });
  app.use((_req, res) => {
    res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Fant ikke siden</title><body style="font-family:system-ui;padding:12vh 8vw"><h1>Fant ikke siden</h1><p><a href="/">Til forsiden</a></p>');
  });

  return { app, auth, store };
}

if (require.main === module) {
  const { app, auth } = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Fjelltoppene-web lytter på port ${port}`);
    if (!auth.enabled) console.warn('ADMIN_PASSWORD mangler eller er kortere enn 8 tegn: admin er avslått.');
  });
}

module.exports = { createApp };
