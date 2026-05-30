// ═══════════════════════════════════════════════════════════════════════════
// vGPT tools — one view per capability. Every form is built from the selected
// model's advertised constraints/capabilities, and every request payload only
// includes parameters that model supports (clamped to its ranges). This keeps
// the app correct as Venice adds new models with new parameter shapes.
// ═══════════════════════════════════════════════════════════════════════════
import {
  el, icon, toast, clear, mdToHtml, fileToDataURL, fmtUSD, downloadDataUrl,
  state, api, nav, guardQuery,
  modelsByType, findModel, modelName, selectedFor,
  imageOpts, editOpts, videoOpts, musicOpts, ttsOpts, textCaps,
  ratioToWH, WH_RATIOS, priceHint,
  addAsset, listAssets, removeAsset, pickImage, pollJob,
} from './core.js';

// per-view form state (kept across re-renders within a session)
const F = {
  chat: { atts: [], webSearch: 'auto', effort: '' },
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
const busy = {};                                      // view -> bool
let chat = { messages: [], streaming: false, abort: null };

// ── small control builders ──────────────────────────────────────────────────
function field(label, control, hint, valText) {
  return el('div', { class: 'field' }, [
    label ? el('div', { class: 'label' }, [el('span', { text: label }), valText != null ? el('span', { class: 'val', text: valText }) : null]) : null,
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}
function textarea(value, placeholder, oninput, attrs = {}) {
  const t = el('textarea', { placeholder, ...attrs });
  t.value = value || '';
  t.addEventListener('input', e => oninput(e.target.value));
  return t;
}
function chips(options, value, onPick, labels) {
  const wrap = el('div', { class: 'chips' });
  options.forEach(opt => {
    const c = el('button', { class: 'chip' + (String(opt) === String(value) ? ' active' : ''), text: labels ? labels(opt) : String(opt) });
    c.addEventListener('click', () => onPick(opt));
    wrap.appendChild(c);
  });
  return wrap;
}
function slider(min, max, step, value, oninput) {
  const s = el('input', { type: 'range', min, max, step });
  s.value = value;
  s.addEventListener('input', e => oninput(parseFloat(e.target.value)));
  return s;
}
function toggle(value, onToggle) {
  const track = el('div', { class: 'switch-track' + (value ? ' on' : '') }, el('div', { class: 'switch-knob' }));
  track.addEventListener('click', () => onToggle(!value));
  return track;
}
function switchRow(label, value, onToggle, hint) {
  return el('div', { class: 'field' }, [
    el('div', { class: 'switch' }, [
      el('div', {}, [el('div', { class: 'label', style: { marginBottom: hint ? '2px' : '0' } }, el('span', { text: label })), hint ? el('div', { class: 'hint', text: hint }) : null]),
      toggle(value, onToggle),
    ]),
  ]);
}
function select(options, value, onChange, labels) {
  const s = el('select');
  options.forEach(o => {
    const opt = el('option', { value: String(o), text: labels ? labels(o) : String(o) });
    if (String(o) === String(value)) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', e => onChange(e.target.value));
  return s;
}
function generateBar(label, accentIcon, onClick, disabled, priceNote) {
  return el('div', { class: 'generate-bar' }, [
    priceNote ? el('div', { class: 'hint', style: { textAlign: 'center', marginBottom: '8px' }, html: priceNote }) : null,
    el('button', { class: 'btn primary full', disabled, html: `${icon(accentIcon, 18)} ${label}`, onclick: onClick }),
  ]);
}
function loadingCard(primary, sub, progress) {
  return el('div', { class: 'card loading-card' }, [
    el('div', { class: 'spinner' }),
    el('div', { class: 'lp', text: primary }),
    sub ? el('div', { class: 'ls', text: sub }) : null,
    progress != null ? el('div', { class: 'progress' }, el('i', { style: { width: Math.round(progress * 100) + '%' } })) : null,
  ]);
}
const ACCENT2 = { '--c-chat': '#ff8a4c', '--c-image': '#ffce4c', '--c-edit': '#ff8a4c', '--c-enhance': '#21d4fd', '--c-video': '#21d4fd', '--c-music': '#4b8bff', '--c-voice': '#21d4fd', '--c-library': '#ff8ad0' };
function setAccent(v) {
  const root = document.documentElement.style;
  root.setProperty('--accent', `var(${v})`);
  root.setProperty('--accent-2', ACCENT2[v] || `var(${v})`);
}
function toolHead(glyph, accentVar, title, desc) {
  setAccent(accentVar);
  return el('div', { class: 'tool-head' }, [
    el('div', { class: 'tool-title' }, [el('span', { class: 'glyph', html: icon(glyph, 18) }), title]),
    desc ? el('div', { class: 'tool-desc', text: desc }) : null,
  ]);
}

// model selector button (opens picker for a given type)
function modelButton(type, accentVar) {
  const id = selectedFor(type);
  const m = findModel(id);
  return el('button', { class: 'card', style: { display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', width: '100%', padding: '13px 15px' }, onclick: () => nav.openModelPicker(type) }, [
    el('div', { class: 'glyph', style: { width: '34px', height: '34px', borderRadius: '10px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none' }, html: icon('cpu', 18) }),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div', { style: { fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-3)' }, text: 'Model' }),
      el('div', { style: { fontSize: '15px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: m ? modelName(id) : (modelsByType(type).length ? 'Select…' : 'None available') }),
    ]),
    el('span', { style: { color: 'var(--text-3)' }, html: icon('chevronDown', 18) }),
  ]);
}

// image source control (single)
function imageSource(current, onPick, onClear, label = 'Source image') {
  if (current) {
    return el('div', { class: 'field' }, [
      el('div', { class: 'label' }, el('span', { text: label })),
      el('div', { class: 'thumb-wrap' }, [
        el('img', { src: current }),
        el('button', { class: 'thumb-x', html: icon('x', 16), onclick: onClear }),
      ]),
    ]);
  }
  return el('div', { class: 'field' }, [
    el('div', { class: 'label' }, el('span', { text: label })),
    el('button', { class: 'source', style: { width: '100%' }, onclick: async () => { const d = await pickImage(); if (d) onPick(d); } }, [
      el('span', { style: { color: 'var(--accent)' }, html: icon('image', 26) }),
      el('div', { text: 'Tap to upload, capture, or pick from your library' }),
    ]),
  ]);
}

// result card with chaining actions
function resultCard(asset) {
  let media;
  if (asset.kind === 'image') media = el('img', { class: 'result-media img', src: asset.dataUrl });
  else if (asset.kind === 'video') media = el('video', { class: 'result-media', src: asset.dataUrl, controls: 'true', playsinline: 'true' });
  else media = el('div', { class: 'aplayer' }, [el('div', { class: 'a-ico', html: icon('music', 26) }), el('audio', { src: asset.dataUrl, controls: 'true' })]);

  const acts = el('div', { class: 'result-actions' });
  const dlName = `vgpt-${asset.id}.${asset.ext || (asset.kind === 'image' ? 'png' : asset.kind === 'video' ? 'mp4' : 'mp3')}`;
  acts.appendChild(el('button', { class: 'act', html: `${icon('download', 14)} Save`, onclick: () => downloadDataUrl(asset.dataUrl, dlName) }));
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
      el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '6px', fontFamily: 'var(--font-mono)' }, text: [asset.modelName || asset.model, asset.bytes ? (asset.bytes / 1024 | 0) + ' KB' : ''].filter(Boolean).join(' · ') }),
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

function emptyState(glyph, title, desc) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'orb', html: icon(glyph, 38) }),
    el('h2', { text: title }),
    el('p', { text: desc }),
  ]);
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
  finally { busy[view] = false; nav.refresh(); }
}

