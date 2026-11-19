'use strict';

// Statuses on the apply-yourself list. send_failed: the pipeline's email failed, apply by hand.
const OPEN = ['manual', 'send_failed'];
const TABS = {
  todo: j => OPEN.includes(j.status) && !j.hidden_at,
  applied: j => j.status === 'applied_manually',
  emailed: j => j.status === 'sent',
  hidden: j => OPEN.includes(j.status) && !!j.hidden_at,
};
const REGION_LABEL = { amsterdam: 'Amsterdam', berlin: 'Berlin', bayern: 'Bayern' };

const state = {
  jobs: [],
  meta: {},
  tab: 'todo',
  region: 'all',
  q: '',
  letterOnly: false,
  sort: { todo: 'fit', applied: 'new', emailed: 'new', hidden: 'fit' },
  current: null,      // id shown in the detail pane
  picked: new Set(),  // checked ids
};

const $ = id => document.getElementById(id);
const el = {
  tabs: $('tabs'), list: $('list'), empty: $('empty'), detail: $('detail'), search: $('search'),
  regions: $('regions'), sort: $('sort'), letterOnly: $('letter-only'), selbar: $('selbar'),
  selectAll: $('select-all'), selLabel: $('sel-label'), selActions: $('sel-actions'),
  error: $('error'), toast: $('toast'), layout: document.querySelector('.layout'),
};

// ------------------------------------------------------------------ helpers

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const regionLabel = r => REGION_LABEL[r] || (r ? r[0].toUpperCase() + r.slice(1) : 'Other');
const fitClass = f => f == null ? '' : f >= 70 ? 'good' : f >= 50 ? 'mid' : '';
const sourceLabel = s => String(s || '').replace(/^ats:/, '').replace(/^./, c => c.toUpperCase());
const byId = id => state.jobs.find(j => j.id === id);

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const fullDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  el.toast.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = Object.assign(document.createElement('button'), { textContent: action.label });
    b.onclick = () => { el.toast.hidden = true; action.run(); };
    el.toast.append(b);
  }
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, action ? 8000 : 2500);
}

function showError(msg) {
  el.error.textContent = msg || '';
  el.error.hidden = !msg;
}

// ------------------------------------------------------------------ data

async function load() {
  await flushLetter();
  try {
    const [{ jobs }, meta] = await Promise.all([api('/api/jobs'), api('/api/meta')]);
    state.jobs = jobs;
    state.meta = meta;
    showError('');
  } catch (e) {
    showError(`Could not load jobs. ${e.message}`);
  }
  const ids = new Set(state.jobs.map(j => j.id));
  for (const id of state.picked) if (!ids.has(id)) state.picked.delete(id);
  render();
}

function matches(j, { region = true } = {}) {
  if (!TABS[state.tab](j)) return false;
  if (region && state.region !== 'all' && (j.region || 'other') !== state.region) return false;
  if (state.letterOnly && !j.letter) return false;
  if (state.q) {
    const hay = `${j.company} ${j.title} ${j.city} ${j.region}`.toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function visible() {
  const rows = state.jobs.filter(j => matches(j));
  const newest = (a, b) => new Date(b.applied_at) - new Date(a.applied_at);
  const sorts = {
    fit: (a, b) => ((b.fit ?? -1) - (a.fit ?? -1)) || newest(a, b),
    new: newest,
    company: (a, b) => a.company.localeCompare(b.company, 'en') || a.title.localeCompare(b.title, 'en'),
  };
  return rows.sort(sorts[state.sort[state.tab]]);
}

// ------------------------------------------------------------------ render

function render() {
  for (const b of el.tabs.querySelectorAll('[data-tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    b.querySelector('.count').textContent = state.jobs.filter(TABS[b.dataset.tab]).length;
  }
  el.sort.value = state.sort[state.tab];
  renderRegions();

  const rows = visible();
  if (!rows.some(j => j.id === state.current)) state.current = rows[0]?.id ?? null;
  renderList(rows);
  renderSelbar(rows);
  // Filtering and sorting must not rebuild the letter editor (caret, scroll, half-typed text).
  if (shownJob !== (byId(state.current) || null)) renderDetail();
}

let shownJob = null;   // the job object the detail pane was built from; load() replaces objects

function renderRegions() {
  const counts = {};
  for (const j of state.jobs) if (matches(j, { region: false })) {
    const r = j.region || 'other';
    counts[r] = (counts[r] || 0) + 1;
  }
  if (state.region !== 'all' && !counts[state.region]) state.region = 'all';
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const order = ['amsterdam', 'berlin', 'bayern'];
  const keys = Object.keys(counts).sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)));
  el.regions.innerHTML = [['all', 'All', total], ...keys.map(k => [k, regionLabel(k), counts[k]])]
    .map(([k, label, n]) => `<button class="chip" data-region="${esc(k)}" aria-pressed="${state.region === k}">${esc(label)}<span class="n">${n}</span></button>`)
    .join('');
}

