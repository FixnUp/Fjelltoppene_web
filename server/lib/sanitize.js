'use strict';
// Renser HTML som kommer fra admin-editoren. Alt som ikke står på hviteliste fjernes.
const cheerio = require('cheerio');

const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'span', 'a', 'small', 'mark']);
const BLOCK_TAGS = new Set([
  ...INLINE_TAGS, 'div', 'p', 'h3', 'h4', 'ul', 'ol', 'li', 'details', 'summary', 'img',
]);
const ATTRS = {
  '*': ['class'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'loading'],
  details: ['open'],
};
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'link', 'meta', 'form', 'noscript',
]);

const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/;
const SAFE_HREF = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|\/[^\s"'<>]*|#[^\s"'<>]*|[A-Za-z0-9_./-]+\.html(#[^\s"'<>]*)?)$/;
const SAFE_SRC = /^(\/?assets\/[A-Za-z0-9_./-]+|\/media\/[A-Za-z0-9_.-]+)$/;

function safeHref(v) {
  const s = String(v || '').trim();
  return SAFE_HREF.test(s) ? s : null;
}
function safeSrc(v) {
  const s = String(v || '').trim();
  return SAFE_SRC.test(s) && !s.includes('..') ? s : null;
}

function clean(fragment, allowed) {
  const $ = cheerio.load(String(fragment ?? ''), null, false);
  const root = $.root();
  let changed = true;
  while (changed) {
    changed = false;
    root.find('*').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) { $(el).remove(); changed = true; return false; }
      if (!allowed.has(tag)) { $(el).replaceWith($(el).contents()); changed = true; return false; }
      return undefined;
    });
  }
  root.find('*').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const okAttrs = [...(ATTRS['*'] || []), ...(ATTRS[tag] || [])];
    for (const name of Object.keys(el.attribs)) {
      if (!okAttrs.includes(name)) { $(el).removeAttr(name); continue; }
      const val = el.attribs[name];
      if (name === 'class') {
        const tokens = val.split(/\s+/).filter((t) => CLASS_TOKEN.test(t) && !t.startsWith('cms-'));
        if (tokens.length) $(el).attr('class', tokens.join(' ')); else $(el).removeAttr('class');
      } else if (name === 'href') {
        const h = safeHref(val);
        if (h) $(el).attr('href', h); else $(el).removeAttr('href');
      } else if (name === 'src') {
        const s = safeSrc(val);
        if (s) $(el).attr('src', s); else $(el).remove();
      } else if (name === 'target') {
        if (val === '_blank') $(el).attr('rel', 'noopener'); else $(el).removeAttr('target');
      } else if (name === 'rel') {
        $(el).attr('rel', 'noopener');
      } else if (name === 'loading') {
        $(el).attr('loading', 'lazy');
      } else if (name === 'alt') {
        $(el).attr('alt', val.slice(0, 300));
      } else if (name === 'open') {
        $(el).attr('open', '');
      }
    }
  });
  return (root.html() || '').trim();
}

const cleanInline = (html) => clean(html, INLINE_TAGS);
const cleanBlock = (html) => clean(html, BLOCK_TAGS);

module.exports = { cleanInline, cleanBlock, safeHref, safeSrc };