// ════════════════════════════ CHAT ════════════════════════════
function viewChat() {
  setAccent('--c-chat');
  const id = selectedFor('text');
  const m = findModel(id);
  const caps = textCaps(m);

  const frag = document.createDocumentFragment();
  const scroll = el('div', { class: 'scroll' });

  if (!chat.messages.length) {
    const sugg = [
      { i: 'cpu', t: 'Explain quantum computing simply' },
      { i: 'type', t: 'Write a launch tweet for my app' },
      { i: 'globe', t: 'Plan a 3-day trip to Tokyo' },
      { i: 'sparkles', t: 'Brainstorm 10 startup ideas in climate tech' },
    ];
    scroll.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'orb', html: icon('chat', 38) }),
      el('h2', { text: 'Ask vGPT anything' }),
      el('p', { text: caps.vision ? 'Chat, reason, search the web, or attach an image to ask about it.' : 'Chat, reason, and search the web with Venice models.' }),
      el('div', { class: 'suggestions' }, sugg.map(s => el('button', { class: 'suggestion', html: `${icon(s.i, 17)}<span></span>`, onclick: () => { const ta = $composer(); ta.value = s.t; ta.dispatchEvent(new Event('input')); ta.focus(); } }, []))),
    ]));
    // fill suggestion text safely
    setTimeout(() => scroll.querySelectorAll('.suggestion span').forEach((sp, i) => sp.textContent = sugg[i].t), 0);
  } else {
    const list = el('div', { class: 'chat-list' });
    chat.messages.forEach(msg => list.appendChild(renderMsg(msg)));
    scroll.appendChild(list);
    setTimeout(() => scroll.scrollTo({ top: scroll.scrollHeight }), 0);
  }

  // composer
  const atts = el('div', { class: 'composer-atts' });
  F.chat.atts.forEach((u, i) => atts.appendChild(el('div', { class: 'ca' }, [
    el('img', { src: u }), el('button', { class: 'ca-x', html: icon('x', 12), onclick: () => { F.chat.atts.splice(i, 1); nav.refresh(); } }),
  ])));

  const ta = el('textarea', { placeholder: 'Message vGPT…', rows: '1', id: 'chatInput' });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(130, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });

  const attachBtn = caps.vision ? el('button', { class: 'cbtn', html: icon('paperclip', 20), title: 'Attach image', onclick: async () => { const d = await pickImage({ title: 'Attach image' }); if (d) { F.chat.atts.push(d); nav.refresh(); } } }) : null;
  const webBtn = caps.webSearch ? el('button', { class: 'cbtn', style: F.chat.webSearch !== 'off' ? { color: 'var(--c-chat)', background: 'var(--accent-soft)' } : {}, html: icon('globe', 20), title: `Web search: ${F.chat.webSearch}`, onclick: () => { F.chat.webSearch = F.chat.webSearch === 'off' ? 'auto' : F.chat.webSearch === 'auto' ? 'on' : 'off'; toast(`Web search: ${F.chat.webSearch}`); nav.refresh(); } }) : null;
  const sendBtn = el('button', { class: 'cbtn send', html: chat.streaming ? icon('x', 18) : icon('send', 18), onclick: () => chat.streaming ? stopChat() : send() });

  const composer = el('div', { class: 'composer' }, [
    F.chat.atts.length ? atts : null,
    el('div', { class: 'composer-inner' }, [attachBtn, ta, webBtn, sendBtn].filter(Boolean)),
  ]);

  function $composer() { return ta; }
  function send() {
    const text = ta.value.trim();
    if ((!text && !F.chat.atts.length) || chat.streaming) return;
    const content = F.chat.atts.length
      ? [...(text ? [{ type: 'text', text }] : []), ...F.chat.atts.map(u => ({ type: 'image_url', image_url: { url: u } }))]
      : text;
    chat.messages.push({ role: 'user', content, atts: [...F.chat.atts], display: text });
    F.chat.atts = [];
    ta.value = ''; ta.style.height = 'auto';
    runChat();
  }

  frag.appendChild(scroll);
  frag.appendChild(composer);
  return frag;
}