function renderList(rows) {
  const pickable = state.tab !== 'emailed';
  el.list.innerHTML = rows.map(j => {
    const letterTag = j.status === 'send_failed' ? '<span class="tag bad">email failed</span>'
      : j.letter ? '<span class="tag ok">letter</span>' : '<span class="tag">no letter</span>';
    return `<li class="row" role="option" data-id="${j.id}" aria-selected="${j.id === state.current}">
      ${pickable ? `<input type="checkbox" class="pick" aria-label="Select" ${state.picked.has(j.id) ? 'checked' : ''}>` : '<span></span>'}
      <span class="fit ${fitClass(j.fit)}" title="Fit score">${j.fit ?? '–'}</span>
      <div class="row-main">
        <div class="row-title" title="${esc(j.title)}">${esc(j.title)}</div>
        <div class="row-sub">${esc(j.company)}${j.city ? ' · ' + esc(j.city) : ''}</div>
      </div>
      <div class="row-side">${letterTag}<span>${esc(when(j.applied_at))}</span></div>
    </li>`;
  }).join('');
  el.empty.hidden = rows.length > 0;
  el.empty.textContent = state.jobs.some(TABS[state.tab])
    ? 'Nothing matches these filters.'
    : { todo: 'Nothing left to apply to.', applied: 'Nothing marked applied yet.',
        emailed: 'The pipeline has not emailed anything yet.', hidden: 'No hidden jobs.' }[state.tab];
}

function renderSelbar(rows) {
  const pickable = state.tab !== 'emailed';
  el.selbar.hidden = !pickable;
  if (!pickable) return;
  const shown = rows.filter(j => state.picked.has(j.id)).length;
  const n = state.picked.size;
  el.selbar.classList.toggle('has-sel', n > 0);
  el.selectAll.checked = rows.length > 0 && shown === rows.length;
  el.selectAll.indeterminate = shown > 0 && shown < rows.length;
  el.selLabel.textContent = n ? `${n} selected` : `Select all ${rows.length}`;
  const actions = {
    todo: [['apply', 'Mark applied', 'primary'], ['hide', 'Hide', '']],
    applied: [['reopen', 'Move back to To apply', '']],
    hidden: [['unhide', 'Unhide', '']],
  }[state.tab];
  el.selActions.innerHTML = n ? actions.map(([a, label, cls]) =>
    `<button class="btn ${cls}" data-bulk="${a}">${label}</button>`).join('')
    + '<button class="btn ghost" data-bulk="clear">Clear</button>' : '';
}

