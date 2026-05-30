// ═══════════════════════════════════════════════════════════════════════════
// vGPT tools — DIAL edition. One capability-driven view per feature, now
// presented as a hardware instrument: knobs (sliders), switches (toggles),
// segments (enums), an LCD readout, tape slots (file inputs), transport keys
// (chat) and a jog dial (library). The capability gating and request-payload
// building are UNCHANGED from the original — only the controls' presentation
// differs. Every parameter that rendered before still renders, gated by the
// same model-capability checks; knobs write the same field a slider did.
// ═══════════════════════════════════════════════════════════════════════════
import {
  el, icon, toast, clear, mdToHtml, escapeHtml, fileToDataURL, fmtUSD, downloadDataUrl,
  state, api, nav, guardQuery,
  modelsByType, findModel, modelName, selectedFor,
  imageOpts, editOpts, videoOpts, musicOpts, ttsOpts, textCaps,
  ratioToWH, WH_RATIOS, priceHint,
  addAsset, listAssets, removeAsset, pickImage, pollJob,
} from './core.js';

// per-view form state (kept across re-renders within a session)
const F = {
  chat: { atts: [], webSearch: 'auto', effort: '', draft: '' },
  imgGen: { prompt: '', negative: '', ratio: '16:9', resolution: '', quality: '', steps: null, cfg: 5, style: '', variants: 1, seed: '', format: 'webp', hideWm: false },
  edit: { prompt: '', images: [], ratio: 'auto', resolution: '', quality: '', format: '' },
  enhance: { image: null, scale: 2, enhance: true, creativity: 0.5, replication: 0.35, prompt: '' },
  bg: { image: null },
  video: { prompt: '', negative: '', duration: '', ratio: '', resolution: '', audio: true, image: null, endImage: null, quote: null },
  music: { prompt: '', lyrics: '', optimizer: false, instrumental: false, voice: '', lang: '', duration: null, speed: null, quote: null },
  speech: { text: '', voice: '', format: 'mp3', speed: 1, lang: '', style: '', temperature: 0.7, topP: 1 },
  transcribe: { audio: null, filename: '', text: '', language: '' },
};
const recent = { image: [], video: [], audio: [] }; // inline results per view
const busy = {};                                      // view -> bool|number(progress)
const jobState = {};                                  // async job lifecycle for progress UI
let chat = { messages: [], streaming: false, abort: null };
let libSel = 0;                                        // library jog selection

// ── DIAL widgets ──────────────────────────────────────────────────────────────

// Rotary knob bound to a numeric field. Drag (up = increase) or scroll-wheel to
// change; optional onClick fires on a tap without drag (used for SEED randomize).
function knob({ label, value, min, max, step = 1, fmt, display, onInput, onClick }) {
  const SWEEP = 135;                 // degrees each way (270° total)
  const range = (max - min) || 1;
  const clampSnap = (v) => {
    v = Math.min(max, Math.max(min, v));
    if (step) v = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, +(+v).toFixed(6)));
  };
  let cur = clampSnap(value ?? min);
  const ind = el('div', { class: 'ind' });
  const cap = el('div', { class: 'knob' }, ind);
  const valEl = el('div', { class: 'kv' });
  const paint = () => {
    const frac = (cur - min) / range;
    ind.style.transform = `translateX(-50%) rotate(${-SWEEP + frac * 2 * SWEEP}deg)`;
    valEl.textContent = display ? display(cur) : (fmt ? fmt(cur) : String(cur));
  };
  paint();
  let startY = 0, startVal = 0, moved = false, active = false;
  const move = (e) => {
    if (!active) return;
    const y = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;
    const dy = startY - y;
    if (Math.abs(dy) > 3) moved = true;
    cur = clampSnap(startVal + (dy / 150) * range);
    paint(); onInput && onInput(cur);
  };
  const up = () => {
    if (!active) return; active = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved && onClick) { onClick(); paint(); }
  };
  cap.addEventListener('pointerdown', (e) => {
    e.preventDefault(); active = true; moved = false; startY = e.clientY; startVal = cur;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  cap.addEventListener('wheel', (e) => { e.preventDefault(); cur = clampSnap(cur + (e.deltaY < 0 ? step : -step)); paint(); onInput && onInput(cur); }, { passive: false });
  return el('div', { class: 'kw' }, [cap, el('div', { class: 'kl', text: label }), valEl]);
}

// Knob that steps through a list of discrete options (e.g. durations).
function enumKnob(label, options, value, onPick, fmt) {
  const opts = options.map(String);
  let idx = Math.max(0, opts.indexOf(String(value)));
  return knob({
    label, value: idx, min: 0, max: Math.max(0, opts.length - 1), step: 1,
    display: () => { const o = options[idx]; return fmt ? fmt(o) : String(o); },
    onInput: (v) => { idx = Math.round(v); onPick(options[idx]); },
  });
}

function dialSwitch(label, value, onToggle) {
  const sw = el('div', { class: 'sw' + (value ? ' on' : '') }, [
    el('span', { class: 'sl', text: label }),
    el('span', { class: 'tg' }, el('i')),
  ]);
  sw.addEventListener('click', () => { const nv = !sw.classList.contains('on'); sw.classList.toggle('on', nv); onToggle(nv); });
  return sw;
}

function segment(label, options, value, onPick, fmt) {
  return el('div', { class: 'seg-field' }, [
    label ? el('div', { class: 'seg-label', text: label }) : null,
    el('div', { class: 'segrow' }, options.map(o =>
      el('button', { class: 'segbtn' + (String(o) === String(value) ? ' on' : ''), text: fmt ? fmt(o) : String(o), onclick: () => onPick(o) }))),
  ]);
}

function cartBtn(kicker, value, onClick, glyph = 'cpu') {
  return el('button', { class: 'cart-btn', onclick: onClick }, [
    el('span', { class: 'ci', html: icon(glyph, 16) }),
    el('div', { class: 'cc' }, [el('div', { class: 'ck', text: kicker }), el('div', { class: 'cv', text: value })]),
    el('span', { class: 'cx', html: icon('chevronDown', 16) }),
  ]);
}

// editable LCD text line (prompt / negative / lyrics / text)
function lcdText(label, value, placeholder, oninput, { dim, max, rows } = {}) {
  const ta = el('textarea', { placeholder, rows: rows || 2 });
  if (max) ta.setAttribute('maxlength', max);
  ta.value = value || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', (e) => { grow(); oninput(e.target.value); });
  requestAnimationFrame(grow);
  return el('div', { class: 'lcd-field' + (dim ? ' dim' : '') }, [
    label ? el('span', { class: 'lf-label', text: label }) : null, ta,
  ]);
}

// REC / generate cluster
function recButton({ label, sub, glyph = 'zap', onClick, disabled, pulsing }) {
  return el('div', { class: 'gen' }, [
    el('button', { class: 'recbtn' + (pulsing ? ' pulsing' : ''), disabled, html: icon(glyph, 24), onclick: onClick }),
    el('div', { class: 'gt' }, [el('b', { text: label }), sub ? el('span', { class: 'gc', html: sub }) : null]),
  ]);
}

// tape slot — single image input styled as an LCD-glass dashed well
function tapeSlot(current, onPick, onClear, label = 'tape slot') {
  if (current) {
    return el('div', { class: 'tape-thumb' }, [el('img', { src: current }), el('button', { class: 'thumb-x', html: icon('x', 16), onclick: onClear })]);
  }
  return el('button', { class: 'tape-slot', onclick: async () => { const d = await pickImage({ title: 'Insert tape' }); if (d) onPick(d); } }, [
    el('span', { class: 'ts-ic', html: icon('image', 28) }),
    el('span', { text: label.toUpperCase() }),
    el('span', { class: 'ts-sub', text: 'tap to load · upload / camera / library' }),
  ]);
}

// a choice picked from a (possibly large) list, surfaced as a cartridge sheet
function openChoiceSheet(title, options, current, onPick, fmt) {
  const body = el('div', {});
  const listEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const draw = (q = '') => {
    clear(listEl);
    const ql = q.toLowerCase();
    options.filter(o => !ql || String(fmt ? fmt(o) : o).toLowerCase().includes(ql)).forEach(o => {
      const sel = String(o) === String(current);
      listEl.appendChild(el('button', { class: 'model-item' + (sel ? ' sel' : ''), onclick: () => { onPick(o); nav.closeSheet(); nav.refresh(); } }, [
        el('div', { class: 'mi-body' }, el('div', { class: 'mi-name', text: fmt ? fmt(o) : String(o) })),
        sel ? el('span', { style: { color: 'var(--accent)' }, html: icon('check', 16) }) : null,
      ]));
    });
    if (!listEl.children.length) listEl.appendChild(el('div', { class: 'notice', text: 'No matches.' }));
  };
  if (options.length > 8) { const s = el('input', { type: 'search', class: 'search-input', placeholder: `Search ${options.length}…` }); s.addEventListener('input', e => draw(e.target.value)); body.appendChild(s); }
  draw('');
  body.appendChild(listEl);
  nav.openSheet(title, body);
}

// ── shared helpers (unchanged behaviour) ───────────────────────────────────────
function copyText(text) {
  if (!text) return;
  const write = navigator.clipboard?.writeText(text);
  if (!write) { toast('Clipboard is not available', 'err'); return; }
  write.then(() => toast('Copied', 'ok')).catch(() => toast('Could not copy', 'err'));
}
function downloadText(text, filename = 'vgpt-response.txt') {
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// result card with chaining actions (preserved — library + inline results)
function resultCard(asset) {
  let media;
  if (asset.kind === 'image') media = el('img', { class: 'result-media img', src: asset.dataUrl });
  else if (asset.kind === 'video') media = el('video', { class: 'result-media', src: asset.dataUrl, controls: 'true', playsinline: 'true' });
  else media = el('div', { class: 'aplayer' }, [el('div', { class: 'a-ico', html: icon('music', 26) }), el('audio', { src: asset.dataUrl, controls: 'true' })]);

  const acts = el('div', { class: 'result-actions' });
  const dlName = `vgpt-${asset.id}.${asset.ext || (asset.kind === 'image' ? 'png' : asset.kind === 'video' ? 'mp4' : 'mp3')}`;
  acts.appendChild(el('button', { class: 'act', html: `${icon('download', 14)} Download`, onclick: () => downloadDataUrl(asset.dataUrl, dlName) }));
  if (asset.kind === 'image') {
    acts.appendChild(el('button', { class: 'act accent', html: `${icon('wand', 14)} Edit`, onclick: () => nav.goTo('image', { mode: 'edit', handoff: { image: asset.dataUrl } }) }));
    acts.appendChild(el('button', { class: 'act', html: `${icon('upscale', 14)} Enhance`, onclick: () => nav.goTo('image', { mode: 'enhance', handoff: { image: asset.dataUrl } }) }));
    acts.appendChild(el('button', { class: 'act', html: `${icon('video', 14)} Animate`, onclick: () => nav.goTo('video', { handoff: { image: asset.dataUrl } }) }));
    acts.appendChild(el('button', { class: 'act', html: `${icon('chat', 14)} Ask`, onclick: () => nav.goTo('chat', { handoff: { image: asset.dataUrl } }) }));
  }
  acts.appendChild(el('button', { class: 'act', html: `${icon('share', 14)} Share`, onclick: () => shareAsset(asset, dlName) }));

  return el('div', { class: 'result-card' }, [
    media,
    el('div', { class: 'result-meta' }, [
      asset.prompt ? el('div', { class: 'result-prompt', text: asset.prompt }) : null,
      el('div', { style: { fontSize: '11px', color: 'var(--ink-2)', marginTop: '6px', fontFamily: 'var(--mono)' }, text: [asset.modelName || asset.model, asset.bytes ? (asset.bytes / 1024 | 0) + ' KB' : ''].filter(Boolean).join(' · ') }),
      acts,
    ]),
  ]);
}
async function shareAsset(asset, name) {
  try {
    if (navigator.share && navigator.canShare) {
      const blob = await (await fetch(asset.dataUrl)).blob();
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: asset.prompt || 'vGPT' }); return; }
    }
  } catch {}
  downloadDataUrl(asset.dataUrl, name);
}

