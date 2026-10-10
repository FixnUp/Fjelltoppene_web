/* Fjelltoppene admin: redigering direkte på siden. Ingen avhengigheter. */
(() => {
  'use strict';
  const CFG = window.__CMS__ || {};
  const OVR = CFG.overrides || { text: [], img: [], href: [], lists: [] };
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'A', 'SMALL', 'MARK']);
  const UI = '.cms-bar,.cms-modal-bg,.cms-chip,.cms-fmt,.cms-item-bar,.cms-add,.cms-toast';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = { text: new Map(), img: new Map(), href: new Map(), lists: new Set() };
  let dirty = 0;

  document.body.classList.add('cms-on');

  // ---------- hjelpere ----------
  async function api(method, url, body, headers = {}) {
    const isRaw = body instanceof Blob;
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-CMS': '1', ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (isRaw ? body : JSON.stringify(body)) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/admin'; throw new Error('Økten har utløpt'); }
    if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);
    return data;
  }

  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = `cms-toast${isErr ? ' cms-err' : ''}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 5000 : 2400);
  }

  function modal({ title, body, ok = 'OK', cancel = 'Avbryt', input }) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'cms-modal-bg';
      const box = document.createElement('div');
      box.className = 'cms-modal';
      const h = document.createElement('h3'); h.textContent = title; box.appendChild(h);
      if (body) { const p = document.createElement('small'); p.textContent = body; box.appendChild(p); }
      let field = null;
      if (input !== undefined) {
        field = document.createElement('input'); field.type = 'text'; field.value = input;
        box.appendChild(field);
      }
      const row = document.createElement('div'); row.className = 'cms-row';
      const c = document.createElement('button'); c.textContent = cancel;
      const o = document.createElement('button'); o.textContent = ok; o.className = 'cms-primary';
      row.append(c, o); box.appendChild(row); bg.appendChild(box); document.body.appendChild(bg);
      const done = (v) => { bg.remove(); resolve(v); };
      c.onclick = () => done(null);
      o.onclick = () => done(field ? field.value : true);
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(null); });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter' && field) done(field.value);
      });
      (field || o).focus();
    });
  }

  function markChanged(el) { el.classList.add('cms-changed'); }
  function bump() {
    dirty = state.text.size + state.img.size + state.href.size + state.lists.size;
    save.disabled = dirty === 0;
    save.textContent = dirty ? `Lagre (${dirty})` : 'Lagre';
    window.onbeforeunload = dirty ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
  }

  // ---------- verktøylinje ----------
  const bar = document.createElement('div');
  bar.className = 'cms-bar';
  const pages = [['Forside', '/?edit', 'index'], ['Personvern', '/privacy?edit', 'privacy'], ['Tilbakemelding', '/feedback?edit', 'feedback']];
  bar.innerHTML = '<span class="cms-title">✎ Redigerer</span>';
  for (const [label, href, id] of pages) {
    const a = document.createElement('a'); a.textContent = label; a.href = href;
    if (id === CFG.page) a.className = 'cms-cur';
    bar.appendChild(a);
  }
  const sp = document.createElement('span'); sp.className = 'cms-sp'; bar.appendChild(sp);
  const mk = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; bar.appendChild(b); return b; };
  mk('Historikk', showHistory);
  const view = document.createElement('a'); view.textContent = 'Se siden ↗'; view.href = CFG.page === 'index' ? '/' : `/${CFG.page}`; view.target = '_blank'; view.rel = 'noopener'; bar.appendChild(view);
  mk('Logg ut', async () => { try { await api('POST', '/admin/logout'); } catch { /* ignorer */ } window.onbeforeunload = null; location.href = '/'; });
  const save = mk('Lagre', doSave, 'cms-save');
  save.disabled = true;
  document.body.prepend(bar);

  // ---------- tekst ----------
  function makeEditable(el) {
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.setAttribute('data-cms-edit', '');
  }

  function isTextLeaf(el) {
    if (['IMG', 'SVG', 'SCRIPT', 'STYLE', 'BUTTON'].includes(el.tagName.toUpperCase())) return false;
    let hasText = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) hasText = true;
      else if (n.nodeType === 1 && !INLINE.has(n.tagName)) return false;
      else if (n.nodeType === 1 && n.querySelector('img,svg')) return false;
    }
    return hasText;
  }

  function initLeaves(root, onInput) {
    const walk = (el) => {
      for (const child of Array.from(el.children)) {
        if (child.matches('.cms-item-bar,img,svg')) continue;
        if (isTextLeaf(child)) { makeEditable(child); child.addEventListener('input', onInput); }
        else walk(child);
      }
    };
    walk(root);
  }

  $$('[data-cms]').forEach((el) => {
    const key = el.getAttribute('data-cms');
    makeEditable(el);
    el.addEventListener('input', () => { state.text.set(key, el.innerHTML); markChanged(el); bump(); });
  });

  document.addEventListener('keydown', (e) => {
    const el = e.target.closest && e.target.closest('[contenteditable="true"]');
    if (!el) return;
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
    if (e.key === ' ' && el.closest('summary')) { e.preventDefault(); document.execCommand('insertText', false, ' '); }
  }, true);
  document.addEventListener('paste', (e) => {
    const el = e.target.closest && e.target.closest('[contenteditable="true"]');
    if (!el) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' '));
  }, true);

  // Lenker, sammendrag og knapper skal ikke virke mens vi redigerer
  document.addEventListener('click', (e) => {
    if (e.target.closest(UI)) return;
    if (e.target.closest('a,summary,button,[data-cms-img],[data-cms-list] img')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // ---------- formatering ----------
  const fmt = document.createElement('div');
  fmt.className = 'cms-fmt';
  let savedRange = null;
  [['B', 'bold', 'Fet'], ['I', 'italic', 'Kursiv'], ['🔗', 'link', 'Lenke'], ['✕', 'removeFormat', 'Fjern formatering']].forEach(([label, cmd, title]) => {
    const b = document.createElement('button'); b.textContent = label; b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', async () => {
      if (cmd === 'link') {
        const range = savedRange;
        const url = await modal({ title: 'Lenke', body: 'Adresse (https://…, mailto:… eller /side)', input: 'https://', ok: 'Sett inn' });
        if (url === null) return;
        const sel = getSelection(); sel.removeAllRanges(); if (range) sel.addRange(range);
        if (url.trim() === '' || url.trim() === 'https://') document.execCommand('unlink');
        else document.execCommand('createLink', false, url.trim());
      } else document.execCommand(cmd);
      const host = (getSelection().anchorNode?.parentElement || document.body).closest('[contenteditable="true"]');
      if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fmt.appendChild(b);
  });
  document.body.appendChild(fmt);

  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { fmt.style.display = 'none'; return; }
    const host = (sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)).closest('[contenteditable="true"]');
    if (!host) { fmt.style.display = 'none'; return; }
    savedRange = sel.getRangeAt(0).cloneRange();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    fmt.style.display = 'flex';
    fmt.style.top = `${window.scrollY + r.top - 46}px`;
    fmt.style.left = `${Math.max(8, window.scrollX + r.left)}px`;
  });

  // ---------- bilder ----------
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/gif'; picker.hidden = true;
  document.body.appendChild(picker);

  async function shrink(file) {
    if (file.type === 'image/gif' || file.size < 2.5 * 1024 * 1024) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.9));
  }

  function chooseFile() {
    return new Promise((resolve) => {
      picker.value = '';
      picker.onchange = () => resolve(picker.files[0] || null);
      picker.click();
    });
  }

  async function replaceImage(img) {
    const file = await chooseFile();
    if (!file) return;
    try {
      toast('Laster opp …');
      const blob = await shrink(file);
      const { src } = await api('POST', '/admin/api/upload', blob, { 'Content-Type': blob.type || file.type });
      const alt = await modal({ title: 'Beskrivelse av bildet', body: 'Alternativ tekst for skjermlesere', input: img.alt || '', ok: 'Bruk bildet' });
      img.src = src;
      if (alt !== null) img.alt = alt;
      const key = img.getAttribute('data-cms-img');
      if (key) state.img.set(key, { src, alt: img.alt });
      else { const list = img.closest('[data-cms-list]'); if (list) state.lists.add(list.getAttribute('data-cms-list')); }
      markChanged(img); bump();
    } catch (err) { toast(err.message, true); }
  }

  // ---------- svevende verktøy for bilder og lenker ----------
  const chip = document.createElement('div');
  chip.className = 'cms-chip';
  document.body.appendChild(chip);
  let chipTimer = null;
  const hideChip = () => { chipTimer = setTimeout(() => { chip.style.display = 'none'; }, 250); };
  chip.addEventListener('mouseenter', () => clearTimeout(chipTimer));
  chip.addEventListener('mouseleave', hideChip);

  function showChip(target, buttons) {
    clearTimeout(chipTimer);
    chip.replaceChildren();
    for (const [label, fn] of buttons) {
      const b = document.createElement('button'); b.textContent = label; b.onclick = () => { chip.style.display = 'none'; fn(); };
      chip.appendChild(b);
    }
    const r = target.getBoundingClientRect();
    chip.style.display = 'flex';
    chip.style.top = `${window.scrollY + Math.max(r.top, 56) + 6}px`;
    chip.style.left = `${window.scrollX + Math.max(8, r.left) + 6}px`;
  }

  async function resetKey(type, key) {
    if (!(await modal({ title: 'Tilbakestille?', body: 'Dette fjerner endringen din og viser originalen igjen.', ok: 'Tilbakestill' }))) return;
    try { await api('PUT', '/admin/api/content', { reset: [`${type}:${key}`] }); window.onbeforeunload = null; location.reload(); } catch (err) { toast(err.message, true); }
  }

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest(UI)) return;
    const img = e.target.closest('img[data-cms-img], [data-cms-list] img');
    if (img) {
      const key = img.getAttribute('data-cms-img');
      const btns = [['Bytt bilde', () => replaceImage(img)]];
      if (key && OVR.img.includes(key)) btns.push(['Tilbakestill', () => resetKey('img', key)]);
      showChip(img, btns); return;
    }
    const a = e.target.closest('a[data-cms-href]');
    if (a) {
      const key = a.getAttribute('data-cms-href');
      const btns = [['Endre lenke', async () => {
        const v = await modal({ title: 'Lenkeadresse', body: 'Hvor skal knappen sende besøkende?', input: a.getAttribute('href') || '', ok: 'Bruk' });
        if (v === null) return;
        a.setAttribute('href', v.trim()); state.href.set(key, v.trim()); markChanged(a); bump();
      }]];
      if (OVR.href.includes(key)) btns.push(['Tilbakestill', () => resetKey('href', key)]);
      showChip(a, btns); return;
    }
    const t = e.target.closest('[data-cms]');
    if (t && OVR.text.includes(t.getAttribute('data-cms'))) showChip(t, [['Tilbakestill tekst', () => resetKey('text', t.getAttribute('data-cms'))]]);
  });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.cms-chip')) hideChip(); });

  // ---------- lister (FAQ, skjermbilder, nyheter) ----------
  function listKey(list) { return list.getAttribute('data-cms-list'); }
  function listChanged(list) { state.lists.add(listKey(list)); markChanged(list); bump(); }

  function decorateItem(list, item) {
    item.classList.add('cms-item');
    $$(':scope > .cms-item-bar', item).forEach((x) => x.remove());
    $$('details', item).concat(item.matches('details') ? [item] : []).forEach((d) => {
      if (d.dataset.cmsOpen0 === undefined) d.dataset.cmsOpen0 = d.open ? '1' : '';
      d.open = true;
    });
    const tools = document.createElement('div');
    tools.className = 'cms-item-bar';
    tools.contentEditable = 'false';
    const btn = (label, title, fn, cls) => { const b = document.createElement('button'); b.textContent = label; b.title = title; if (cls) b.className = cls; b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); }; tools.appendChild(b); };
    btn('↑', 'Flytt opp', () => { const p = item.previousElementSibling; if (p) { item.parentNode.insertBefore(item, p); listChanged(list); } });
    btn('↓', 'Flytt ned', () => { const n = item.nextElementSibling; if (n && !n.classList.contains('cms-item-bar')) { item.parentNode.insertBefore(n, item); listChanged(list); } });
    btn('⧉', 'Lag kopi', () => { const c = cloneItem(item); item.after(c); decorateItem(list, c); listChanged(list); });
    btn('✕', 'Slett', async () => {
      if (await modal({ title: 'Slette dette elementet?', body: 'Du kan hente det tilbake via Historikk så lenge du ikke har lagret.', ok: 'Slett' })) { item.remove(); listChanged(list); }
    }, 'cms-danger');
    item.prepend(tools);
    initLeaves(item, () => listChanged(list));
  }

  function cloneItem(item) {
    const c = item.cloneNode(true);
    $$('.cms-item-bar', c).forEach((x) => x.remove());
    $$('[data-cms-edit]', c).forEach((x) => { x.removeAttribute('data-cms-edit'); x.removeAttribute('contenteditable'); });
    $$('details', c).concat(c.matches('details') ? [c] : []).forEach((d) => { d.dataset.cmsOpen0 = ''; });
    c.classList.remove('cms-changed');
    return c;
  }

  $$('[data-cms-list]').forEach((list) => {
    Array.from(list.children).forEach((item) => decorateItem(list, item));
    const add = document.createElement('button');
    add.className = 'cms-add'; add.type = 'button'; add.textContent = '+ Legg til';
    add.onclick = () => {
      const items = Array.from(list.children).filter((c) => c.classList.contains('cms-item'));
      const last = items[items.length - 1];
      if (!last) return;
      const c = cloneItem(last); list.appendChild(c); decorateItem(list, c); listChanged(list);
      c.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    list.after(add);
    if (OVR.lists.includes(listKey(list))) {
      const reset = document.createElement('button');
      reset.className = 'cms-add'; reset.type = 'button'; reset.textContent = 'Tilbakestill hele listen til original';
      reset.style.marginTop = '8px'; reset.style.borderColor = '#a12020'; reset.style.color = '#a12020';
      reset.onclick = () => resetKey('lists', listKey(list));
      add.after(reset);
    }
  });

  function cleanList(list) {
    const c = list.cloneNode(true);
    $$('.cms-item-bar', c).forEach((x) => x.remove());
    $$('[data-cms-edit]', c).forEach((x) => { x.removeAttribute('data-cms-edit'); x.removeAttribute('contenteditable'); x.removeAttribute('spellcheck'); });
    $$('details', c).forEach((d) => { if (d.dataset.cmsOpen0) d.setAttribute('open', ''); else d.removeAttribute('open'); delete d.dataset.cmsOpen0; });
    $$('.cms-item,.cms-changed', c).forEach((x) => x.classList.remove('cms-item', 'cms-changed'));
    return c.innerHTML;
  }

  // ---------- lagre ----------
  async function doSave() {
    if (!dirty) return;
    save.disabled = true; save.textContent = 'Lagrer …';
    try {
      const lists = {};
      $$('[data-cms-list]').forEach((l) => { if (state.lists.has(listKey(l))) lists[listKey(l)] = cleanList(l); });
      await api('PUT', '/admin/api/content', {
        text: Object.fromEntries(state.text),
        img: Object.fromEntries(state.img),
        href: Object.fromEntries(state.href),
        lists,
      });
      state.text.clear(); state.img.clear(); state.href.clear(); state.lists.clear();
      $$('.cms-changed').forEach((x) => x.classList.remove('cms-changed'));
      bump();
      toast('Lagret. Endringene er publisert.');
    } catch (err) { toast(err.message, true); bump(); }
  }

  async function showHistory() {
    try {
      const { backups } = await api('GET', '/admin/api/backups');
      const bg = document.createElement('div'); bg.className = 'cms-modal-bg';
      const box = document.createElement('div'); box.className = 'cms-modal';
      box.innerHTML = '<h3>Historikk</h3><small>Hver gang du lagrer, tas det en sikkerhetskopi av forrige versjon. Velg en for å gå tilbake.</small>';
      const ul = document.createElement('ul');
      if (!backups.length) { const li = document.createElement('li'); li.textContent = 'Ingen sikkerhetskopier ennå.'; ul.appendChild(li); }
      for (const name of backups.slice(0, 25)) {
        const li = document.createElement('li');
        const when = name.replace(/^content-/, '').replace(/\.json$/, '').replace(/T(\d\d)-(\d\d)-(\d\d).*/, ' $1:$2:$3');
        const label = document.createElement('span'); label.textContent = when;
        const b = document.createElement('button'); b.textContent = 'Gjenopprett';
        b.onclick = async () => {
          if (!(await modal({ title: 'Gjenopprette denne versjonen?', body: `Nåværende innhold lagres som sikkerhetskopi først. (${when})`, ok: 'Gjenopprett' }))) return;
          try { await api('POST', '/admin/api/restore', { name }); window.onbeforeunload = null; location.reload(); } catch (err) { toast(err.message, true); }
        };
        li.append(label, b); ul.appendChild(li);
      }
      const row = document.createElement('div'); row.className = 'cms-row';
      const close = document.createElement('button'); close.textContent = 'Lukk'; close.onclick = () => bg.remove();
      row.appendChild(close);
      box.append(ul, row); bg.appendChild(box); document.body.appendChild(bg);
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); });
    } catch (err) { toast(err.message, true); }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
  });
})();
