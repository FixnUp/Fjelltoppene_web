'use strict';
// Leser sidene fra disk og legger redigert innhold oppå (tekst, bilder, lenker, lister).
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { cleanInline, cleanBlock, safeHref, safeSrc } = require('./sanitize');

const PAGES = { index: 'index.html', privacy: 'privacy.html', feedback: 'feedback.html', logo: 'logo.html', 'send-inn': 'send-inn.html' };

function createRenderer({ siteDir, store }) {
  const raw = {};
  const cache = new Map();

  function source(page) {
    const file = path.join(siteDir, PAGES[page]);
    const mtime = fs.statSync(file).mtimeMs;
    if (!raw[page] || raw[page].mtime !== mtime) raw[page] = { mtime, html: fs.readFileSync(file, 'utf8') };
    return raw[page].html;
  }

  function apply($, c) {
    $('[data-cms]').each((_, el) => {
      const v = c.text[el.attribs['data-cms']];
      if (typeof v === 'string') $(el).html(cleanInline(v));
    });
    $('[data-cms-img]').each((_, el) => {
      const o = c.img[el.attribs['data-cms-img']];
      if (!o) return;
      const src = safeSrc(o.src);
      if (src) $(el).attr('src', src);
      if (typeof o.alt === 'string') $(el).attr('alt', o.alt.slice(0, 300));
    });
    $('[data-cms-href]').each((_, el) => {
      const h = safeHref(c.href[el.attribs['data-cms-href']]);
      if (h) $(el).attr('href', h);
    });
    $('[data-cms-list]').each((_, el) => {
      const v = c.lists[el.attribs['data-cms-list']];
      if (typeof v === 'string') $(el).html(cleanBlock(v));
    });
  }

  function render(page, { edit = false } = {}) {
    if (!PAGES[page]) return null;
    const html = source(page);
    const c = store.get();
    const hasOverrides = ['text', 'img', 'href', 'lists'].some((k) => Object.keys(c[k] || {}).length);
    if (!hasOverrides && !edit) return html;

    const cacheKey = `${page}:${edit}:${store.version()}:${raw[page].mtime}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const $ = cheerio.load(html);
    apply($, c);
    if (edit) {
      $('head').append('<meta name="robots" content="noindex"><link rel="stylesheet" href="/admin/static/editor.css">');
      $('body').append(`<script>window.__CMS__=${JSON.stringify({ page, overrides: { text: Object.keys(c.text), img: Object.keys(c.img), href: Object.keys(c.href), lists: Object.keys(c.lists) } })};</script><script src="/admin/static/editor.js"></script>`);
    }
    const out = $.html();
    for (const k of cache.keys()) if (!k.includes(`:${store.version()}:`)) cache.delete(k);
    cache.set(cacheKey, out);
    return out;
  }

  return { render, pages: Object.keys(PAGES) };
}

module.exports = { createRenderer, PAGES };