function emptyState(glyph, title, desc, extra) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'orb', html: icon(glyph, 38) }),
    el('h2', { text: title }),
    el('p', { text: desc }),
    extra || null,
  ]);
}

// inline result/loading area below a bank (progress preserved)
function resultsBlock(view) {
  const out = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  if (busy[view]) {
    const prog = busy[view] === true ? null : busy[view];
    if (view === 'video') out.appendChild(videoProgressCard(prog));
    else out.appendChild(loadingCard(
      view === 'audio' ? 'Composing audio…' : 'Generating…',
      view === 'audio' ? 'This can take 1–3 minutes. Keep this screen open.' : 'Usually a few seconds.',
      typeof prog === 'number' ? prog : (view === 'audio' ? 0.06 : null),
    ));
  }
  recent[view].forEach(a => out.appendChild(resultCard(a)));
  return out;
}
function videoProgressCard(progress) {
  const js = jobState.video || { stage: 'preparing' };
  const stages = [['preparing', 'Preparing request'], ['queued', 'Queued with Venice'], ['rendering', 'Rendering frames'], ['finalizing', 'Finalizing media']];
  const active = Math.max(0, stages.findIndex(([key]) => key === js.stage));
  return el('div', { class: 'card job-card' }, [
    el('div', { class: 'job-head' }, [el('div', { class: 'spinner sm' }), el('div', {}, [
      el('div', { class: 'lp', text: js.stage === 'queued' ? 'Your video is queued' : js.stage === 'finalizing' ? 'Finalizing your video…' : 'Rendering your video…' }),
      el('div', { class: 'ls', text: js.status ? String(js.status).replace(/_/g, ' ').toLowerCase() : 'Keep this screen open while Venice creates your clip.' }),
    ])]),
    el('div', { class: 'job-steps' }, stages.map(([key, label], i) => el('div', { class: `job-step ${i < active ? 'done' : i === active ? 'active' : ''}` }, [
      el('span', { class: 'job-dot', html: i < active ? icon('check', 11) : '' }), el('span', { text: label }),
    ]))),
    el('div', { class: 'job-progress' }, [
      el('div', { class: 'progress' }, el('i', { style: { width: Math.round((typeof progress === 'number' ? progress : 0.06) * 100) + '%' } })),
      el('span', { text: Math.round((typeof progress === 'number' ? progress : 0.06) * 100) + '%' }),
    ]),
  ]);
}
function loadingCard(primary, sub, progress) {
  return el('div', { class: 'card loading-card' }, [
    el('div', { class: 'spinner' }),
    el('div', { class: 'lp', text: primary }),
    sub ? el('div', { class: 'ls', text: sub }) : null,
    progress != null ? el('div', { class: 'job-progress' }, [el('div', { class: 'progress' }, el('i', { style: { width: Math.round(progress * 100) + '%' } })), el('span', { text: Math.round(progress * 100) + '%' })]) : null,
  ]);
}

// scroll body scaffold (plate is the global header)
function toolScroll() {
  const scroll = el('div', { class: 'scroll' });
  const pad = el('div', { class: 'pad pad-b' });
  scroll.appendChild(pad);
  return { scroll, pad };
}

// consume cross-tool handoff (preload an image into the destination tool)
function takeHandoff() { const h = state.handoff; state.handoff = null; return h; }

// run wrapper: gate → busy → call → result, with consistent error handling
async function runJob(view, fn) {
  if (busy[view]) return;
  if (!guardQuery()) return;
  busy[view] = true; nav.refresh();
  try { await fn(); }
  catch (e) { toast(e.message || 'Something went wrong', 'err'); }
  finally { busy[view] = false; if (view === 'video') delete jobState.video; nav.refresh(); }
}