function renderDetail() {
  const j = byId(state.current);
  shownJob = j || null;
  if (!j) {
    el.detail.innerHTML = `<div class="placeholder">${state.jobs.length ? 'Select a job on the left.' : ''}</div>`;
    return;
  }
  const url = safeUrl(j.url);
  const open = OPEN.includes(j.status);
  const editable = open || j.status === 'applied_manually';

  let banner = '';
  if (j.status === 'send_failed') {
    banner = `<div class="banner bad">The pipeline's email${j.contact_email ? ' to ' + esc(j.contact_email) : ''} failed. Apply by hand.</div>`;
  } else if (j.status === 'sent') {
    banner = `<div class="banner ok">Emailed by the pipeline${j.contact_email ? ' to <b>' + esc(j.contact_email) + '</b>' : ''} on ${fullDate(j.applied_at)}.</div>`;
  } else if (j.status === 'applied_manually') {
    banner = `<div class="banner ok">Marked applied on ${fullDate(j.applied_at)}. The pipeline skips this company for <code>rememberDays</code>.</div>`;
  } else if (j.hidden_at) {
    banner = `<div class="banner">Hidden from your list on ${fullDate(j.hidden_at)}.</div>`;
  }

  const buttons = [];
  if (url) {
    buttons.push(j.letter && editable
      ? `<button class="btn primary" data-act="open-copy" title="Copies the letter, then opens the posting (o)">Open posting + copy letter</button>`
      : `<a class="btn ${open ? 'primary' : ''}" href="${esc(url)}" target="_blank" rel="noopener">Open posting</a>`);
  }
  if (j.letter) buttons.push(`<button class="btn" data-act="copy" title="c">Copy letter</button>`);
  buttons.push('<span class="spacer"></span>');
  if (open && !j.hidden_at) {
    buttons.push(`<button class="btn" data-act="apply" title="a">&#x2713; Mark applied</button>`);
    buttons.push(`<button class="btn ghost" data-act="hide" title="h">Hide</button>`);
  } else if (open) {
    buttons.push(`<button class="btn" data-act="unhide" title="h">Unhide</button>`);
  } else if (j.status === 'applied_manually') {
    buttons.push(`<button class="btn" data-act="reopen">Move back to To apply</button>`);
  }

  const region = regionLabel(j.region);
  const meta = [
    j.city && `<span>${esc(j.city)}</span>`,
    !String(j.city || '').toLowerCase().includes(region.toLowerCase()) && `<span>${esc(region)}</span>`,
    j.fit != null && `<span>Fit <b>${j.fit}</b></span>`,
    j.source && `<span>via ${esc(sourceLabel(j.source))}</span>`,
    j.lang && `<span>${esc(j.lang)}</span>`,
    `<span>added ${esc(when(j.applied_at))}</span>`,
  ].filter(Boolean).join('');

  el.detail.innerHTML = `<article class="detail">
    <button class="btn ghost back" data-act="back">&larr; Back to list</button>
    <div class="eyebrow">${esc(j.company)}</div>
    <h2>${esc(j.title)}</h2>
    <div class="meta">${meta}</div>
    ${banner}
    <div class="actions">${buttons.join('')}</div>
    ${url ? `<div class="link-line"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div>` : ''}
    ${j.score_reason ? `<section class="card"><h3>Fit assessment</h3><p>${esc(j.score_reason)}</p></section>` : ''}
    <section class="card">
      <h3>Cover letter <span class="save-state" id="save-state"></span></h3>
      ${j.letter != null && j.letter !== ''
        ? `<textarea class="letter" id="letter" spellcheck="true" ${editable ? '' : 'readonly'}>${esc(j.letter)}</textarea>`
        : '<p class="no-letter">No letter was generated for this role. The pipeline writes letters for the best apply-yourself jobs each run (<code>maxApplyYourselfLetters</code>).</p>'}
    </section>
  </article>`;
}

// ------------------------------------------------------------------ letter edits (autosave)

let pending = null;   // { id, text, timer }

function setSaveState(text) {
  const s = $('save-state');
  if (s) s.textContent = text;
}