function renderMsg(msg) {
  const isUser = msg.role === 'user';
  const body = el('div', { class: 'body' });
  body.appendChild(el('div', { class: 'who', text: isUser ? 'You' : 'vGPT' }));
  if (isUser && msg.atts?.length) {
    const a = el('div', { class: 'att' });
    msg.atts.forEach(u => a.appendChild(el('img', { src: u })));
    body.appendChild(a);
  }
  if (!isUser && msg.streaming && !msg.content) {
    body.appendChild(el('div', { class: 'typing' }, [el('i'), el('i'), el('i')]));
  } else {
    const txt = isUser ? (msg.display ?? (typeof msg.content === 'string' ? msg.content : '')) : msg.content;
    body.appendChild(el('div', { class: 'content', html: isUser ? mdToHtml(txt) : mdToHtml(txt || '') }));
  }
  if (!isUser && msg.reasoning) {
    body.appendChild(el('details', { class: 'reasoning' }, [
      el('summary', { html: `${icon('sparkles', 14)} Reasoning` }),
      el('div', { class: 'r-body', text: msg.reasoning }),
    ]));
  }
  if (!isUser && msg.metrics) {
    const mt = msg.metrics;
    body.appendChild(el('div', { class: 'metrics' }, [
      mt.tps ? el('span', { class: 'm', text: `${mt.tps} tok/s` }) : null,
      mt.total ? el('span', { class: 'm', text: `${mt.total} tokens` }) : null,
      mt.cost ? el('span', { class: 'm', text: fmtUSD(mt.cost) }) : null,
    ].filter(Boolean)));
  }
  return el('div', { class: `msg ${msg.role}` }, [el('div', { class: 'av', html: icon(isUser ? 'type' : 'sparkles', 15) }), body]);
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
    // strip <think> blocks if present
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
  { k: 'bg', label: 'Remove BG', icon: 'scissors' },
];
function viewImage() {
  setAccent('--c-image');
  const mode = state.mode.image || 'generate';
  const frag = document.createDocumentFragment();
  frag.appendChild(toolHead('image', '--c-image', 'Image Studio', 'Create, edit, upscale and cut out — then chain into video.'));
  frag.appendChild(el('div', { class: 'segmented' }, IMAGE_MODES.map(mm =>
    el('button', { class: 'seg' + (mode === mm.k ? ' active' : ''), html: `${icon(mm.icon, 15)} ${mm.label}`, onclick: () => { state.mode.image = mm.k; nav.refresh(); } })
  )));
  const scroll = el('div', { class: 'scroll' });
  const pad = el('div', { class: 'pad pad-b' });
  scroll.appendChild(pad);
  frag.appendChild(scroll);

  if (mode === 'generate') buildGenerate(pad);
  else if (mode === 'edit') buildEdit(pad);
  else if (mode === 'enhance') buildEnhance(pad);
  else buildBg(pad);
  return frag;
}

function resultsBlock(view) {
  const out = el('div', {});
  if (busy[view]) {
    const prog = busy[view] === true ? null : busy[view];
    out.appendChild(loadingCard(
      view === 'video' ? 'Rendering your video…' : view === 'audio' ? 'Composing audio…' : 'Generating…',
      view === 'video' || view === 'audio' ? 'This can take 1–3 minutes. Keep this screen open.' : 'Usually a few seconds.',
      typeof prog === 'number' ? prog : (view === 'video' || view === 'audio' ? 0.06 : null),
    ));
  }
  recent[view].forEach(a => out.appendChild(resultCard(a)));
  return out;
}

