'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../server');
const { createModerator, decide } = require('../lib/moderation');
const { createInstagram } = require('../lib/instagram');

const SITE = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(25); } throw new Error('tidsavbrudd'); }

const goodVerdict = { decision: 'approve', reasons: [], verdict: { contains_people: false, confidence: 'high' }, caption: '📍 Test\n\n📷 Kari' };

async function jpegFile(w = 900, h = 700, exif = false) {
  let s = sharp({ create: { width: w, height: h, channels: 3, background: '#4a7' } }).jpeg();
  if (exif) s = s.withExif({ IFD0: { Copyright: 'hemmelig' } });
  return s.toBuffer();
}

async function start(over = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sub-'));
  const posts = [];
  const instagram = over.instagram || {
    mode: 'live', configured: () => true, status: () => ({ mode: 'live', configured: true }), refreshIfNeeded: async () => false,
    publish: async (a) => { posts.push(a); return { dryRun: false, mediaId: `m${posts.length}`, permalink: 'https://instagram.com/p/x', postedAt: new Date().toISOString() }; },
  };
  const moderator = over.moderator === undefined ? { moderate: async () => goodVerdict } : over.moderator;
  const ctx = createApp({
    siteDir: SITE, dataDir, password: 'riktig-passord', secret: 's', moderator, instagram,
    env: { PUBLIC_BASE_URL: 'https://fjell.test', IG_MIN_HOURS: '0', IG_MAX_PER_DAY: String(over.maxPerDay ?? 5), ...(over.env || {}) },
    perIpPerDay: over.perIpPerDay, perHour: over.perHour,
  });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + url, { method, redirect: 'manual', headers: { 'X-CMS': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc && sc.includes('ft_admin=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
    return res;
  };
  const submit = async (file, meta = {}) => call('POST', '/api/innsending', file, {
    'Content-Type': 'image/jpeg', 'X-Innsending': encodeURIComponent(JSON.stringify({ peak: 'Dalsnuten', consent: true, t: 5000, ...meta })),
  });
  return { ...ctx, base, call, submit, posts, login: () => call('POST', '/admin/login', { user: 'admin', password: 'riktig-passord' }), close: () => { ctx.stopJobs(); server.closeAllConnections(); server.close(); } };
}

test('/send-inn lastes og har skjema', async () => {
  const t = await start();
  const r = await t.call('GET', '/send-inn');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /id="submit-form"/);
  t.close();
});

test('gyldig innsending: AI godkjenner, publiseres, og EXIF fjernes', async () => {
  const t = await start({ moderator: { moderate: async () => goodVerdict } });
  const r = await t.submit(await jpegFile(900, 700, true), { name: 'Kari', handle: '@kari_n' });
  assert.equal(r.status, 202);
  const s = await waitFor(() => t.submissions.list({ status: 'posted' })[0]);
  assert.equal(t.posts.length, 1);
  assert.match(t.posts[0].imageUrl, /^https:\/\/fjell\.test\/innsendt\/[0-9a-f]{16}-[0-9a-f]{24}\.jpg$/);
  assert.equal(s.handle, 'kari_n');
  const meta = await sharp(fs.readFileSync(t.submissions.imagePath(s.id))).metadata();
  assert.equal(meta.exif, undefined, 'EXIF skal være fjernet');
  // bildeadressen virker med riktig token, ikke med feil
  const file = `${s.id}-${s.imageToken}.jpg`;
  assert.equal((await t.call('GET', `/innsendt/${file}`)).status, 200);
  assert.equal((await t.call('GET', `/innsendt/${s.id}-${'0'.repeat(24)}.jpg`)).status, 404);
  t.close();
});

test('honeypot, samtykke, hastighet og filtyper avvises', async () => {
  const t = await start();
  const img = await jpegFile();
  assert.equal((await t.submit(img, { website: 'spam.no' })).status, 202);
  assert.equal(t.submissions.list().length, 0, 'honeypot skal ikke lagre noe');
  assert.equal((await t.submit(img, { consent: false })).status, 400);
  assert.equal((await t.submit(img, { t: 100 })).status, 400);
  assert.equal((await t.submit(img, { peak: '' })).status, 400);
  assert.equal((await t.submit(img, { handle: 'ikke gyldig!' })).status, 400);
  assert.equal((await t.submit(img, { email: 'ikke-epost' })).status, 400);
  assert.equal((await t.submit(Buffer.from('<?php echo 1; ?> ikke et bilde'))).status, 415);
  assert.equal((await t.submit(await jpegFile(300, 300))).status, 422);
  assert.equal(t.submissions.list().length, 0);
  t.close();
});

test('rate limit per IP', async () => {
  const t = await start({ perIpPerDay: 2 });
  const img = await jpegFile();
  assert.equal((await t.submit(img)).status, 202);
  assert.equal((await t.submit(img)).status, 202);
  assert.equal((await t.submit(img)).status, 429);
  t.close();
});

test('tvil går til admin, og admin kan godkjenne og publisere', async () => {
  const t = await start({ moderator: { moderate: async () => ({ decision: 'hold', reasons: ['Barn kan være synlige'], verdict: null, caption: 'Tekst' }) } });
  await t.submit(await jpegFile());
  const s = await waitFor(() => t.submissions.list({ status: 'held' })[0]);
  await sleep(100);
  assert.equal(t.posts.length, 0, 'ingenting publiseres uten godkjenning');
  assert.equal((await t.call('POST', `/admin/api/innsendinger/${s.id}/approve`, {})).status, 401);
  assert.equal((await t.call('GET', `/admin/api/innsendinger/${s.id}/bilde`)).status, 401);
  assert.equal((await t.call('GET', `/innsendt/${s.id}-${s.imageToken}.jpg`)).status, 404, 'uavklarte bilder er ikke offentlige');
  await t.login();
  assert.equal((await t.call('GET', `/admin/api/innsendinger/${s.id}/bilde`)).status, 200);
  assert.equal((await t.call('PUT', `/admin/api/innsendinger/${s.id}/caption`, { caption: 'Ny tekst' })).status, 200);
  assert.equal((await t.call('POST', `/admin/api/innsendinger/${s.id}/approve`, {})).status, 200);
  await waitFor(() => t.submissions.get(s.id).status === 'posted');
  assert.equal(t.posts[0].caption, 'Ny tekst');
  t.close();
});

test('AI avviser tydelig upassende bilder', async () => {
  const t = await start({ moderator: { moderate: async () => ({ decision: 'reject', reasons: ['x'], verdict: null, caption: '' }) } });
  await t.submit(await jpegFile());
  await waitFor(() => t.submissions.list({ status: 'rejected' })[0]);
  assert.equal(t.posts.length, 0);
  t.close();
});

test('uten AI-nøkkel går alt til admin', async () => {
  const t = await start({ moderator: null });
  await t.submit(await jpegFile());
  const s = await waitFor(() => t.submissions.list({ status: 'held' })[0]);
  assert.ok(s.caption.includes('Dalsnuten'));
  t.close();
});

test('døgntak og nødbrems stopper publisering', async () => {
  const t = await start({ maxPerDay: 1 });
  const img = await jpegFile();
  await t.submit(img); await t.submit(img);
  await waitFor(() => t.submissions.list({ status: 'posted' }).length === 1);
  await t.publisher.tick();
  await sleep(100);
  assert.equal(t.posts.length, 1, 'tak på 1 per døgn');
  assert.equal(t.submissions.list({ status: 'approved' }).length, 1);

  const t2 = await start();
  await t2.login();
  await t2.call('POST', '/admin/api/instagram/pause', { paused: true });
  await t2.submit(img);
  await waitFor(() => t2.submissions.list({ status: 'approved' })[0]);
  await t2.publisher.tick(); await sleep(100);
  assert.equal(t2.posts.length, 0, 'pauset: ingenting publiseres');
  await t2.call('POST', '/admin/api/instagram/pause', { paused: false });
  await t2.publisher.tick();
  await waitFor(() => t2.posts.length === 1);
  t.close(); t2.close();
});

test('feilet publisering: ikke-retrybar feil gir failed, retrybar prøves igjen', async () => {
  let n = 0;
  const instagram = { mode: 'live', configured: () => true, status: () => ({}), refreshIfNeeded: async () => false,
    publish: async () => { n += 1; const e = new Error('midlertidig'); e.retryable = n < 3; if (n < 3) throw e; return { dryRun: false, mediaId: 'ok', permalink: null, postedAt: new Date().toISOString() }; } };
  const t = await start({ instagram });
  await t.submit(await jpegFile());
  await waitFor(() => t.submissions.list({ status: 'approved' })[0] || t.submissions.list({ status: 'posted' })[0]);
  for (let i = 0; i < 4; i++) { await t.publisher.tick(); await sleep(50); }
  assert.equal(t.submissions.list({ status: 'posted' }).length, 1);
  assert.equal(n, 3);
  t.close();
});

test('opprydding sletter avviste etter 30 dager og bildefil for publiserte', async () => {
  const t = await start();
  await t.submit(await jpegFile());
  const s = await waitFor(() => t.submissions.list({ status: 'posted' })[0]);
  t.submissions.update(s.id, { email: 'a@b.no' });
  t.submissions.purge(Date.now() + 31 * 24 * 3600 * 1000);
  assert.equal(fs.existsSync(t.submissions.imagePath(s.id)), false);
  assert.equal(t.submissions.get(s.id).email, null);
  const t2 = await start({ moderator: { moderate: async () => ({ decision: 'reject', reasons: [], verdict: null, caption: '' }) } });
  await t2.submit(await jpegFile());
  const r = await waitFor(() => t2.submissions.list({ status: 'rejected' })[0]);
  t2.submissions.purge(Date.now() + 31 * 24 * 3600 * 1000);
  assert.equal(t2.submissions.get(r.id), null);
  t.close(); t2.close();
});

// ---------- Enhetstester for moderering og Instagram-klient ----------
test('moderering: regler og feilhåndtering', async () => {
  const ok = { is_outdoor_hiking_photo: true, good_enough_quality: true, contains_people: true, minors_visible: false, explicit_or_violent: false, hateful_or_offensive: false, third_party_text_or_watermark: false, license_plate_or_personal_info: false, screenshot_meme_or_ad: false, confidence: 'high', reasons: [], caption_no: 'Fin utsikt' };
  assert.equal(decide(ok).decision, 'approve');
  assert.equal(decide({ ...ok, contains_people: true }).decision, 'approve', 'personer er tillatt');
  assert.equal(decide({ ...ok, minors_visible: true }).decision, 'hold');
  assert.equal(decide({ ...ok, confidence: 'medium' }).decision, 'hold');
  assert.equal(decide({ ...ok, explicit_or_violent: true }).decision, 'reject');
  assert.equal(decide({ ...ok, explicit_or_violent: true, confidence: 'low' }).decision, 'hold');
  assert.equal(decide({ ...ok, license_plate_or_personal_info: true }).decision, 'hold');

  const calls = [];
  const mk = (resp) => createModerator({ model: 'claude-opus-5-5', zodOutputFormat: (z) => z, client: { messages: { parse: async (args) => { calls.push(args); if (resp instanceof Error) throw resp; return resp; } } } });
  const jpeg = await jpegFile();
  const good = await mk({ stop_reason: 'end_turn', parsed_output: ok }).moderate({ jpeg, peak: 'Dalsnuten', name: 'Kari', handle: 'kari_n' });
  assert.equal(good.decision, 'approve');
  assert.match(good.caption, /@kari_n/);
  assert.equal(calls[0].messages[0].content[0].type, 'image');
  assert.equal(calls[0].messages[0].content[0].source.media_type, 'image/jpeg');
  assert.ok(!('thinking' in calls[0]));
  assert.equal((await mk({ stop_reason: 'refusal', parsed_output: null }).moderate({ jpeg, peak: 'x' })).decision, 'hold');
  assert.equal((await mk(new Error('nett nede')).moderate({ jpeg, peak: 'x' })).decision, 'hold');
  assert.equal((await mk({ stop_reason: 'end_turn', parsed_output: null }).moderate({ jpeg, peak: 'x' })).decision, 'hold');
});

test('Instagram-klient: to steg og feilmeldinger', async () => {
  const log = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); log.push(`${init.method} ${u.pathname}`);
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (u.pathname.endsWith('/media') && init.method === 'POST') { assert.match(init.body, /image_url=/); return json({ id: 'c1' }); }
    if (u.pathname.endsWith('/c1')) return json({ status_code: 'FINISHED' });
    if (u.pathname.endsWith('/media_publish')) return json({ id: 'p1' });
    if (u.pathname.endsWith('/p1')) return json({ permalink: 'https://instagram.com/p/abc' });
    return json({ error: { message: 'ukjent' } }, 400);
  };
  const ig = createInstagram({ mode: 'live', userId: '123', token: 'tok', fetchImpl });
  const r = await ig.publish({ imageUrl: 'https://x/y.jpg', caption: 'hei' });
  assert.equal(r.mediaId, 'p1'); assert.equal(r.permalink, 'https://instagram.com/p/abc');
  assert.deepEqual(log.slice(0, 3), ['POST /123/media', 'GET /c1', 'POST /123/media_publish']);
  assert.rejects(createInstagram({ mode: 'off' }).publish({}), /avslått/);
  assert.equal((await createInstagram({ mode: 'dry' }).publish({})).dryRun, true);
  await assert.rejects(createInstagram({ mode: 'live', fetchImpl }).publish({ imageUrl: 'x', caption: 'y' }), /ikke satt opp/);
  const bad = createInstagram({ mode: 'live', userId: '1', token: 't', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(bad.publish({ imageUrl: 'x', caption: 'y' }), (e) => e.retryable === true);
});
