'use strict';
// Enkel enbruker-innlogging: passord fra miljøvariabel, signert sesjonscookie, begrenset antall forsøk.
const crypto = require('node:crypto');

const COOKIE = 'ft_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function createAuth({ user, password, secret }) {
  const fails = new Map();
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

  const enabled = Boolean(password && password.length >= 8);

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function isAuthed(req) {
    if (!enabled) return false;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expect = sign(exp);
    return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  }

  function lockedFor(ip) {
    const f = fails.get(ip);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) return f.until - Date.now();
    return 0;
  }

  function attempt(ip, u, p) {
    if (!enabled) return { ok: false, status: 503, error: 'Admin er ikke satt opp (ADMIN_PASSWORD mangler).' };
    const wait = lockedFor(ip);
    if (wait) return { ok: false, status: 429, error: `For mange forsøk. Prøv igjen om ${Math.ceil(wait / 60000)} min.` };
    const good = same(u, user) & same(p, password); // begge sjekkes alltid
    if (!good) {
      const f = fails.get(ip) || { count: 0, until: 0 };
      f.count = f.until > Date.now() || f.count < MAX_FAILS ? f.count + 1 : 1;
      f.until = Date.now() + LOCK_MS;
      fails.set(ip, f);
      return { ok: false, status: 401, error: 'Feil brukernavn eller passord.' };
    }
    fails.delete(ip);
    const exp = String(Date.now() + SESSION_MS);
    return { ok: true, token: `${exp}.${sign(exp)}` };
  }

  function cookie(token, secure) {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }
  function clearCookie(secure) {
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  return { enabled, isAuthed, attempt, cookie, clearCookie };
}

module.exports = { createAuth };
