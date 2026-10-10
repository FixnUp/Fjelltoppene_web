'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

const SITE = path.resolve(__dirname, '../..');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  const { app } = createApp({ siteDir: SITE, dataDir, password: 'riktig-passord', secret: 'test', user: 'admin' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'X-CMS': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (isBuf ? body : JSON.stringify(body)) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc && sc.includes('ft_admin=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
    return res;
  };
  const login = () => call('POST', '/admin/login', { user: 'admin', password: 'riktig-passord' });
  return { base, call, login, close: () => { server.closeAllConnections(); server.close(); }, dataDir };
}

test('offentlige sider og gamle adresser virker', async () => {
  const t = await start();
  for (const p of ['/', '/index.html', '/privacy', '/privacy.html', '/feedback', '/feedback.html', '/healthz']) {
    const r = await t.call('GET', p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await t.call('GET', '/finnes-ikke')).status, 404);
  t.close();
});

test('admin: feil passord avvises, riktig gir cookie, edit-modus krever innlogging', async () => {
  const t = await start();
  assert.equal((await t.call('GET', '/?edit')).status, 302);
  const bad = await t.call('POST', '/admin/login', { user: 'admin', password: 'feil' });
  assert.equal(bad.status, 401);
  assert.equal((await t.call('PUT', '/admin/api/content', { text: {} })).status, 401);
  assert.equal((await t.login()).status, 200);
  const edit = await t.call('GET', '/?edit');
  assert.equal(edit.status, 200);
  assert.match(await edit.text(), /admin\/static\/editor\.js/);
  t.close();
});

test('admin: for mange feil gir utestengelse', async () => {
  const t = await start();
  for (let i = 0; i < 5; i++) await t.call('POST', '/admin/login', { user: 'admin', password: 'feil' });
  const r = await t.login();
  assert.equal(r.status, 429);
  t.close();
});

test('skriving krever X-CMS-header', async () => {
  const t = await start();
  await t.login();
  const r = await t.call('PUT', '/admin/api/content', { text: { 'index.hero.h11': 'x' } }, { 'X-CMS': '0' });
  assert.equal(r.status, 400);
  t.close();
});

test('redigert tekst vises, farlig HTML renses, og kan tilbakestilles', async () => {
  const t = await start();
  await t.login();
  const key = 'index.hero.h11';
  const r = await t.call('PUT', '/admin/api/content', { text: { [key]: 'Ny <b>tittel</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>' } });
  assert.equal(r.status, 200);
  const html = await (await t.call('GET', '/')).text();
  assert.match(html, /Ny <b>tittel<\/b>/);
  assert.doesNotMatch(html.split('data-cms="index.hero.h11"')[1].slice(0, 300), /script|onerror|javascript:/);
  await t.call('PUT', '/admin/api/content', { reset: [`text:${key}`] });
  assert.match(await (await t.call('GET', '/')).text(), /Hver topp/);
  t.close();
});

test('lister: HTML renses til hviteliste', async () => {
  const t = await start();
  await t.login();
  const evil = '<details class="faq cms-x"><summary onclick="x()">Spm</summary><div class="answer">Svar<script>1</script><iframe src="//x"></iframe></div></details><img src="http://evil/x.png">';
  await t.call('PUT', '/admin/api/content', { lists: { 'index.faq': evil } });
  const html = await (await t.call('GET', '/')).text();
  const seg = html.split('data-cms-list="index.faq"')[1].split('</section>')[0];
  assert.match(seg, /<summary>Spm<\/summary>/);
  assert.doesNotMatch(seg, /onclick|<script|<iframe|evil/);
  t.close();
});

test('bildeopplasting: godtar bilder, avviser andre filer, og bildet kan brukes', async () => {
  const t = await start();
  await t.login();
  const bad = await t.call('POST', '/admin/api/upload', Buffer.from('<?php echo 1; ?> dette er ikke et bilde'), { 'Content-Type': 'image/png' });
  assert.equal(bad.status, 415);
  const ok = await t.call('POST', '/admin/api/upload', PNG, { 'Content-Type': 'image/png' });
  assert.equal(ok.status, 200);
  const { src } = await ok.json();
  assert.match(src, /^\/media\/[0-9a-f]{16}\.png$/);
  assert.equal((await t.call('GET', src)).status, 200);
  await t.call('PUT', '/admin/api/content', { img: { 'index.hero.img2': { src, alt: 'Test' } } });
  assert.match(await (await t.call('GET', '/')).text(), new RegExp(`src="${src}"`));
  const evil = await t.call('PUT', '/admin/api/content', { img: { 'index.hero.img1': { src: 'https://evil/x.png', alt: '' } } });
  assert.equal(evil.status, 200);
  assert.doesNotMatch(await (await t.call('GET', '/')).text(), /evil\/x\.png/);
  t.close();
});

test('historikk: sikkerhetskopi kan gjenopprettes', async () => {
  const t = await start();
  await t.login();
  await t.call('PUT', '/admin/api/content', { text: { 'index.hero.h11': 'Versjon A' } });
  await t.call('PUT', '/admin/api/content', { text: { 'index.hero.h11': 'Versjon B' } });
  const { backups } = await (await t.call('GET', '/admin/api/backups')).json();
  assert.ok(backups.length >= 1);
  assert.equal((await t.call('POST', '/admin/api/restore', { name: '../../etc/passwd' })).status, 400);
  assert.equal((await t.call('POST', '/admin/api/restore', { name: backups[0] })).status, 200);
  assert.match(await (await t.call('GET', '/')).text(), /Versjon A/);
  t.close();
});

test('admin er avslått uten passord', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  const { app } = createApp({ siteDir: SITE, dataDir, password: '', secret: 'x' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CMS': '1' }, body: JSON.stringify({ user: 'admin', password: '' }),
  });
  assert.equal(res.status, 503);
  server.closeAllConnections(); server.close();
});