function buildGenerate(pad) {
  const id = selectedFor('image');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('image', 'No image models', 'Add a Venice API key to load image models.')); return; }
  const o = imageOpts(m);
  const f = F.imgGen;
  setAccent('--c-image');

  pad.appendChild(modelButton('image', '--c-image'));
  const form = el('div', { class: 'card' });
  form.appendChild(field('Prompt', textarea(f.prompt, 'Describe the image you want…', v => f.prompt = v, { maxlength: o.promptLimit || 7500 }), o.promptLimit ? `Up to ${o.promptLimit} characters` : null));

  // sizing — aspect_ratio (+resolution) if model uses them, else width/height presets
  const ratios = o.aspectRatios || WH_RATIOS;
  form.appendChild(field('Aspect ratio', chips(ratios, o.aspectRatios ? (ratios.includes(f.ratio) ? f.ratio : (o.defaultAspectRatio || ratios[0])) : f.ratio, v => { f.ratio = v; nav.refresh(); })));
  if (o.resolutions) {
    const rv = o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0]);
    form.appendChild(field('Resolution', chips(o.resolutions, rv, v => { f.resolution = v; nav.refresh(); })));
  }
  if (o.qualities) {
    const qv = o.qualities.includes(f.quality) ? f.quality : (o.defaultQuality || o.qualities[0]);
    form.appendChild(field('Quality', chips(o.qualities, qv, v => { f.quality = v; nav.refresh(); })));
  }
  if (o.steps) {
    const sv = f.steps ?? o.steps.default ?? 8;
    form.appendChild(field('Steps', slider(1, o.steps.max || 50, 1, Math.min(sv, o.steps.max || 50), v => { f.steps = v; updateVal(form, 'steps', v); }), null, String(Math.min(sv, o.steps.max || 50))));
    markVal(form, 'steps');
  }
  if (o.isDiffusion) {
    form.appendChild(field('Guidance (CFG)', slider(1, 20, 0.5, f.cfg, v => { f.cfg = v; updateVal(form, 'cfg', v.toFixed(1)); }), null, f.cfg.toFixed(1)));
    markVal(form, 'cfg');
    form.appendChild(field('Negative prompt', textarea(f.negative, 'What to avoid (optional)…', v => f.negative = v)));
  }
  pad.appendChild(form);

  // advanced (style, variants, seed, format)
  const adv = el('div', { class: 'card' });
  adv.appendChild(el('div', { class: 'panel-title', html: `${icon('sliders', 13)} Options` }));
  if (state.styles.length) {
    adv.appendChild(field('Style preset', select(['', ...state.styles], f.style, v => f.style = v, o2 => o2 || 'None')));
  }
  adv.appendChild(field('Variants', chips([1, 2, 3, 4], f.variants, v => { f.variants = v; nav.refresh(); }), 'Generate multiple options at once'));
  adv.appendChild(field('Output format', chips(['webp', 'png', 'jpeg'], f.format, v => { f.format = v; nav.refresh(); })));
  adv.appendChild(field('Seed', (() => { const i = el('input', { type: 'number', placeholder: 'Random', value: f.seed }); i.addEventListener('input', e => f.seed = e.target.value); return i; })(), 'Reuse a seed for reproducible results'));
  pad.appendChild(adv);

  pad.appendChild(resultsBlock('image'));

  const price = priceHint(m);
  pad.appendChild(generateBar(busy.image ? 'Generating…' : 'Generate image', 'zap', () => runJob('image', async () => {
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
  }), busy.image, price != null ? `~${fmtUSD(price)} per image · model decides exact cost` : null));
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

  pad.appendChild(modelButton('inpaint', '--c-image'));

  // images (1, or up to 3 if model supports combining)
  const maxImgs = o.combineImages ? 3 : 1;
  const imgCard = el('div', { class: 'card' });
  imgCard.appendChild(el('div', { class: 'panel-title', text: maxImgs > 1 ? `Images (up to ${maxImgs})` : 'Image' }));
  const strip = el('div', { class: 'thumb-strip' });
  f.images.forEach((u, i) => strip.appendChild(el('div', { class: 'mini' }, [el('img', { src: u }), el('button', { class: 'thumb-x', style: { width: '24px', height: '24px' }, html: icon('x', 13), onclick: () => { f.images.splice(i, 1); nav.refresh(); } })])));
  if (f.images.length < maxImgs) strip.appendChild(el('button', { class: 'mini', style: { display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-soft)' }, html: icon('plus', 22), onclick: async () => { const d = await pickImage(); if (d) { f.images.push(d); nav.refresh(); } } }));
  imgCard.appendChild(strip);
  if (maxImgs > 1) imgCard.appendChild(el('div', { class: 'hint', text: 'First image is the base; extra images guide the edit (compositing).' }));
  pad.appendChild(imgCard);

  const form = el('div', { class: 'card' });
  form.appendChild(field('Edit instructions', textarea(f.prompt, 'e.g. "change the sky to a sunrise", "add neon signs", "make it winter"…', v => f.prompt = v, { maxlength: o.promptLimit || 32768 })));
  if (o.aspectRatios) form.appendChild(field('Aspect ratio', chips(o.aspectRatios, o.aspectRatios.includes(f.ratio) ? f.ratio : 'auto', v => { f.ratio = v; nav.refresh(); }), o.singleImageAspectRatio ? null : 'Single-image edits keep the input size; ignored unless combining.'));
  if (o.resolutions) form.appendChild(field('Resolution', chips(o.resolutions, o.resolutions.includes(f.resolution) ? f.resolution : (o.defaultResolution || o.resolutions[0]), v => { f.resolution = v; nav.refresh(); })));
  if (o.qualities) form.appendChild(field('Quality', chips(o.qualities, o.qualities.includes(f.quality) ? f.quality : (o.defaultQuality || o.qualities[0]), v => { f.quality = v; nav.refresh(); })));
  form.appendChild(field('Output format', chips(['', 'png', 'jpeg', 'webp'], f.format, v => { f.format = v; nav.refresh(); }, x => x || 'Auto')));
  pad.appendChild(form);

  pad.appendChild(resultsBlock('image'));
  pad.appendChild(generateBar(busy.image ? 'Editing…' : 'Apply edit', 'wand', () => runJob('image', async () => {
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
  }), busy.image));
}

function buildEnhance(pad) {
  const h = takeHandoff(); if (h?.image) F.enhance.image = h.image;
  const f = F.enhance;
  pad.appendChild(el('div', { class: 'notice', html: `${icon('upscale', 14)} Upscale up to 4× and/or enhance detail with Venice's image engine. A scale of 1× runs the enhancer only.` }));
  pad.appendChild(imageSource(f.image, d => { f.image = d; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, 'Image to enhance'));

  const form = el('div', { class: 'card' });
  form.appendChild(field('Scale', chips([1, 2, 3, 4], f.scale, v => { f.scale = v; if (v === 1) f.enhance = true; nav.refresh(); }, x => x + '×'), f.scale === 1 ? 'At 1× the enhancer must be on.' : null));
  form.appendChild(switchRow('Enhance detail', f.enhance, v => { if (f.scale === 1 && !v) { toast('Enhance is required at 1×'); return; } f.enhance = v; nav.refresh(); }, 'AI re-detailing pass'));
  if (f.enhance) {
    form.appendChild(field('Creativity', slider(0, 1, 0.05, f.creativity, v => { f.creativity = v; updateVal(form, 'cr', v.toFixed(2)); }), 'Higher = more reinterpretation', f.creativity.toFixed(2)));
    markVal(form, 'cr');
    form.appendChild(field('Replication', slider(0, 1, 0.05, f.replication, v => { f.replication = v; updateVal(form, 'rp', v.toFixed(2)); }), 'Higher preserves original lines/noise', f.replication.toFixed(2)));
    markVal(form, 'rp');
    form.appendChild(field('Enhance style (optional)', (() => { const i = el('input', { type: 'text', placeholder: 'e.g. gold, marble, cinematic', value: f.prompt }); i.addEventListener('input', e => f.prompt = e.target.value); return i; })()));
  }
  pad.appendChild(form);

  pad.appendChild(resultsBlock('image'));
  pad.appendChild(generateBar(busy.image ? 'Enhancing…' : 'Enhance image', 'upscale', () => runJob('image', async () => {
    if (!f.image) throw new Error('Add an image first');
    const body = { image: f.image, scale: f.scale };
    if (f.enhance || f.scale === 1) { body.enhance = true; body.enhanceCreativity = f.creativity; if (f.prompt.trim()) body.enhancePrompt = f.prompt.trim(); }
    body.replication = f.replication;
    const res = await api.upscale(body);
    if (!res.data) throw new Error('No image returned');
    const a = addAsset({ kind: 'image', dataUrl: res.data, prompt: `Enhanced ${f.scale}×`, model: 'upscale', modelName: `Upscale ${f.scale}×`, ext: 'png' });
    recent.image.unshift(a);
    toast('Enhanced', 'ok');
  }), busy.image));
}

function buildBg(pad) {
  const h = takeHandoff(); if (h?.image) F.bg.image = h.image;
  const f = F.bg;
  pad.appendChild(el('div', { class: 'notice', html: `${icon('scissors', 14)} Remove the background and get a transparent PNG — perfect for stickers, products and overlays.` }));
  pad.appendChild(imageSource(f.image, d => { f.image = d; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, 'Image'));
  pad.appendChild(resultsBlock('image'));
  pad.appendChild(generateBar(busy.image ? 'Removing…' : 'Remove background', 'scissors', () => runJob('image', async () => {
    if (!f.image) throw new Error('Add an image first');
    const res = await api.bgRemove({ image: f.image });
    if (!res.data) throw new Error('No image returned');
    const a = addAsset({ kind: 'image', dataUrl: res.data, prompt: 'Background removed', model: 'bg-remove', modelName: 'Background remove', ext: 'png' });
    recent.image.unshift(a);
    toast('Background removed', 'ok');
  }), busy.image));
}

// ════════════════════════════ VIDEO ════════════════════════════
function viewVideo() {
  setAccent('--c-video');
  const frag = document.createDocumentFragment();
  frag.appendChild(toolHead('video', '--c-video', 'Video Studio', 'Generate cinematic clips from a prompt or bring a still to life.'));
  const scroll = el('div', { class: 'scroll' });
  const pad = el('div', { class: 'pad pad-b' });
  scroll.appendChild(pad); frag.appendChild(scroll);

  const id = selectedFor('video');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('video', 'No video models', 'Add a Venice API key to load video models.')); return frag; }
  const o = videoOpts(m);
  const f = F.video;
  const h = takeHandoff(); if (h?.image) { f.image = h.image; if (!o.allowsImage) { const i2v = modelsByType('video').find(x => videoOpts(x).allowsImage); if (i2v) { state.selected.video = i2v.id; return viewVideo(); } } }

  pad.appendChild(modelButton('video', '--c-video'));
  pad.appendChild(el('div', { class: 'notice', html: `${icon('film', 14)} <b>${o.modelType.replace(/-/g, ' ')}</b>${o.audio ? ' · audio supported' : ''} · prompts up to ${o.promptLimit} chars` }));

  if (o.allowsImage) {
    pad.appendChild(imageSource(f.image, d => { f.image = d; F.video.quote = null; nav.refresh(); }, () => { f.image = null; nav.refresh(); }, o.needsImage ? 'Source image (required)' : 'Source image (optional)'));
  }

  const form = el('div', { class: 'card' });
  form.appendChild(field('Prompt', textarea(f.prompt, o.needsImage ? 'Describe the motion and camera…' : 'Describe the scene, motion and style…', v => f.prompt = v, { maxlength: o.promptLimit })));
  const durVal = o.durations.includes(f.duration) ? f.duration : o.durations[0];
  form.appendChild(field('Duration', chips(o.durations, durVal, v => { f.duration = v; f.quote = null; nav.refresh(); })));
  if (o.aspectRatios) { const av = o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0]; form.appendChild(field('Aspect ratio', chips(o.aspectRatios, av, v => { f.ratio = v; f.quote = null; nav.refresh(); }))); }
  if (o.resolutions) { const rv = o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0]; form.appendChild(field('Resolution', chips(o.resolutions, rv, v => { f.resolution = v; f.quote = null; nav.refresh(); }))); }
  if (o.audioConfigurable) form.appendChild(switchRow('Generate audio', f.audio, v => { f.audio = v; nav.refresh(); }));
  form.appendChild(field('Negative prompt', textarea(f.negative, 'What to avoid (optional)…', v => f.negative = v)));
  pad.appendChild(form);

  pad.appendChild(resultsBlock('video'));

  // quote + generate
  const quoteRow = el('div', { class: 'inline-actions', style: { marginBottom: '10px' } }, [
    el('button', { class: 'btn sm', html: `${icon('info', 16)} Price quote`, onclick: async () => {
      try {
        const qb = { model: id, duration: durVal };
        if (o.aspectRatios) qb.aspect_ratio = o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0];
        if (o.resolutions) qb.resolution = o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0];
        if (o.audioConfigurable) qb.audio = f.audio;
        const q = await api.videoQuote(qb); f.quote = q.quote; nav.refresh();
      } catch (e) { toast(e.message, 'err'); }
    } }),
    f.quote != null ? el('div', { class: 'price-quote', style: { alignSelf: 'center' }, text: `Estimated: ${fmtUSD(f.quote)}` }) : null,
  ].filter(Boolean));
  pad.appendChild(quoteRow);

  pad.appendChild(generateBar(busy.video ? 'Rendering…' : 'Generate video', 'video', () => runJob('video', async () => {
    if (o.needsImage && !f.image) throw new Error('This model needs a source image');
    if (!f.prompt.trim()) throw new Error('Enter a prompt');
    const body = { model: id, prompt: f.prompt.trim(), duration: durVal };
    if (o.aspectRatios) body.aspect_ratio = o.aspectRatios.includes(f.ratio) ? f.ratio : o.aspectRatios[0];
    if (o.resolutions) body.resolution = o.resolutions.includes(f.resolution) ? f.resolution : o.resolutions[0];
    if (o.audioConfigurable) body.audio = !!f.audio;
    if (f.negative.trim()) body.negative_prompt = f.negative.trim();
    if (o.allowsImage && f.image) body.image_url = f.image;
    const q = await api.videoQueue(body);
    if (!q.queue_id) throw new Error('Could not queue video');
    const url = await pollJob('video', { model: id, queueId: q.queue_id, downloadUrl: q.download_url }, (p) => { busy.video = (p == null || p <= 0.02) ? true : p; nav.refresh(); });
    const a = addAsset({ kind: 'video', dataUrl: url, prompt: f.prompt.trim(), model: id, modelName: modelName(id), ext: 'mp4' });
    recent.video.unshift(a);
    toast('Video ready', 'ok');
  }), busy.video, priceHint(m) != null && f.quote == null ? `~${fmtUSD(priceHint(m))}/sec · tap “Price quote” for exact` : null));
  return frag;
}