async function flushLetter() {
  if (!pending) return;
  const { id, text, timer } = pending;
  clearTimeout(timer);
  pending = null;
  try {
    await api('/api/jobs/letter', { id, letter: text });
    if (state.current === id) setSaveState('Saved');
  } catch (e) {
    if (state.current === id) setSaveState('Save failed');
    toast(`Letter not saved: ${e.message}`);
  }
}

el.detail.addEventListener('input', e => {
  if (e.target.id !== 'letter') return;
  const j = byId(state.current);
  if (j) j.letter = e.target.value;   // so a re-render shows what was typed, not the saved copy
  if (pending) clearTimeout(pending.timer);
  pending = { id: state.current, text: e.target.value, timer: setTimeout(flushLetter, 700) };
  setSaveState('Saving…');
});

window.addEventListener('beforeunload', () => {
  if (pending) {
    fetch('/api/jobs/letter', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pending.id, letter: pending.text }),
    });
  }
});

// ------------------------------------------------------------------ actions

function currentLetter() {
  const ta = $('letter');
  return ta ? ta.value : (byId(state.current)?.letter || '');
}

// The row to show once `ids` leave this tab: the next one down, else the one above.
function nextAfter(ids) {
  const rows = visible();
  const i = rows.findIndex(j => j.id === state.current);
  const rest = rows.filter(j => !ids.includes(j.id));
  if (!ids.includes(state.current)) return state.current;
  return (rows.slice(i + 1).find(j => !ids.includes(j.id)) || rest[rest.length - 1])?.id ?? null;
}

async function mutate(fn, ids) {
  const next = nextAfter(ids);
  try {
    const result = await fn();
    for (const id of ids) state.picked.delete(id);
    state.current = next;
    await load();
    return result;
  } catch (e) {
    toast(`Failed: ${e.message}`);
    return null;
  }
}

async function markApplied(ids) {
  await flushLetter();
  const r = await mutate(() => api('/api/jobs/apply', { ids }), ids);
  if (!r) return;
  const label = r.changed === 1 ? `Marked applied: ${byId(r.undo[0].id)?.company}` : `Marked ${r.changed} as applied`;
  toast(label, { label: 'Undo', run: () => reopen(r.undo, { silent: true }) });
}

async function reopen(rows, { silent } = {}) {
  const ids = rows.map(r => r.id);
  const r = await mutate(() => api('/api/jobs/reopen', { rows }), ids);
  if (r && !silent) toast(r.changed === 1 ? 'Moved back to To apply' : `Moved ${r.changed} back to To apply`);
}

async function setHidden(ids, hidden) {
  const r = await mutate(() => api('/api/jobs/hide', { ids, hidden }), ids);
  if (!r) return;
  toast(hidden ? (ids.length === 1 ? 'Hidden' : `Hid ${ids.length}`) : 'Back on the list',
    { label: 'Undo', run: () => mutate(() => api('/api/jobs/hide', { ids, hidden: !hidden }), []) });
}

async function openAndCopy() {
  const j = byId(state.current);
  const url = safeUrl(j?.url);
  if (!j) return;
  // Copy first: once the new tab has focus, the clipboard write is refused.
  if (j.letter && await copy(currentLetter())) toast('Letter copied, opening the posting');
  if (url) window.open(url, '_blank', 'noopener');
  else toast('This job has no link');
}

async function act(name) {
  const j = byId(state.current);
  if (!j) return;
  const open = OPEN.includes(j.status);
  switch (name) {
    case 'open-copy': return openAndCopy();
    case 'copy':
      if (!currentLetter()) return toast('No letter for this job');
      return toast(await copy(currentLetter()) ? 'Letter copied' : 'Copy failed');
    case 'apply': return open && !j.hidden_at && markApplied([j.id]);
    case 'hide': return open && setHidden([j.id], !j.hidden_at);
    case 'unhide': return open && setHidden([j.id], false);
    case 'reopen': return j.status === 'applied_manually' && reopen([{ id: j.id }]);
    case 'back': return el.layout.classList.remove('show-detail');
  }
}