// ════════════════════════════ CHAT ════════════════════════════
function viewChat() {
  const frag = document.createDocumentFragment();
  const id = selectedFor('text');
  const m = findModel(id);
  const caps = textCaps(m);

  const h = takeHandoff(); if (h?.image && caps.vision) F.chat.atts.push(h.image);

  const lcd = el('div', { class: 'lcd tall' });
  const webOn = caps.webSearch && F.chat.webSearch !== 'off';
  lcd.appendChild(el('div', { class: 'ltop' }, [
    el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('text'), html: `${icon('cpu', 11)}<span>CHAT · ${escapeHtml((modelName(id) || 'no model').toUpperCase())}</span>` }),
    el('span', { text: `${webOn ? 'WEB ● ' : ''}${F.chat.effort ? 'THINK ' + F.chat.effort.toUpperCase() : ''}`.trim() || 'READY' }),
  ]));

  const out = el('div', { class: 'lcd-scroll' });
  if (!chat.messages.length) {
    out.appendChild(el('div', { class: 'ca', html: `◆ ${escapeHtml(caps.vision ? 'turn the dial, type below, or hold MIC. attach an image to ask about it.' : 'turn the dial and type below — i can reason and search the web.')}` }));
    const sugg = ['Explain quantum computing simply', 'Write a launch tweet for my app', 'Plan a 3-day trip to Tokyo', 'Brainstorm 10 climate-tech ideas'];
    out.appendChild(el('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      sugg.map(s => el('button', { class: 'lrow', onclick: () => { F.chat.draft = s; nav.refresh(); setTimeout(() => document.getElementById('chatInput')?.focus(), 0); } }, [el('span', { class: 'lt', text: '»' }), el('span', { class: 'ln', text: s })]))));
  } else {
    chat.messages.forEach(msg => out.appendChild(renderMsg(msg)));
  }
  lcd.appendChild(out);

  if (F.chat.atts.length) lcd.appendChild(el('div', { class: 'input-hint', text: `▌ ${F.chat.atts.length} image${F.chat.atts.length > 1 ? 's' : ''} attached` }));

  // pinned editable input line
  const input = el('textarea', { id: 'chatInput', rows: '1', placeholder: '▌ type or hold MIC…', style: { width: '100%', background: 'transparent', border: 0, resize: 'none', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--amb)', caretColor: 'var(--accent)', boxShadow: 'none', padding: 0, marginTop: '8px', borderTop: '1px dashed rgba(134,229,140,.18)', paddingTop: '8px' } });
  input.value = F.chat.draft || '';
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  input.addEventListener('input', () => { F.chat.draft = input.value; grow(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });
  requestAnimationFrame(grow);
  lcd.appendChild(input);
  frag.appendChild(lcd);

  function send() {
    const text = (F.chat.draft || '').trim();
    if ((!text && !F.chat.atts.length) || chat.streaming) return;
    const content = F.chat.atts.length
      ? [...(text ? [{ type: 'text', text }] : []), ...F.chat.atts.map(u => ({ type: 'image_url', image_url: { url: u } }))]
      : text;
    chat.messages.push({ role: 'user', content, atts: [...F.chat.atts], display: text });
    F.chat.atts = []; F.chat.draft = '';
    runChat();
  }

  // transport keys
  const keys = [];
  if (caps.webSearch) keys.push(el('button', { class: 'key' + (webOn ? ' lit' : ''), html: `${icon('globe', 18)}<div class="kt">WEB</div>`, onclick: () => { F.chat.webSearch = F.chat.webSearch === 'off' ? 'auto' : F.chat.webSearch === 'auto' ? 'on' : 'off'; toast(`Web search: ${F.chat.webSearch}`); nav.refresh(); } }));
  if (caps.reasoningEffort) {
    const opts = ['', ...(caps.effortOptions || ['low', 'medium', 'high'])];
    keys.push(el('button', { class: 'key' + (F.chat.effort ? ' lit' : ''), html: `${icon('brain', 18)}<div class="kt">THINK</div>`, onclick: () => { const i = opts.indexOf(F.chat.effort); F.chat.effort = opts[(i + 1) % opts.length]; toast(`Reasoning: ${F.chat.effort || 'auto'}`); nav.refresh(); } }));
  }
  if (caps.vision) keys.push(el('button', { class: 'key', html: `${icon('paperclip', 18)}<div class="kt">ATTACH</div>`, onclick: async () => { const d = await pickImage({ title: 'Attach image' }); if (d) { F.chat.atts.push(d); nav.refresh(); } } }));
  keys.push(el('button', { class: 'key', html: `${icon('mic', 18)}<div class="kt">MIC</div>`, onclick: micDictate }));
  keys.push(el('button', { class: 'key big', html: `${icon(chat.streaming ? 'x' : 'send', 18)}<div class="kt">${chat.streaming ? 'STOP' : 'SEND'}</div>`, onclick: () => chat.streaming ? stopChat() : send() }));

  frag.appendChild(el('div', { class: 'keys' }, el('div', { class: 'keyrow' }, keys)));
  return frag;
}

function micDictate() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input is not supported on this device', 'err'); return; }
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = false;
  toast('Listening…');
  rec.onresult = (e) => { const t = e.results[0][0].transcript; F.chat.draft = ((F.chat.draft || '') + ' ' + t).trim(); nav.refresh(); setTimeout(() => document.getElementById('chatInput')?.focus(), 0); };
  rec.onerror = () => toast('Could not capture audio', 'err');
  try { rec.start(); } catch { toast('Mic is busy', 'err'); }
}

function renderMsg(msg) {
  const isUser = msg.role === 'user';
  if (isUser) {
    const wrap = el('div', {});
    if (msg.atts?.length) wrap.appendChild(el('div', { class: 'cu', text: `> [${msg.atts.length} image${msg.atts.length > 1 ? 's' : ''}]` }));
    const txt = msg.display ?? (typeof msg.content === 'string' ? msg.content : '');
    if (txt) wrap.appendChild(el('div', { class: 'cu', html: `&gt; ${escapeHtml(txt)}` }));
    return wrap;
  }
  const wrap = el('div', {});
  if (msg.streaming && !msg.content) wrap.appendChild(el('div', { class: 'ca', html: '◆ <span style="opacity:.6">▌</span>' }));
  else wrap.appendChild(el('div', { class: 'ca', html: `◆ ${mdToHtml(msg.content || '')}` }));
  if (msg.reasoning) wrap.appendChild(el('details', { class: 'reasoning' }, [el('summary', { text: '› reasoning' }), el('div', { class: 'r-body', text: msg.reasoning })]));
  if (!msg.streaming && msg.content) {
    wrap.appendChild(el('div', { class: 'msg-actions' }, [
      el('button', { class: 'act', html: `${icon('copy', 13)} Copy`, onclick: () => copyText(msg.content) }),
      el('button', { class: 'act', html: `${icon('download', 13)} Save`, onclick: () => downloadText(msg.content) }),
    ]));
  }
  if (msg.metrics) {
    const mt = msg.metrics;
    wrap.appendChild(el('div', { class: 'metrics' }, [
      mt.tps ? el('span', { class: 'm', text: `${mt.tps} tok/s` }) : null,
      mt.total ? el('span', { class: 'm', text: `${mt.total} tokens` }) : null,
      mt.cost ? el('span', { class: 'm', text: fmtUSD(mt.cost) }) : null,
    ].filter(Boolean)));
  }
  return wrap;
}

async function runChat() {
  if (!guardQuery()) { chat.messages.pop(); nav.refresh(); return; }
  const id = selectedFor('text');
  const m = findModel(id);
  const caps = textCaps(m);
  const assistant = { role: 'assistant', content: '', reasoning: '', streaming: true, metrics: null };
  chat.messages.push(assistant);
  chat.streaming = true; nav.refresh();

  const vp = { include_venice_system_prompt: true };
  if (caps.webSearch && F.chat.webSearch !== 'off') { vp.enable_web_search = F.chat.webSearch; vp.enable_web_citations = true; }
  const body = {
    model: id,
    messages: chat.messages.filter(x => x !== assistant).map(x => ({ role: x.role, content: x.content })),
    venice_parameters: vp,
  };
  const maxC = m?.model_spec?.maxCompletionTokens;
  if (maxC) body.max_completion_tokens = maxC;
  if (caps.reasoningEffort && F.chat.effort) body.reasoning_effort = F.chat.effort;

  const start = Date.now(); let chars = 0; let usage = null;
  chat.abort = new AbortController();
  try {
    await api.chat(body, {
      signal: chat.abort.signal,
      onDelta: (d) => { assistant.content += d; chars += d.length; throttleUpdate(assistant, start, chars); },
      onReasoning: (r) => { assistant.reasoning = (assistant.reasoning || '') + r; },
      onUsage: (u) => { usage = u; },
    });
    const think = /<think>([\s\S]*?)<\/think>/gi; let mtc;
    while ((mtc = think.exec(assistant.content))) assistant.reasoning = (assistant.reasoning || '') + mtc[1].trim() + '\n';
    assistant.content = assistant.content.replace(think, '').trim();
    const secs = (Date.now() - start) / 1000;
    const total = usage?.total_tokens || Math.ceil(chars / 4);
    let cost;
    const pr = m?.model_spec?.pricing;
    if (pr?.input?.usd && usage?.prompt_tokens) cost = (pr.input.usd * usage.prompt_tokens + (pr.output?.usd || 0) * (usage.completion_tokens || 0)) / 1e6;
    assistant.metrics = { tps: secs > 0 ? Math.round(total / secs * 10) / 10 : 0, total, cost };
  } catch (e) {
    if (e.name === 'AbortError') assistant.content += assistant.content ? '' : '_(stopped)_';
    else assistant.content = `⚠️ ${e.message}`;
  } finally {
    assistant.streaming = false; chat.streaming = false; chat.abort = null; nav.refresh();
  }
}
let _t = 0;
function throttleUpdate(assistant, start, chars) {
  const now = Date.now();
  if (now - _t < 60) return; _t = now;
  const secs = (now - start) / 1000;
  assistant.metrics = { tps: secs > 0 ? Math.round(chars / 4 / secs * 10) / 10 : 0, total: Math.ceil(chars / 4) };
  nav.refresh();
}
function stopChat() { try { chat.abort?.abort(); } catch {} }
export function newChat() { stopChat(); chat = { messages: [], streaming: false, abort: null }; }

// ════════════════════════════ IMAGE (generate/edit/enhance/bg) ════════════════════════════
const IMAGE_MODES = [
  { k: 'generate', label: 'Generate', icon: 'image' },
  { k: 'edit', label: 'Edit', icon: 'wand' },
  { k: 'enhance', label: 'Enhance', icon: 'upscale' },
  { k: 'bg', label: 'Cutout', icon: 'scissors' },
];
function viewImage() {
  const mode = state.mode.image || 'generate';
  const frag = document.createDocumentFragment();
  frag.appendChild(el('div', { class: 'segmented' }, IMAGE_MODES.map(mm =>
    el('button', { class: 'seg' + (mode === mm.k ? ' active' : ''), html: `${icon(mm.icon, 14)} ${mm.label}`, onclick: () => { state.mode.image = mm.k; nav.refresh(); } })
  )));
  const { scroll, pad } = toolScroll();
  frag.appendChild(scroll);

  if (mode === 'generate') buildGenerate(pad);
  else if (mode === 'edit') buildEdit(pad);
  else if (mode === 'enhance') buildEnhance(pad);
  else buildBg(pad);
  return frag;
}

function buildGenerate(pad) {
  const id = selectedFor('image');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('image', 'No image models', 'Add a Venice API key to load image models.')); return; }
  const o = imageOpts(m);
  const f = F.imgGen;

  const ratios = o.aspectRatios || WH_RATIOS;
  const ratioVal = o.aspectRatios ? (ratios.includes(f.ratio) ? f.ratio : (o.defaultAspectRatio || ratios[0])) : (WH_RATIOS.includes(f.ratio) ? f.ratio : '1:1');
  const summaryText = () => `${ratioVal}${o.resolutions ? ' · ' + (o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0])) : ''} · ${f.format} · ${f.variants > 1 ? f.variants + ' variants' : '1 image'}`;

  // ── LCD: model · armed · prompt · summary ──
  const sub = el('div', { class: 'sub', text: summaryText() });
  const lcd = el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [
      el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('image'), html: `${icon('cpu', 11)}<span>IMG · ${escapeHtml(modelName(id).toUpperCase())}</span>` }),
      el('span', { class: 'armed', text: busy.image ? '● WORKING' : '● ARMED' }),
    ]),
    lcdText(null, f.prompt, '> describe the image…', v => { f.prompt = v; }, { max: o.promptLimit || 7500 }),
    o.isDiffusion ? lcdText('NEGATIVE', f.negative, 'what to avoid (optional)…', v => { f.negative = v; }, { dim: true }) : null,
    sub,
  ]);
  pad.appendChild(lcd);

  // ── parameter bank ──
  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'parameter bank' }));

  const knobs = [];
  if (o.steps) knobs.push(knob({ label: 'STEPS', value: Math.min(f.steps ?? o.steps.default ?? 8, o.steps.max || 50), min: 1, max: o.steps.max || 50, step: 1, onInput: v => f.steps = v }));
  if (o.isDiffusion) knobs.push(knob({ label: 'CFG', value: f.cfg, min: 1, max: 20, step: 0.5, fmt: v => v.toFixed(1), onInput: v => f.cfg = v }));
  knobs.push(knob({ label: 'VARIANTS', value: f.variants, min: 1, max: 4, step: 1, onInput: v => { f.variants = v; sub.textContent = summaryText(); } }));
  knobs.push(knob({ label: 'SEED', value: f.seed === '' ? 0 : +f.seed, min: 0, max: 999999, step: 1, display: () => f.seed === '' ? 'AUTO' : String(f.seed), onInput: v => f.seed = String(Math.round(v)), onClick: () => { f.seed = ''; toast('Seed → auto/random'); } }));
  bank.appendChild(el('div', { class: 'knobs' }, knobs));

  // segments (enums)
  bank.appendChild(segment('ASPECT', ratios, ratioVal, v => { f.ratio = v; nav.refresh(); }));
  if (o.resolutions) bank.appendChild(segment('RESOLUTION', o.resolutions, o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0]), v => { f.resolution = v; nav.refresh(); }));
  if (o.qualities) bank.appendChild(segment('QUALITY', o.qualities, o.qualities.includes(f.quality) ? f.quality : (o.defaultQuality || o.qualities[0]), v => { f.quality = v; nav.refresh(); }));
  bank.appendChild(segment('FORMAT', ['webp', 'png', 'jpeg'], f.format, v => { f.format = v; nav.refresh(); }));

  // style preset (large list) → cartridge sheet
  if (state.styles.length) {
    bank.appendChild(cartBtn('STYLE PRESET', f.style || 'None', () => openChoiceSheet('Style cartridges', ['', ...state.styles], f.style, v => f.style = v, x => x || 'None'), 'sparkles'));
  }

  // switches
  bank.appendChild(el('div', { class: 'switches' }, [dialSwitch('HIDE WMARK', f.hideWm, v => f.hideWm = v)]));

  // results / progress
  bank.appendChild(resultsBlock('image'));

  // REC
  const price = priceHint(m);
  bank.appendChild(recButton({
    label: busy.image ? 'GENERATING…' : 'GENERATE', glyph: 'zap', disabled: !!busy.image, pulsing: !!busy.image,
    sub: price != null ? `est ${fmtUSD(price)} · ~12s → library` : 'tap to render → library',
    onClick: () => runJob('image', async () => {
      if (!f.prompt.trim()) { toast('Enter a prompt', 'err'); throw new Error('Enter a prompt'); }
      const body = buildGeneratePayload(m, o, f);
      const res = await api.imageGenerate(body);
      const imgs = res.images || (res.data || []).map(d => d.b64_json || d.url) || [];
      if (!imgs.length) throw new Error('No image returned');
      imgs.forEach(b64 => {
        const dataUrl = b64.startsWith('data:') ? b64 : `data:image/${body.format || 'webp'};base64,${b64}`;
        const a = addAsset({ kind: 'image', dataUrl, prompt: f.prompt.trim(), model: id, modelName: modelName(id), ext: body.format || 'webp' });
        recent.image.unshift(a);
      });
      toast(`${imgs.length} image${imgs.length > 1 ? 's' : ''} ready`, 'ok');
    }),
  }));

  pad.appendChild(bank);
}
function buildGeneratePayload(m, o, f) {
  const body = { model: m.id, prompt: f.prompt.trim(), format: f.format || 'webp' };
  if (o.aspectRatios) {
    body.aspect_ratio = o.aspectRatios.includes(f.ratio) ? f.ratio : (o.defaultAspectRatio || o.aspectRatios[0]);
    if (o.resolutions) body.resolution = o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0]);
  } else {
    const [w, h] = ratioToWH(WH_RATIOS.includes(f.ratio) ? f.ratio : '1:1', o.widthHeightDivisor);
    body.width = w; body.height = h;
  }
  if (o.steps) { const sv = Math.min(o.steps.max || 50, Math.max(1, Math.round(f.steps ?? o.steps.default ?? 8))); body.steps = sv; }
  if (o.isDiffusion) { body.cfg_scale = Math.min(20, Math.max(1, f.cfg)); if (f.negative.trim()) body.negative_prompt = f.negative.trim(); }
  if (o.qualities && f.quality) body.quality = o.qualities.includes(f.quality) ? f.quality : (o.defaultQuality || o.qualities[0]);
  if (f.style) body.style_preset = f.style;
  if (f.variants > 1) body.variants = Math.min(4, f.variants);
  if (f.seed !== '' && !isNaN(+f.seed)) body.seed = +f.seed;
  if (f.hideWm) body.hide_watermark = true;
  return body;
}