// ════════════════════════════ AUDIO (music / speech / transcribe) ════════════════════════════
const AUDIO_MODES = [
  { k: 'music', label: 'Music', icon: 'music', type: 'music' },
  { k: 'speech', label: 'Speech', icon: 'volume', type: 'tts' },
  { k: 'transcribe', label: 'Transcribe', icon: 'mic', type: 'asr' },
];
function viewAudio() {
  setAccent('--c-music');
  const mode = state.mode.audio || 'music';
  const frag = document.createDocumentFragment();
  frag.appendChild(toolHead('music', mode === 'speech' ? '--c-voice' : mode === 'transcribe' ? '--c-voice' : '--c-music', 'Audio Studio', 'Compose music, synthesise voices, and transcribe speech.'));
  setAccent(mode === 'music' ? '--c-music' : '--c-voice');
  frag.appendChild(el('div', { class: 'segmented' }, AUDIO_MODES.map(mm =>
    el('button', { class: 'seg' + (mode === mm.k ? ' active' : ''), html: `${icon(mm.icon, 15)} ${mm.label}`, onclick: () => { state.mode.audio = mm.k; nav.refresh(); } })
  )));
  const scroll = el('div', { class: 'scroll' });
  const pad = el('div', { class: 'pad pad-b' });
  scroll.appendChild(pad); frag.appendChild(scroll);

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
  pad.appendChild(modelButton('music', '--c-music'));

  const form = el('div', { class: 'card' });
  form.appendChild(field('Prompt', textarea(f.prompt, 'Describe the music — genre, mood, instruments, tempo…', v => f.prompt = v, { maxlength: o.promptLimit || 2000 }), o.minPromptLength > 1 ? `At least ${o.minPromptLength} characters` : null));

  if (o.supportsForceInstrumental) form.appendChild(switchRow('Instrumental only', f.instrumental, v => { f.instrumental = v; nav.refresh(); }, 'No vocals'));
  if (o.supportsLyrics && !f.instrumental) {
    if (o.supportsLyricsOptimizer) form.appendChild(switchRow('Auto-write lyrics', f.optimizer, v => { f.optimizer = v; nav.refresh(); }, 'Generate lyrics from your prompt'));
    if (!f.optimizer) form.appendChild(field(o.lyricsRequired ? 'Lyrics (required)' : 'Lyrics (optional)', textarea(f.lyrics, 'Verse 1: …', v => f.lyrics = v, { maxlength: o.lyricsLimit || 5000 })));
  }
  if (o.voices) form.appendChild(field('Voice', select(o.voices, o.voices.includes(f.voice) ? f.voice : (o.defaultVoice || o.voices[0]), v => f.voice = v)));
  if (o.supportsLanguageCode) form.appendChild(field('Language code', (() => { const i = el('input', { type: 'text', placeholder: 'e.g. en, es, ja', value: f.lang }); i.addEventListener('input', e => f.lang = e.target.value); return i; })()));

  const durMeta = o.durationOptions || (o.minDuration && o.maxDuration);
  if (durMeta) {
    if (o.durationOptions) { const dv = o.durationOptions.includes(f.duration) ? f.duration : (o.defaultDuration || o.durationOptions[0]); form.appendChild(field('Duration', chips(o.durationOptions, dv, v => { f.duration = v; f.quote = null; nav.refresh(); }, x => x + 's'))); }
    else { const dv = f.duration ?? o.defaultDuration ?? o.minDuration; form.appendChild(field('Duration (sec)', slider(o.minDuration, o.maxDuration, 1, dv, v => { f.duration = v; updateVal(form, 'dur', v + 's'); }), null, dv + 's')); markVal(form, 'dur'); }
  }
  if (o.supportsSpeed) { const sv = f.speed ?? o.defaultSpeed; form.appendChild(field('Speed', slider(o.minSpeed, o.maxSpeed, 0.05, sv, v => { f.speed = v; updateVal(form, 'spd', v.toFixed(2) + '×'); }), null, sv.toFixed(2) + '×')); markVal(form, 'spd'); }
  pad.appendChild(form);

  pad.appendChild(resultsBlock('audio'));
  pad.appendChild(generateBar(busy.audio ? 'Composing…' : 'Generate music', 'music', () => runJob('audio', async () => {
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
  }), busy.audio));
}

