// ═══════════════════════════════════════════════════════════════════════════
// vGPT core — shared state, Venice API client, model-capability helpers,
// asset library, and UI primitives. Imported by tools.js and app.js.
// ═══════════════════════════════════════════════════════════════════════════

// ── icons (feather-style) ───────────────────────────────────────────────────
const P = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
  upscale: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>',
  video: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>',
  play: '<path d="M5 3l14 9-14 9V3z"/>',
  sparkles: '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.94-.4Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2Z"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
  caretLeft: '<path d="M15 18l-6-6 6-6"/>',
  caretRight: '<path d="M9 18l6-6-6-6"/>',
  enter: '<path d="M9 10l-5 5 5 5"/><path d="M4 15h11a5 5 0 0 0 5-5V4"/>',
  power: '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  cassette: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M8 18h8"/>',
};
export function icon(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function el(tag, attrs = {}, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  if (children != null) (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return n;
}

export function toast(msg, type = '') {
  const host = $('#toasts');
  const ic = type === 'err' ? icon('info', 17) : type === 'ok' ? icon('check', 17) : icon('zap', 17);
  const t = el('div', { class: `toast ${type}`, html: `${ic}<span></span>` });
  t.querySelector('span').textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 5200 : 3200);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── small GFM-ish markdown renderer for chat ────────────────────────────────
// Supports: headings, bold/italic/strikethrough, inline + fenced code, links,
// images, blockquotes, ordered/unordered lists, horizontal rules and tables.
function inlineMd(raw) {
  const codes = [];
  let s = String(raw).replace(/`([^`\n]+)`/g, (_m, c) => { codes.push(escapeHtml(c)); return `\x01C${codes.length - 1}\x01`; });
  s = escapeHtml(s)
    .replace(/!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  return s.replace(/\x01C(\d+)\x01/g, (_m, i) => `<code>${codes[+i]}</code>`);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
function tableAlign(sepCell) {
  const c = sepCell.trim();
  if (c.startsWith(':') && c.endsWith(':')) return 'center';
  if (c.endsWith(':')) return 'right';
  if (c.startsWith(':')) return 'left';
  return '';
}
function renderTable(headerCells, aligns, rows) {
  const cell = (tag, c, idx) => `<${tag}${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineMd(c)}</${tag}>`;
  const thead = `<tr>${headerCells.map((c, i) => cell('th', c, i)).join('')}</tr>`;
  const tbody = rows.map(r => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
  return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

export function mdToHtml(src) {
  const fences = [];
  const withFences = String(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    fences.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\x01F${fences.length - 1}\x01`;
  });

  const lines = withFences.split('\n');
  const out = [];
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`); para = []; } };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

    const fenceMatch = line.match(/^\s*\x01F(\d+)\x01\s*$/);
    if (fenceMatch) { flushPara(); out.push(fences[+fenceMatch[1]]); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); const lvl = h[1].length; out.push(`<h${lvl}>${inlineMd(h[2].trim())}</h${lvl}>`); i++; continue; }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }

    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      const headerCells = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map(tableAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      out.push(renderTable(headerCells, aligns, rows));
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const qlines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qlines.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${qlines.map(inlineMd).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+(.*)$/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m2 = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m2) break;
        items.push(inlineMd(m2[1])); i++;
      }
      out.push(`<ul>${items.map(it => `<li>${it}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+(.*)$/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m2 = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m2) break;
        items.push(inlineMd(m2[1])); i++;
      }
      out.push(`<ol>${items.map(it => `<li>${it}</li>`).join('')}</ol>`);
      continue;
    }

    para.push(line); i++;
  }
  flushPara();
  return out.join('');
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function fmtUSD(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(n < 1 ? 3 : 2);
}
export function snap(v, div) { return Math.max(div || 1, Math.round(v / (div || 1)) * (div || 1)); }
export function downloadDataUrl(dataUrl, filename) {
  const a = el('a', { href: dataUrl, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
}

// ── persisted state ───────────────────────────────────────────────────────────
const STORE_KEY = 'vgpt.state.v1';
export const state = {
  key: '',                 // bring-your-own Venice key
  config: { sharedKey: false, hasKey: false },
  models: [],              // all models
  styles: [],              // image style presets
  tool: 'home',
  _lastTool: 'image',
  mode: { image: 'generate', audio: 'music' },
  selected: {},            // type -> model id
  balance: null,
  handoff: null,           // { image: dataUrl } passed between tools
  freeUses: 0,             // queries spent against the shared key
  ready: false,
};
export function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ key: state.key, tool: state.tool, mode: state.mode, selected: state.selected, freeUses: state.freeUses }));
  } catch {}
}
export function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.key) state.key = p.key;
      if (p.tool) state.tool = p.tool;
      if (p.mode) Object.assign(state.mode, p.mode);
      if (p.selected) state.selected = p.selected;
      if (typeof p.freeUses === 'number') state.freeUses = p.freeUses;
    }
  } catch {}
}

// ── free-trial gate + bring-your-own-key ────────────────────────────────────────
export const FREE_LIMIT = 5;                                  // free queries on the shared key
export const REF_LINK = 'https://venice.ai/chat?ref=yN8qqI';  // get-your-own-key referral
export const gate = { onExceeded: () => {} };                 // hook set by app.js (opens unlock sheet)
export function usingSharedKey() { return !state.key && !!state.config.sharedKey; }
export function freeLeft() { return Math.max(0, FREE_LIMIT - (state.freeUses || 0)); }
export function setKey(k) { state.key = (k || '').trim(); saveState(); }

// Call before any billable query. Returns true if allowed (and meters the shared
// key); otherwise triggers the unlock sheet and returns false.
export function guardQuery() {
  if (state.key) return true;                                  // own key → unlimited (their credits)
  if (!state.config.sharedKey) { gate.onExceeded('nokey'); return false; }
  if ((state.freeUses || 0) >= FREE_LIMIT) { gate.onExceeded('limit'); return false; }
  state.freeUses = (state.freeUses || 0) + 1; saveState();
  const left = freeLeft();
  if (left <= 2) toast(left === 0 ? 'That was your last free query — add a key to keep going' : `${left} free quer${left === 1 ? 'y' : 'ies'} left`, '');
  return true;
}

// ── Venice API client ─────────────────────────────────────────────────────────
function apiHeaders(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (state.key) h['x-venice-key'] = state.key;
  return h;
}
async function jsonOrThrow(r) {
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!r.ok) {
    const msg = errMessage(data) || `Request failed (${r.status})`;
    const e = new Error(msg); e.status = r.status; e.data = data; throw e;
  }
  if (data.balance) state.balance = data.balance;
  return data;
}
export function errMessage(data) {
  if (!data) return '';
  if (typeof data.error === 'string') {
    try { const inner = JSON.parse(data.error); return errMessage(inner) || data.error; } catch { return data.error; }
  }
  return data.error?.message || data.details?.[0]?.message || data.message || data.details || '';
}

export const api = {
  async config() { try { const r = await fetch('/api/config', { headers: apiHeaders(false) }); return await r.json(); } catch { return { sharedKey: false, hasKey: false }; } },
  async models(type = 'all') { const r = await fetch(`/api/models?type=${type}`, { headers: apiHeaders(false) }); return jsonOrThrow(r); },
  async styles() { const r = await fetch('/api/image/styles', { headers: apiHeaders(false) }); return jsonOrThrow(r); },
  async balance() { const r = await fetch('/api/billing/balance', { headers: apiHeaders(false) }); return jsonOrThrow(r); },

  async post(path, body) { const r = await fetch(path, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) }); return jsonOrThrow(r); },

  chat(body, { onDelta, onReasoning, onUsage, signal } = {}) {
    return streamChat(body, { onDelta, onReasoning, onUsage, signal });
  },
  imageGenerate(body) { return this.post('/api/image/generate', body); },
  imageEdit(body) { return this.post('/api/image/edit', body); },
  imageMultiEdit(body) { return this.post('/api/image/multi-edit', body); },
  upscale(body) { return this.post('/api/image/upscale', body); },
  bgRemove(body) { return this.post('/api/image/background-remove', body); },
  videoQuote(body) { return this.post('/api/video/quote', body); },
  videoQueue(body) { return this.post('/api/video/queue', body); },
  videoRetrieve(body) { return this.post('/api/video/retrieve', body); },
  audioQuote(body) { return this.post('/api/audio/quote', body); },
  audioQueue(body) { return this.post('/api/audio/queue', body); },
  audioRetrieve(body) { return this.post('/api/audio/retrieve', body); },
  speech(body) { return this.post('/api/audio/speech', body); },
  transcribe(body) { return this.post('/api/audio/transcriptions', body); },
  fetchMedia(url) { return this.post('/api/fetch-media', { url }); },
};

// Chat always streams — the server defaults to streaming too (stream !== false),
// so this keeps the wire format consistent end to end regardless of caller input.
async function streamChat(body, { onDelta, onReasoning, onUsage, signal }) {
  const r = await fetch('/api/chat', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ ...body, stream: true }), signal });
  if (!r.ok) { const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = { error: t }; } const e = new Error(errMessage(d) || `Chat failed (${r.status})`); e.status = r.status; throw e; }
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream') || !r.body) {
    const d = await r.json();
    const m = d?.choices?.[0]?.message || {};
    if (m.reasoning && onReasoning) onReasoning(m.reasoning);
    if (m.content && onDelta) onDelta(m.content);
    if (d.usage && onUsage) onUsage(d.usage);
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        if (j.usage && onUsage) onUsage(j.usage);
        const d = j?.choices?.[0]?.delta || {};
        if (d.reasoning && onReasoning) onReasoning(d.reasoning);
        if (d.content && onDelta) onDelta(d.content);
      } catch {}
    }
  }
}

// ── model helpers (capability-driven) ──────────────────────────────────────────
export function modelsByType(type) {
  return state.models.filter(m => m.type === type);
}
export function findModel(id) { return state.models.find(m => m.id === id); }
export function modelLabel(m) { return m?.model_spec?.name || m?.id || '—'; }
export function modelName(id) { return modelLabel(findModel(id)); }

// pick a sensible default: prefer trait "default", else first
export function defaultModelFor(type) {
  const list = modelsByType(type);
  if (!list.length) return '';
  const def = list.find(m => (m.model_spec?.traits || []).some(t => /default/i.test(t)));
  return (def || list[0]).id;
}
export function selectedFor(type) {
  if (state.selected[type] && findModel(state.selected[type])?.type === type) return state.selected[type];
  const d = defaultModelFor(type);
  if (d) { state.selected[type] = d; saveState(); }
  return d;
}

const num = (v) => (typeof v === 'number' && !isNaN(v) ? v : undefined);
const arr = (v) => (Array.isArray(v) && v.length ? v : undefined);

// Image generation model options
export function imageOpts(m) {
  const c = m?.model_spec?.constraints || {};
  const steps = c.steps && typeof c.steps === 'object' ? c.steps : (num(c.steps) ? { default: c.steps, max: c.steps } : undefined);
  return {
    aspectRatios: arr(c.aspectRatios),
    defaultAspectRatio: c.defaultAspectRatio,
    resolutions: arr(c.resolutions),
    defaultResolution: c.defaultResolution,
    qualities: arr(c.qualities),
    defaultQuality: c.defaultQuality,
    steps,
    widthHeightDivisor: num(c.widthHeightDivisor) || 8,
    promptLimit: num(c.promptCharacterLimit),
    isDiffusion: !!steps, // diffusion-style models expose a steps constraint → support cfg/negative
  };
}
// Edit / inpaint model options
export function editOpts(m) {
  const c = m?.model_spec?.constraints || {};
  return {
    aspectRatios: arr(c.aspectRatios),
    resolutions: arr(c.resolutions),
    defaultResolution: c.defaultResolution,
    qualities: arr(c.qualities),
    defaultQuality: c.defaultQuality,
    combineImages: c.combineImages !== false,
    singleImageAspectRatio: c.singleImageAspectRatio !== false,
    promptLimit: num(c.promptCharacterLimit),
  };
}
// Video model options
export function videoOpts(m) {
  const c = m?.model_spec?.constraints || {};
  const t = c.model_type || 'text-to-video';
  return {
    durations: arr(c.durations) || ['5s'],
    aspectRatios: arr(c.aspect_ratios),
    resolutions: arr(c.resolutions),
    audio: !!c.audio,
    audioConfigurable: !!c.audio_configurable,
    modelType: t,
    needsImage: t === 'image-to-video',
    allowsImage: t === 'image-to-video' || t === 'video',
    promptLimit: num(c.prompt_character_limit) || 2500,
  };
}
// Music model options (top-level model_spec fields)
export function musicOpts(m) {
  const s = m?.model_spec || {};
  return {
    supportsLyrics: !!s.supports_lyrics,
    lyricsRequired: !!s.lyrics_required,
    supportsForceInstrumental: !!s.supports_force_instrumental,
    supportsLyricsOptimizer: !!(s.supports_lyrics_optimizer ?? s.supportsLyricsOptimizer),
    voices: arr(s.voices),
    defaultVoice: s.default_voice,
    supportsLanguageCode: !!s.supports_language_code,
    supportsSpeed: !!s.supports_speed,
    minSpeed: num(s.min_speed) ?? 0.25,
    maxSpeed: num(s.max_speed) ?? 4,
    defaultSpeed: num(s.default_speed) ?? 1,
    durationOptions: arr(s.duration_options),
    minDuration: num(s.min_duration),
    maxDuration: num(s.max_duration),
    defaultDuration: num(s.default_duration),
    supportedFormats: arr(s.supported_formats),
    promptLimit: num(s.prompt_character_limit),
    minPromptLength: num(s.min_prompt_length) ?? 1,
    lyricsLimit: num(s.lyrics_character_limit),
  };
}
// TTS model options
export function ttsOpts(m) {
  const s = m?.model_spec || {};
  const cap = s.capabilities || {};
  const flag = (k) => !!(cap[k] ?? s[k]);
  return {
    voices: arr(s.voices) || ['af_sky'],
    supportsPrompt: flag('supportsPromptParam'),
    supportsTemperature: flag('supportsTemperatureParam'),
    supportsTopP: flag('supportsTopPParam'),
    voiceCloning: s.voice_cloning,
  };
}
export function textCaps(m) {
  const cap = m?.model_spec?.capabilities || {};
  return {
    vision: !!cap.supportsVision,
    multiImage: !!cap.supportsMultipleImages,
    maxImages: num(cap.maxImages) || 1,
    webSearch: !!cap.supportsWebSearch,
    reasoning: !!cap.supportsReasoning,
    reasoningEffort: !!cap.supportsReasoningEffort,
    effortOptions: arr(cap.reasoningEffortOptions),
    defaultEffort: cap.defaultReasoningEffort,
  };
}

// width/height presets for image models that don't use aspect_ratio
const RATIO_WH = { '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280], '3:2': [1248, 832], '2:3': [832, 1248], '4:5': [1024, 1280] };
export function ratioToWH(ratio, divisor = 8) {
  const [w, h] = RATIO_WH[ratio] || [1024, 1024];
  return [Math.min(1280, snap(w, divisor)), Math.min(1280, snap(h, divisor))];
}
export const WH_RATIOS = Object.keys(RATIO_WH);

// price hint for a model (best-effort, returns USD number or undefined)
export function priceHint(m) {
  const p = m?.model_spec?.pricing;
  if (!p) return undefined;
  if (p.generation?.usd != null) return p.generation.usd;
  if (p.resolutions) { const v = Object.values(p.resolutions)[0]; if (v?.usd != null) return v.usd; }
  if (p.inpaint?.usd != null) return p.inpaint.usd;
  if (p.per_second?.usd != null) return p.per_second.usd;
  return undefined;
}

// ── asset library (IndexedDB, best-effort) ──────────────────────────────────────
let _db = null;
let _assets = [];
const _assetSubs = new Set();
function openDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('vgpt', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('assets', { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
export async function initAssets() {
  _db = await openDB();
  if (!_db) return;
  try {
    await new Promise((res) => {
      const tx = _db.transaction('assets', 'readonly');
      const rq = tx.objectStore('assets').getAll();
      rq.onsuccess = () => { _assets = (rq.result || []).sort((a, b) => b.createdAt - a.createdAt); res(); };
      rq.onerror = () => res();
    });
  } catch {}
  emitAssets();
}
function emitAssets() { _assetSubs.forEach(fn => { try { fn(_assets); } catch {} }); }
export function onAssets(fn) { _assetSubs.add(fn); return () => _assetSubs.delete(fn); }
export function listAssets(kind) { return kind ? _assets.filter(a => a.kind === kind) : _assets; }
export function addAsset(a) {
  const asset = { id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...a };
  _assets.unshift(asset);
  if (_db) try { const tx = _db.transaction('assets', 'readwrite'); tx.objectStore('assets').put(asset); } catch {}
  emitAssets();
  return asset;
}
export function removeAsset(id) {
  _assets = _assets.filter(a => a.id !== id);
  if (_db) try { const tx = _db.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(id); } catch {}
  emitAssets();
}
export function clearAssets() {
  _assets = [];
  if (_db) try { const tx = _db.transaction('assets', 'readwrite'); tx.objectStore('assets').clear(); } catch {}
  emitAssets();
}

// ── bottom sheet ────────────────────────────────────────────────────────────
export function openSheet(title, bodyNode) {
  $('#sheetTitle').textContent = title;
  const body = clear($('#sheetBody'));
  body.appendChild(bodyNode);
  $('#scrim').classList.add('open');
}
export function closeSheet() { $('#scrim').classList.remove('open'); }

// ── image source picker (upload / camera / library) ─────────────────────────────
export function pickImage({ title = 'Choose image' } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { closeSheet(); resolve(v); };
    const fileInput = $('#fileImage');
    const camInput = $('#fileImageCam');
    const wire = (inp) => {
      inp.value = '';
      inp.onchange = async () => {
        const f = inp.files?.[0]; if (!f) return;
        try { done(await fileToDataURL(f)); } catch { toast('Could not read file', 'err'); done(null); }
      };
      inp.click();
    };
    const imgs = listAssets('image');
    const body = el('div', {}, [
      el('div', { class: 'src-actions', style: { display: 'flex', gap: '8px', marginBottom: '14px' } }, [
        el('button', { class: 'btn primary', style: { flex: '1' }, html: `${icon('upload', 18)} Upload`, onclick: () => wire(fileInput) }),
        el('button', { class: 'btn', style: { flex: '1' }, html: `${icon('camera', 18)} Camera`, onclick: () => wire(camInput) }),
      ]),
      imgs.length ? el('div', { class: 'panel-title', text: 'From your library' }) : el('div', { class: 'notice', text: 'No images in your library yet. Generate or upload one to reuse it across tools.' }),
      imgs.length ? el('div', { class: 'gallery' }, imgs.slice(0, 24).map(a =>
        el('button', { class: 'g-item', onclick: () => done(a.dataUrl) }, el('img', { src: a.dataUrl, loading: 'lazy' }))
      )) : null,
    ]);
    openSheet(title, body);
  });
}

// navigation hook set by app.js
export const nav = { goTo: () => {} };

// poll an async (video/music) job until complete; returns a data URL
export async function pollJob(kind, { model, queueId, downloadUrl }, onTick) {
  const retrieve = kind === 'video' ? api.videoRetrieve.bind(api) : api.audioRetrieve.bind(api);
  const started = Date.now();
  const MAX = 8 * 60 * 1000;
  let delay = 3500;
  while (Date.now() - started < MAX) {
    const res = await retrieve({ model, queue_id: queueId });
    if (res && res.data) return res.data; // completed binary -> data URL
    if (res && res.status === 'COMPLETED') {
      if (downloadUrl) { const m = await api.fetchMedia(downloadUrl); return m.data; }
      // completed but no media payload — give it one more cycle
    }
    if (res && res.status && res.status !== 'COMPLETED' && onTick) {
      const avg = res.average_execution_time || 0;
      const cur = res.execution_duration || (Date.now() - started);
      onTick(avg ? Math.min(0.97, cur / avg) : null, res.status);
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay + 800, 8000);
  }
  throw new Error('Generation timed out. Try a shorter duration or lower resolution.');
}