function buildEdit(pad) {
  const h = takeHandoff(); if (h?.image) { if (!F.edit.images.includes(h.image)) F.edit.images = [h.image]; }
  const id = selectedFor('inpaint');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('wand', 'No edit models', 'Add a Venice API key to load image-editing models.')); return; }
  const o = editOpts(m);
  const f = F.edit;
  const maxImgs = o.combineImages ? 3 : 1;

  const lcd = el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [
      el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('inpaint'), html: `${icon('cpu', 11)}<span>EDIT · ${escapeHtml(modelName(id).toUpperCase())}</span>` }),
      el('span', { class: 'armed', text: busy.image ? '● WORKING' : '● ARMED' }),
    ]),
    lcdText(null, f.prompt, '> change the sky to a sunrise…', v => { f.prompt = v; }, { max: o.promptLimit || 32768 }),
    el('div', { class: 'sub', text: maxImgs > 1 ? `up to ${maxImgs} tapes · first is the base` : 'single tape edit' }),
  ]);
  pad.appendChild(lcd);

  // tape strip (1..maxImgs)
  const strip = el('div', { class: 'tape-strip' });
  f.images.forEach((u, i) => strip.appendChild(el('div', { class: 'mini' }, [el('img', { src: u }), el('button', { class: 'thumb-x', html: icon('x', 13), onclick: () => { f.images.splice(i, 1); nav.refresh(); } })])));
  if (f.images.length < maxImgs) strip.appendChild(el('button', { class: 'mini add', html: icon('plus', 22), onclick: async () => { const d = await pickImage(); if (d) { f.images.push(d); nav.refresh(); } } }));
  pad.appendChild(strip);

  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'edit bank' }));
  if (o.aspectRatios) bank.appendChild(segment('ASPECT', o.aspectRatios, o.aspectRatios.includes(f.ratio) ? f.ratio : 'auto', v => { f.ratio = v; nav.refresh(); }));
  if (o.resolutions) bank.appendChild(segment('RESOLUTION', o.resolutions, o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0]), v => { f.resolution = v; nav.refresh(); }));
  if (o.qualities) bank.appendChild(segment('QUALITY', o.qualities, o.qualities.includes(f.quality) ? f.quality : (o.defaultQuality || o.qualities[0]), v => { f.quality = v; nav.refresh(); }));
  bank.appendChild(segment('FORMAT', ['', 'png', 'jpeg', 'webp'], f.format, v => { f.format = v; nav.refresh(); }, x => x || 'AUTO'));
  bank.appendChild(resultsBlock('image'));
  bank.appendChild(recButton({
    label: busy.image ? 'EDITING…' : 'APPLY EDIT', glyph: 'wand', disabled: !!busy.image, pulsing: !!busy.image, sub: 'tap to render → library',
    onClick: () => runJob('image', async () => {
      if (!f.images.length) throw new Error('Add an image to edit');
      if (!f.prompt.trim()) throw new Error('Describe the edit');
      const multi = f.images.length > 1;
      const base = { prompt: f.prompt.trim() };
      if (o.aspectRatios && f.ratio && f.ratio !== 'auto' && (multi || o.singleImageAspectRatio)) base.aspect_ratio = f.ratio;
      if (o.resolutions && f.resolution) base.resolution = o.resolutions.includes(f.resolution) ? f.resolution : undefined;
      if (o.qualities && f.quality) base.quality = o.qualities.includes(f.quality) ? f.quality : undefined;
      if (f.format) base.output_format = f.format;
      const res = multi
        ? await api.imageMultiEdit({ ...base, modelId: id, images: f.images })
        : await api.imageEdit({ ...base, model: id, image: f.images[0] });
      if (!res.data) throw new Error('No image returned');
      const a = addAsset({ kind: 'image', dataUrl: res.data, prompt: f.prompt.trim(), model: id, modelName: res.modelName || modelName(id), ext: 'png' });
      recent.image.unshift(a);
      toast('Edit complete', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

function buildEnhance(pad) {
  const h = takeHandoff(); if (h?.image) F.enhance.image = h.image;
  const f = F.enhance;

  pad.appendChild(el('div', { class: 'notice', html: `${icon('upscale', 14)} Upscale up to 4× and/or re-detail with Venice's image engine. A scale of 1× runs the enhancer only.` }));
  pad.appendChild(tapeSlot(f.image, d => { f.image = d; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, 'image to enhance'));

  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'enhance bank' }));
  bank.appendChild(segment('SCALE', [1, 2, 3, 4], f.scale, v => { f.scale = +v; if (+v === 1) f.enhance = true; nav.refresh(); }, x => x + '×'));
  if (f.enhance) {
    bank.appendChild(el('div', { class: 'knobs' }, [
      knob({ label: 'CREATIVITY', value: f.creativity, min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2), onInput: v => f.creativity = v }),
      knob({ label: 'REPLICATION', value: f.replication, min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2), onInput: v => f.replication = v }),
    ]));
  }
  bank.appendChild(el('div', { class: 'switches' }, [dialSwitch('ENHANCE DETAIL', f.enhance, v => { if (f.scale === 1 && !v) { toast('Enhance is required at 1×'); nav.refresh(); return; } f.enhance = v; nav.refresh(); })]));
  if (f.enhance) bank.appendChild(lcdText('ENHANCE STYLE (OPTIONAL)', f.prompt, 'e.g. gold, marble, cinematic', v => f.prompt = v, { dim: true }));
  bank.appendChild(resultsBlock('image'));
  bank.appendChild(recButton({
    label: busy.image ? 'ENHANCING…' : 'ENHANCE', glyph: 'upscale', disabled: !!busy.image, pulsing: !!busy.image, sub: 'tap to render → library',
    onClick: () => runJob('image', async () => {
      if (!f.image) throw new Error('Add an image first');
      const body = { image: f.image, scale: f.scale };
      if (f.enhance || f.scale === 1) { body.enhance = true; body.enhanceCreativity = f.creativity; if (f.prompt.trim()) body.enhancePrompt = f.prompt.trim(); }
      body.replication = f.replication;
      const res = await api.upscale(body);
      if (!res.data) throw new Error('No image returned');
      const a = addAsset({ kind: 'image', dataUrl: res.data, prompt: `Enhanced ${f.scale}×`, model: 'upscale', modelName: `Upscale ${f.scale}×`, ext: 'png' });
      recent.image.unshift(a);
      toast('Enhanced', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

function buildBg(pad) {
  const h = takeHandoff(); if (h?.image) F.bg.image = h.image;
  const f = F.bg;
  pad.appendChild(el('div', { class: 'notice', html: `${icon('scissors', 14)} Remove the background and get a transparent PNG — perfect for stickers, products and overlays.` }));
  pad.appendChild(tapeSlot(f.image, d => { f.image = d; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, 'image'));
  const bank = el('div', { class: 'bank' });
  bank.appendChild(resultsBlock('image'));
  bank.appendChild(recButton({
    label: busy.image ? 'CUTTING…' : 'REMOVE BG', glyph: 'scissors', disabled: !!busy.image, pulsing: !!busy.image, sub: 'transparent png → library',
    onClick: () => runJob('image', async () => {
      if (!f.image) throw new Error('Add an image first');
      const res = await api.bgRemove({ image: f.image });
      if (!res.data) throw new Error('No image returned');
      const a = addAsset({ kind: 'image', dataUrl: res.data, prompt: 'Background removed', model: 'bg-remove', modelName: 'Background remove', ext: 'png' });
      recent.image.unshift(a);
      toast('Background removed', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

// ════════════════════════════ VIDEO ════════════════════════════
function viewVideo() {
  const frag = document.createDocumentFragment();
  const { scroll, pad } = toolScroll();
  frag.appendChild(scroll);

  const id = selectedFor('video');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('video', 'No video models', 'Add a Venice API key to load video models.')); return frag; }
  const o = videoOpts(m);
  const f = F.video;
  const h = takeHandoff(); if (h?.image) { f.image = h.image; if (!o.allowsImage) { const i2v = modelsByType('video').find(x => videoOpts(x).allowsImage); if (i2v) { state.selected.video = i2v.id; return viewVideo(); } } }

  const durVal = o.durations.includes(f.duration) ? f.duration : o.durations[0];
  const prog = typeof busy.video === 'number' ? busy.video : null;
  const statusR = busy.video ? `RENDERING ${prog != null ? Math.round(prog * 100) + '%' : '…'}` : '● ARMED';

  const lcd = el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [
      el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('video'), html: `${icon('cpu', 11)}<span>VID · ${escapeHtml(modelName(id).toUpperCase())}</span>` }),
      el('span', { class: 'armed', text: statusR }),
    ]),
    lcdText(null, f.prompt, o.needsImage ? '> describe the motion and camera…' : '> describe the scene, motion and style…', v => { f.prompt = v; }, { max: o.promptLimit }),
    el('div', { class: 'sub', text: `${o.modelType.replace(/-/g, ' ')} · ${durVal}${o.audio ? ' · audio' : ''}${f.quote != null ? ' · est ' + fmtUSD(f.quote) : ''}` }),
  ]);
  if (busy.video) lcd.appendChild(el('div', { class: 'progress', style: { marginTop: '8px' } }, el('i', { style: { width: (prog != null ? Math.round(prog * 100) : 8) + '%' } })));
  pad.appendChild(lcd);

  if (o.allowsImage) pad.appendChild(tapeSlot(f.image, d => { f.image = d; f.quote = null; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, o.needsImage ? 'source image (required)' : 'source image (optional)'));

  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'render bank' }));
  const knobs = [enumKnob('DURATION', o.durations, durVal, v => { f.duration = v; f.quote = null; })];
  if (o.resolutions) knobs.push(enumKnob('RESOLUTION', o.resolutions, o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0], v => { f.resolution = v; f.quote = null; }));
  bank.appendChild(el('div', { class: 'knobs' }, knobs));
  if (o.aspectRatios) bank.appendChild(segment('ASPECT', o.aspectRatios, o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0], v => { f.ratio = v; f.quote = null; nav.refresh(); }));
  if (o.audioConfigurable) bank.appendChild(el('div', { class: 'switches' }, [dialSwitch('AUDIO', f.audio, v => f.audio = v)]));
  bank.appendChild(lcdText('NEGATIVE', f.negative, 'what to avoid (optional)…', v => f.negative = v, { dim: true }));

  // quote
  bank.appendChild(el('div', { class: 'inline-actions' }, [
    el('button', { class: 'btn sm', html: `${icon('info', 15)} Price quote`, onclick: async () => {
      try {
        const qb = { model: id, duration: durVal };
        if (o.aspectRatios) qb.aspect_ratio = o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0];
        if (o.resolutions) qb.resolution = o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0];
        if (o.audioConfigurable) qb.audio = f.audio;
        const q = await api.videoQuote(qb); f.quote = q.quote; nav.refresh();
      } catch (e) { toast(e.message, 'err'); }
    } }),
    f.quote != null ? el('div', { class: 'price-quote', text: `≈ ${fmtUSD(f.quote)}` }) : null,
  ].filter(Boolean)));

  bank.appendChild(resultsBlock('video'));
  bank.appendChild(recButton({
    label: busy.video ? 'RENDERING…' : 'GENERATE VIDEO', glyph: 'video', disabled: !!busy.video, pulsing: !!busy.video,
    sub: priceHint(m) != null && f.quote == null ? `~${fmtUSD(priceHint(m))}/sec · tap quote for exact` : (f.quote != null ? `est ${fmtUSD(f.quote)} → library` : 'tap to render → library'),
    onClick: () => runJob('video', async () => {
      if (o.needsImage && !f.image) throw new Error('This model needs a source image');
      if (!f.prompt.trim()) throw new Error('Enter a prompt');
      const body = { model: id, prompt: f.prompt.trim(), duration: durVal };
      if (o.aspectRatios) body.aspect_ratio = o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0];
      if (o.resolutions) body.resolution = o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0];
      if (o.audioConfigurable) body.audio = !!f.audio;
      if (f.negative.trim()) body.negative_prompt = f.negative.trim();
      if (o.allowsImage && f.image) body.image_url = f.image;
      jobState.video = { stage: 'preparing' }; nav.refresh();
      const q = await api.videoQueue(body);
      if (!q.queue_id) throw new Error('Could not queue video');
      jobState.video = { stage: 'queued', status: 'waiting in queue', queueId: q.queue_id }; nav.refresh();
      const url = await pollJob('video', { model: id, queueId: q.queue_id, downloadUrl: q.download_url }, (p, status) => {
        const statusText = status || 'rendering';
        const finalizing = /complete|final/i.test(statusText) || (typeof p === 'number' && p > 0.92);
        jobState.video = { stage: finalizing ? 'finalizing' : 'rendering', status: statusText, queueId: q.queue_id };
        busy.video = (p == null || p <= 0.02) ? true : p; nav.refresh();
      });
      const a = addAsset({ kind: 'video', dataUrl: url, prompt: f.prompt.trim(), model: id, modelName: modelName(id), ext: 'mp4' });
      recent.video.unshift(a);
      toast('Video ready', 'ok');
    }),
  }));
  pad.appendChild(bank);
  return frag;
}

// ════════════════════════════ AUDIO (music / speech / transcribe) ════════════════════════════
const AUDIO_MODES = [
  { k: 'music', label: 'Music', icon: 'music' },
  { k: 'speech', label: 'Speech', icon: 'volume' },
  { k: 'transcribe', label: 'Transcribe', icon: 'mic' },
];
function viewAudio() {
  const mode = state.mode.audio || 'music';
  const frag = document.createDocumentFragment();
  frag.appendChild(el('div', { class: 'segmented' }, AUDIO_MODES.map(mm =>
    el('button', { class: 'seg' + (mode === mm.k ? ' active' : ''), html: `${icon(mm.icon, 14)} ${mm.label}`, onclick: () => { state.mode.audio = mm.k; nav.refresh(); } })
  )));
  const { scroll, pad } = toolScroll();
  frag.appendChild(scroll);

  if (mode === 'music') buildMusic(pad);
  else if (mode === 'speech') buildSpeech(pad);
  else buildTranscribe(pad);
  return frag;
}

function buildMusic(pad) {
  const id = selectedFor('music');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('music', 'No music models', 'Add a Venice API key to load music models.')); return; }
  const o = musicOpts(m);
  const f = F.music;

  pad.appendChild(el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [
      el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('music'), html: `${icon('cpu', 11)}<span>MUS · ${escapeHtml(modelName(id).toUpperCase())}</span>` }),
      el('span', { class: 'armed', text: busy.audio ? '● WORKING' : '● ARMED' }),
    ]),
    lcdText(null, f.prompt, '> genre, mood, instruments, tempo…', v => { f.prompt = v; }, { max: o.promptLimit || 2000 }),
    o.minPromptLength > 1 ? el('div', { class: 'sub', text: `min ${o.minPromptLength} chars` }) : null,
  ]));

  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'studio bank' }));

  const switches = [];
  if (o.supportsForceInstrumental) switches.push(dialSwitch('INSTRUMENTAL', f.instrumental, v => { f.instrumental = v; nav.refresh(); }));
  if (o.supportsLyrics && !f.instrumental && o.supportsLyricsOptimizer) switches.push(dialSwitch('AUTO-LYRICS', f.optimizer, v => { f.optimizer = v; nav.refresh(); }));
  if (switches.length) bank.appendChild(el('div', { class: 'switches' }, switches));

  if (o.supportsLyrics && !f.instrumental && !f.optimizer) bank.appendChild(lcdText(o.lyricsRequired ? 'LYRICS (REQUIRED)' : 'LYRICS (OPTIONAL)', f.lyrics, 'Verse 1: …', v => f.lyrics = v, { dim: true, max: o.lyricsLimit || 5000 }));
  if (o.voices) bank.appendChild(cartBtn('VOICE', o.voices.includes(f.voice) ? f.voice : (o.defaultVoice || o.voices[0]), () => openChoiceSheet('Voice cartridges', o.voices, o.voices.includes(f.voice) ? f.voice : (o.defaultVoice || o.voices[0]), v => f.voice = v), 'volume'));
  if (o.supportsLanguageCode) bank.appendChild(lcdText('LANGUAGE CODE', f.lang, 'e.g. en, es, ja', v => f.lang = v, { dim: true }));

  const knobs = [];
  const durMeta = o.durationOptions || (o.minDuration && o.maxDuration);
  if (o.durationOptions) knobs.push(enumKnob('DURATION', o.durationOptions, o.durationOptions.includes(f.duration) ? f.duration : (o.defaultDuration || o.durationOptions[0]), v => f.duration = v, x => x + 's'));
  else if (o.minDuration && o.maxDuration) knobs.push(knob({ label: 'DURATION', value: f.duration ?? o.defaultDuration ?? o.minDuration, min: o.minDuration, max: o.maxDuration, step: 1, fmt: v => v + 's', onInput: v => f.duration = v }));
  if (o.supportsSpeed) knobs.push(knob({ label: 'SPEED', value: f.speed ?? o.defaultSpeed, min: o.minSpeed, max: o.maxSpeed, step: 0.05, fmt: v => v.toFixed(2) + '×', onInput: v => f.speed = v }));
  if (knobs.length) bank.appendChild(el('div', { class: 'knobs' }, knobs));

  bank.appendChild(resultsBlock('audio'));
  bank.appendChild(recButton({
    label: busy.audio ? 'COMPOSING…' : 'GENERATE MUSIC', glyph: 'music', disabled: !!busy.audio, pulsing: !!busy.audio, sub: 'tap to compose → library',
    onClick: () => runJob('audio', async () => {
      if (!f.prompt.trim()) throw new Error('Enter a prompt');
      const body = { model: id, prompt: f.prompt.trim() };
      if (o.supportsForceInstrumental && f.instrumental) body.force_instrumental = true;
      if (o.supportsLyrics && !f.instrumental) {
        if (o.supportsLyricsOptimizer && f.optimizer) body.lyrics_optimizer = true;
        else if (f.lyrics.trim()) body.lyrics_prompt = f.lyrics.trim();
      }
      if (o.lyricsRequired && !body.lyrics_prompt && !body.lyrics_optimizer && !f.instrumental) throw new Error('This model requires lyrics');
      if (o.voices) body.voice = o.voices.includes(f.voice) ? f.voice : (o.defaultVoice || o.voices[0]);
      if (o.supportsLanguageCode && f.lang.trim()) body.language_code = f.lang.trim();
      if (durMeta) { const d = o.durationOptions ? (o.durationOptions.includes(f.duration) ? f.duration : (o.defaultDuration || o.durationOptions[0])) : Math.round(f.duration ?? o.defaultDuration ?? o.minDuration); if (d) body.duration_seconds = d; }
      if (o.supportsSpeed && f.speed != null) body.speed = f.speed;
      const q = await api.audioQueue(body);
      if (!q.queue_id) throw new Error('Could not queue audio');
      const url = await pollJob('audio', { model: id, queueId: q.queue_id }, (p) => { busy.audio = (p == null || p <= 0.02) ? true : p; nav.refresh(); });
      const a = addAsset({ kind: 'audio', dataUrl: url, prompt: f.prompt.trim(), model: id, modelName: modelName(id), ext: 'mp3' });
      recent.audio.unshift(a);
      toast('Music ready', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

function buildSpeech(pad) {
  const id = selectedFor('tts');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('volume', 'No speech models', 'Add a Venice API key to load TTS models.')); return; }
  const o = ttsOpts(m);
  const f = F.speech;

  pad.appendChild(el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [
      el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('tts'), html: `${icon('cpu', 11)}<span>VOX · ${escapeHtml(modelName(id).toUpperCase())}</span>` }),
      el('span', { class: 'armed', text: busy.audio ? '● WORKING' : '● ARMED' }),
    ]),
    lcdText(null, f.text, '> type what you want spoken…', v => { f.text = v; }, { max: 4096 }),
    el('div', { class: 'sub', text: 'up to 4096 characters' }),
  ]));

  const bank = el('div', { class: 'bank' });
  bank.appendChild(el('div', { class: 'bank-t', text: 'voice bank' }));
  bank.appendChild(cartBtn('VOICE', o.voices.includes(f.voice) ? f.voice : o.voices[0], () => openChoiceSheet('Voice cartridges', o.voices, o.voices.includes(f.voice) ? f.voice : o.voices[0], v => f.voice = v), 'volume'));

  const knobs = [knob({ label: 'SPEED', value: f.speed, min: 0.25, max: 4, step: 0.05, fmt: v => v.toFixed(2) + '×', onInput: v => f.speed = v })];
  if (o.supportsTemperature) knobs.push(knob({ label: 'TEMP', value: f.temperature, min: 0, max: 2, step: 0.05, fmt: v => v.toFixed(2), onInput: v => f.temperature = v }));
  if (o.supportsTopP) knobs.push(knob({ label: 'TOP P', value: f.topP, min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2), onInput: v => f.topP = v }));
  bank.appendChild(el('div', { class: 'knobs' }, knobs));

  bank.appendChild(segment('FORMAT', ['mp3', 'opus', 'aac', 'flac', 'wav'], f.format, v => { f.format = v; nav.refresh(); }));
  if (o.supportsPrompt) bank.appendChild(lcdText('STYLE DIRECTION', f.style, 'e.g. Very happy. Excited.', v => f.style = v, { dim: true }));
  bank.appendChild(lcdText('LANGUAGE (OPTIONAL)', f.lang, 'e.g. en, English, ja', v => f.lang = v, { dim: true }));

  bank.appendChild(resultsBlock('audio'));
  bank.appendChild(recButton({
    label: busy.audio ? 'SYNTHESISING…' : 'GENERATE SPEECH', glyph: 'volume', disabled: !!busy.audio, pulsing: !!busy.audio, sub: 'tap to synthesise → library',
    onClick: () => runJob('audio', async () => {
      if (!f.text.trim()) throw new Error('Enter some text');
      const body = { model: id, input: f.text.slice(0, 4096), voice: o.voices.includes(f.voice) ? f.voice : o.voices[0], response_format: f.format || 'mp3' };
      if (f.speed !== 1) body.speed = f.speed;
      if (f.lang.trim()) body.language = f.lang.trim();
      if (o.supportsPrompt && f.style.trim()) body.prompt = f.style.trim();
      if (o.supportsTemperature) body.temperature = f.temperature;
      if (o.supportsTopP) body.top_p = f.topP;
      const res = await api.speech(body);
      if (!res.data) throw new Error('No audio returned');
      const a = addAsset({ kind: 'audio', dataUrl: res.data, prompt: f.text.slice(0, 120), model: id, modelName: modelName(id), ext: f.format || 'mp3' });
      recent.audio.unshift(a);
      toast('Speech ready', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

function buildTranscribe(pad) {
  const id = selectedFor('asr');
  const f = F.transcribe;
  const hasModel = modelsByType('asr').length;

  pad.appendChild(el('div', { class: 'lcd tall' }, [
    el('div', { class: 'ltop' }, [
      hasModel ? el('button', { class: 'lt-l tap', onclick: () => nav.openModelPicker('asr'), html: `${icon('cpu', 11)}<span>ASR · ${escapeHtml((modelName(id) || 'auto').toUpperCase())}</span>` }) : el('span', { class: 'lt-l', text: 'ASR · TRANSCRIBE' }),
      el('span', { class: 'armed', text: busy.audio ? '● WORKING' : f.text ? '● DONE' : '● ARMED' }),
    ]),
    el('div', { class: 'lcd-scroll' }, f.text
      ? el('div', { class: 'ca', text: f.text })
      : el('div', { class: 'ca', html: '◆ load an audio or video tape below, then press TRANSCRIBE.' })),
  ]));

  // tape slot for audio file
  const slot = f.audio
    ? el('div', { class: 'tape-thumb', style: { padding: '14px', display: 'flex', alignItems: 'center', gap: '10px' } }, [el('span', { style: { color: 'var(--accent)' }, html: icon('volume', 22) }), el('div', { style: { flex: '1', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--amb)' }, text: f.filename || 'audio file' }), el('button', { class: 'act', html: icon('x', 14), onclick: () => { f.audio = null; f.filename = ''; nav.refresh(); } })])
    : el('button', { class: 'tape-slot', onclick: () => { const inp = document.getElementById('fileAudio'); inp.value = ''; inp.onchange = async () => { const file = inp.files?.[0]; if (!file) return; f.filename = file.name; f.audio = await fileToDataURL(file); nav.refresh(); }; inp.click(); } }, [el('span', { class: 'ts-ic', html: icon('upload', 28) }), el('span', { text: 'AUDIO / VIDEO TAPE' }), el('span', { class: 'ts-sub', text: 'tap to choose a file' })]);
  pad.appendChild(slot);

  if (f.text) pad.appendChild(el('div', { class: 'result-actions' }, [
    el('button', { class: 'act', html: `${icon('copy', 14)} Copy`, onclick: () => copyText(f.text) }),
    el('button', { class: 'act', html: `${icon('download', 14)} Download`, onclick: () => downloadText(f.text, 'vgpt-transcript.txt') }),
    el('button', { class: 'act accent', html: `${icon('chat', 14)} Send to chat`, onclick: () => { newChat(); chat.messages.push({ role: 'user', content: f.text, display: f.text }); nav.goTo('chat'); runChat(); } }),
  ]));

  const bank = el('div', { class: 'bank' });
  bank.appendChild(resultsBlock('audio'));
  bank.appendChild(recButton({
    label: busy.audio ? 'TRANSCRIBING…' : 'TRANSCRIBE', glyph: 'mic', disabled: !!busy.audio, pulsing: !!busy.audio, sub: 'tap to transcribe',
    onClick: () => runJob('audio', async () => {
      if (!f.audio) throw new Error('Choose an audio file');
      const body = { audio: f.audio, filename: f.filename || 'audio.mp3', response_format: 'json' };
      if (id) body.model = id;
      if (f.language?.trim()) body.language = f.language.trim();
      const res = await api.transcribe(body);
      f.text = res.text || res || ''; if (typeof f.text !== 'string') f.text = JSON.stringify(f.text);
      toast('Transcribed', 'ok');
    }),
  }));
  pad.appendChild(bank);
}

// ════════════════════════════ LIBRARY ════════════════════════════
const KIND_TAG = { image: 'IMG', video: 'VID', audio: 'AUD' };
function viewLibrary() {
  const frag = document.createDocumentFragment();
  const assets = listAssets();

  const lcd = el('div', { class: 'lcd tall' });
  lcd.appendChild(el('div', { class: 'ltop' }, [el('span', { text: 'LIBRARY · ~/vgpt' }), el('span', { text: `${assets.length} ITEM${assets.length === 1 ? '' : 'S'}` })]));

  if (!assets.length) {
    lcd.appendChild(el('div', { class: 'lcd-scroll' }, el('div', { class: 'ca', html: '◆ nothing here yet. generate an image, video or track — it lands here, ready to download or chain into another tool.' })));
    frag.appendChild(lcd);
    return frag;
  }

  libSel = Math.max(0, Math.min(libSel, assets.length - 1));
  const list = el('div', { class: 'lcd-scroll' });
  assets.forEach((a, i) => {
    const meta = [a.modelName || a.model, a.bytes ? (a.bytes / 1024 | 0) + ' KB' : ''].filter(Boolean).join(' · ');
    const name = (a.prompt || a.modelName || a.kind || 'untitled').slice(0, 28);
    list.appendChild(el('button', { class: 'lrow' + (i === libSel ? ' sel' : ''), onclick: () => { if (i === libSel) openAsset(a); else { libSel = i; nav.refresh(); } } }, [
      el('span', { class: 'lt', text: KIND_TAG[a.kind] || 'TXT' }),
      el('span', { class: 'ln', text: name }),
      el('span', { class: 'lm', text: meta }),
    ]));
  });
  lcd.appendChild(list);
  frag.appendChild(lcd);

  // jog dial: prev / open / next
  frag.appendChild(el('div', { class: 'jog' }, [
    el('button', { class: 'jogd', disabled: libSel <= 0, html: icon('caretLeft', 22), onclick: () => { libSel = Math.max(0, libSel - 1); nav.refresh(); } }),
    el('button', { class: 'jogd big', html: icon('enter', 26), onclick: () => openAsset(assets[libSel]) }),
    el('button', { class: 'jogd', disabled: libSel >= assets.length - 1, html: icon('caretRight', 22), onclick: () => { libSel = Math.min(assets.length - 1, libSel + 1); nav.refresh(); } }),
  ]));
  return frag;
}
function openAsset(a) {
  if (!a) return;
  const body = el('div', {}, [resultCard(a), el('button', { class: 'btn full ghost', style: { marginTop: '6px', color: 'var(--danger)' }, html: `${icon('trash', 18)} Delete`, onclick: () => { removeAsset(a.id); recent.image = recent.image.filter(x => x.id !== a.id); recent.video = recent.video.filter(x => x.id !== a.id); recent.audio = recent.audio.filter(x => x.id !== a.id); nav.closeSheet(); nav.refresh(); } })]);
  nav.openSheet('Asset', body);
}

// header pill context for the current tool/mode (kept for compatibility)
export function currentModelContext() {
  if (state.tool === 'chat') return { type: 'text', show: true };
  if (state.tool === 'image') { const mo = state.mode.image; return mo === 'generate' ? { type: 'image', show: true } : mo === 'edit' ? { type: 'inpaint', show: true } : { type: null, show: false }; }
  if (state.tool === 'video') return { type: 'video', show: true };
  if (state.tool === 'audio') { const mo = state.mode.audio; return { type: mo === 'music' ? 'music' : mo === 'speech' ? 'tts' : 'asr', show: true }; }
  return { type: null, show: false };
}

export const views = { chat: viewChat, image: viewImage, video: viewVideo, audio: viewAudio, library: viewLibrary };