function buildSpeech(pad) {
  setAccent('--c-voice');
  const id = selectedFor('tts');
  const m = findModel(id);
  if (!m) { pad.appendChild(emptyState('volume', 'No speech models', 'Add a Venice API key to load TTS models.')); return; }
  const o = ttsOpts(m);
  const f = F.speech;
  pad.appendChild(modelButton('tts', '--c-voice'));

  const form = el('div', { class: 'card' });
  form.appendChild(field('Text', textarea(f.text, 'Type what you want spoken…', v => f.text = v, { maxlength: 4096 }), 'Up to 4096 characters'));
  form.appendChild(field('Voice', select(o.voices, o.voices.includes(f.voice) ? f.voice : o.voices[0], v => f.voice = v)));
  form.appendChild(field('Format', chips(['mp3', 'opus', 'aac', 'flac', 'wav'], f.format, v => { f.format = v; nav.refresh(); })));
  form.appendChild(field('Speed', slider(0.25, 4, 0.05, f.speed, v => { f.speed = v; updateVal(form, 'sp', v.toFixed(2) + '×'); }), null, f.speed.toFixed(2) + '×')); markVal(form, 'sp');
  form.appendChild(field('Language (optional)', (() => { const i = el('input', { type: 'text', placeholder: 'e.g. en, English, ja', value: f.lang }); i.addEventListener('input', e => f.lang = e.target.value); return i; })()));
  if (o.supportsPrompt) form.appendChild(field('Style direction', (() => { const i = el('input', { type: 'text', placeholder: 'e.g. Very happy. Excited.', value: f.style }); i.addEventListener('input', e => f.style = e.target.value); return i; })()));
  if (o.supportsTemperature) { form.appendChild(field('Temperature', slider(0, 2, 0.05, f.temperature, v => { f.temperature = v; updateVal(form, 'tm', v.toFixed(2)); }), null, f.temperature.toFixed(2))); markVal(form, 'tm'); }
  pad.appendChild(form);

  pad.appendChild(resultsBlock('audio'));
  pad.appendChild(generateBar(busy.audio ? 'Synthesising…' : 'Generate speech', 'volume', () => runJob('audio', async () => {
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
  }), busy.audio));
}