function select(id, { scroll = false, showDetail = false } = {}) {
  if (id == null || id === state.current) {
    if (showDetail) el.layout.classList.add('show-detail');
    return;
  }
  flushLetter();
  state.current = id;
  for (const li of el.list.children) li.setAttribute('aria-selected', String(Number(li.dataset.id) === id));
  renderDetail();
  el.detail.scrollTop = 0;
  if (showDetail) el.layout.classList.add('show-detail');
  if (scroll) el.list.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function move(delta) {
  const rows = visible();
  const i = rows.findIndex(j => j.id === state.current);
  const n = rows[Math.max(0, Math.min(rows.length - 1, i + delta))];
  if (n) select(n.id, { scroll: true });
}

function togglePick(id, on = !state.picked.has(id)) {
  if (on) state.picked.add(id); else state.picked.delete(id);
  const box = el.list.querySelector(`[data-id="${id}"] .pick`);
  if (box) box.checked = on;
  renderSelbar(visible());
}

// ------------------------------------------------------------------ events

el.tabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b || b.dataset.tab === state.tab) return;
  flushLetter();
  state.tab = b.dataset.tab;
  state.picked.clear();
  state.current = null;
  render();
});

el.regions.addEventListener('click', e => {
  const b = e.target.closest('[data-region]');
  if (!b) return;
  state.region = b.dataset.region;
  render();
});

el.search.addEventListener('input', () => { state.q = el.search.value.trim(); render(); });
el.sort.addEventListener('change', () => { state.sort[state.tab] = el.sort.value; render(); });
el.letterOnly.addEventListener('change', () => { state.letterOnly = el.letterOnly.checked; render(); });

el.list.addEventListener('click', e => {
  const li = e.target.closest('.row');
  if (!li) return;
  const id = Number(li.dataset.id);
  if (e.target.classList.contains('pick')) return togglePick(id, e.target.checked);
  select(id, { showDetail: true });
});

el.selectAll.addEventListener('change', () => {
  for (const j of visible()) {
    if (el.selectAll.checked) state.picked.add(j.id); else state.picked.delete(j.id);
  }
  render();
});

el.selActions.addEventListener('click', e => {
  const b = e.target.closest('[data-bulk]');
  if (!b) return;
  const ids = [...state.picked];
  switch (b.dataset.bulk) {
    case 'apply': return markApplied(ids);
    case 'hide': return setHidden(ids, true);
    case 'unhide': return setHidden(ids, false);
    case 'reopen': return reopen(ids.map(id => ({ id })));
    case 'clear': state.picked.clear(); return render();
  }
});

el.detail.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act);
});

$('refresh').addEventListener('click', async () => { await load(); toast('Reloaded'); });
$('cv-path').addEventListener('click', async () => {
  if (!state.meta.cvExists) return toast(`No CV at ${state.meta.cvPath || 'cv/'}`);
  toast(await copy(state.meta.cvPath) ? 'CV path copied. Paste it into the upload dialog' : 'Copy failed');
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Checkboxes don't count: after ticking one, j/k should still move.
  const typing = e.target.closest('input:not([type="checkbox"]), textarea, select');
  if (e.key === 'Escape') {
    if (typing) e.target.blur();
    else if (state.picked.size) { state.picked.clear(); render(); }
    return;
  }
  if (typing) return;
  const keys = {
    j: () => move(1), ArrowDown: () => move(1),
    k: () => move(-1), ArrowUp: () => move(-1),
    o: () => act('open-copy'),
    c: () => act('copy'),
    a: () => act('apply'),
    h: () => act('hide'),
    x: () => state.current != null && state.tab !== 'emailed' && togglePick(state.current),
    '/': () => el.search.focus(),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});

load();