function buildTranscribe(pad) {
  setAccent('--c-voice');
  const id = selectedFor('asr');
  const m = findModel(id);
  const f = F.transcribe;
  if (modelsByType('asr').length) pad.appendChild(modelButton('asr', '--c-voice'));
  pad.appendChild(el('div', { class: 'notice', html: `${icon('mic', 14)} Upload audio or a video file and get an accurate transcript.` }));

  const srcCard = el('div', { class: 'card' });
  srcCard.appendChild(el('div', { class: 'panel-title', text: 'Audio file' }));
  if (f.audio) srcCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [el('span', { style: { color: 'var(--accent)' }, html: icon('volume', 20) }), el('div', { style: { flex: '1', fontSize: '13px' }, text: f.filename || 'audio file' }), el('button', { class: 'act', html: icon('x', 14), onclick: () => { f.audio = null; f.filename = ''; nav.refresh(); } })]));
  else srcCard.appendChild(el('button', { class: 'source', style: { width: '100%' }, onclick: () => {
    const inp = document.getElementById('fileAudio'); inp.value = '';
    inp.onchange = async () => { const file = inp.files?.[0]; if (!file) return; f.filename = file.name; f.audio = await fileToDataURL(file); nav.refresh(); };
    inp.click();
  } }, [el('span', { style: { color: 'var(--accent)' }, html: icon('upload', 26) }), el('div', { text: 'Tap to choose an audio or video file' })]));
  pad.appendChild(srcCard);

  if (f.text) pad.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'panel-title', html: `${icon('type', 13)} Transcript` }),
    el('div', { style: { fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: 'var(--text)' }, text: f.text }),
    el('div', { class: 'result-actions' }, [
      el('button', { class: 'act', html: `${icon('copy', 14)} Copy`, onclick: () => { navigator.clipboard?.writeText(f.text); toast('Copied', 'ok'); } }),
      el('button', { class: 'act', html: `${icon('chat', 14)} Send to chat`, onclick: () => { newChat(); chat.messages.push({ role: 'user', content: f.text, display: f.text }); nav.goTo('chat'); runChat(); } }),
    ]),
  ]));

  pad.appendChild(generateBar(busy.audio ? 'Transcribing…' : 'Transcribe', 'mic', () => runJob('audio', async () => {
    if (!f.audio) throw new Error('Choose an audio file');
    const body = { audio: f.audio, filename: f.filename || 'audio.mp3', response_format: 'json' };
    if (id) body.model = id;
    if (f.language?.trim()) body.language = f.language.trim();
    const res = await api.transcribe(body);
    f.text = res.text || res || ''; if (typeof f.text !== 'string') f.text = JSON.stringify(f.text);
    toast('Transcribed', 'ok');
  }), busy.audio));
}

// ════════════════════════════ LIBRARY ════════════════════════════
function viewLibrary() {
  setAccent('--c-library');
  const frag = document.createDocumentFragment();
  frag.appendChild(toolHead('library', '--c-library', 'Library', 'Every creation lives here. Tap any image to remix it.'));
  const scroll = el('div', { class: 'scroll' });
  const pad = el('div', { class: 'pad pad-b' });
  scroll.appendChild(pad); frag.appendChild(scroll);

  const assets = listAssets();
  if (!assets.length) { pad.appendChild(emptyState('layers', 'Nothing here yet', 'Generate an image, video or track and it will appear here — ready to download or chain into another tool.')); return frag; }

  const grid = el('div', { class: 'gallery' });
  assets.forEach(a => {
    const item = el('button', { class: 'g-item', onclick: () => openAsset(a) });
    if (a.kind === 'image') item.appendChild(el('img', { src: a.dataUrl, loading: 'lazy' }));
    else if (a.kind === 'video') { item.appendChild(el('video', { src: a.dataUrl, muted: 'true', style: { width: '100%', height: '100%', objectFit: 'cover' } })); item.appendChild(el('div', { class: 'g-av', html: icon('play', 38) })); }
    else item.appendChild(el('div', { class: 'g-av', html: icon('music', 38) }));
    item.appendChild(el('span', { class: 'g-badge', text: a.kind }));
    grid.appendChild(item);
  });
  pad.appendChild(grid);
  return frag;
}
function openAsset(a) {
  const body = el('div', {}, [resultCard(a), el('button', { class: 'btn full ghost', style: { marginTop: '6px', color: '#ff6b6b' }, html: `${icon('trash', 18)} Delete`, onclick: () => { removeAsset(a.id); recent.image = recent.image.filter(x => x.id !== a.id); recent.video = recent.video.filter(x => x.id !== a.id); recent.audio = recent.audio.filter(x => x.id !== a.id); nav.closeSheet(); nav.refresh(); } })]);
  nav.openSheet('Asset', body);
}

// helpers to update a slider's value label without full re-render
function markVal(form, key) { const f = form.querySelector('.field:last-child .val'); if (f) f.dataset.k = key; }
function updateVal(form, key, text) { const node = Array.from(form.querySelectorAll('.val')).find(n => n.dataset.k === key); if (node) node.textContent = text; }

// header pill context for the current tool/mode
export function currentModelContext() {
  if (state.tool === 'chat') return { type: 'text', show: true };
  if (state.tool === 'image') { const mo = state.mode.image; return mo === 'generate' ? { type: 'image', show: true } : mo === 'edit' ? { type: 'inpaint', show: true } : { type: null, show: false }; }
  if (state.tool === 'video') return { type: 'video', show: true };
  if (state.tool === 'audio') { const mo = state.mode.audio; return { type: mo === 'music' ? 'music' : mo === 'speech' ? 'tts' : 'asr', show: true }; }
  return { type: null, show: false };
}

export const views = { chat: viewChat, image: viewImage, video: viewVideo, audio: viewAudio, library: viewLibrary };
