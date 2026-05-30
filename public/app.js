// ═══════════════════════════════════════════════════════════════════════════
// vGPT app — DIAL faceplate chrome: mode-wheel home, plate header, router,
// cartridge model picker, service panel (settings), free-trial unlock, and
// bootstrap. Wires the shared `nav`/`gate` hooks used by tools.js + core.js.
// The wiring (goTo, NAV, model selection, settings, trial) is unchanged — only
// the markup/interaction is the hardware instrument.
// ═══════════════════════════════════════════════════════════════════════════
import {
  $, el, icon, clear, toast,
  state, loadState, saveState, api,
  modelsByType, findModel, modelName, modelLabel, selectedFor, priceHint,
  openSheet, closeSheet, nav, gate,
  initAssets, onAssets, listAssets, clearAssets,
  FREE_LIMIT, REF_LINK, usingSharedKey, freeLeft, setKey,
} from './core.js';
import { views, newChat } from './tools.js';

const NAV = [
  { k: 'chat', label: 'Chat', icon: 'chat' },
  { k: 'image', label: 'Image', icon: 'image' },
  { k: 'video', label: 'Video', icon: 'video' },
  { k: 'audio', label: 'Audio', icon: 'music' },
  { k: 'library', label: 'Library', icon: 'cassette' },
];

// ── render ──────────────────────────────────────────────────────────────────
let renderedTool = '';
let scrollRestoreFrame = 0;
function render() {
  const tool = state.tool;
  const previousScroll = $('#main .scroll');
  const sameTool = renderedTool === tool;
  const scrollTop = sameTool && previousScroll ? previousScroll.scrollTop : 0;
  const followBottom = sameTool && previousScroll ? previousScroll.scrollHeight - previousScroll.scrollTop - previousScroll.clientHeight < 56 : false;

  renderStat();
  renderPlate();

  const main = clear($('#main'));
  const section = el('section', { class: 'view active' });
  try {
    if (tool === 'home') section.appendChild(renderHome());
    else section.appendChild(views[tool]());
  } catch (e) {
    console.error(e);
    section.appendChild(el('div', { class: 'pad' }, el('div', { class: 'notice', text: 'Something went wrong rendering this screen.' })));
  }
  main.appendChild(section);
  renderedTool = tool;

  // preserve reading position across streamed/polled re-renders
  const nextScroll = $('#main .scroll');
  if (sameTool && nextScroll) {
    const restore = () => { nextScroll.scrollTop = followBottom ? nextScroll.scrollHeight : scrollTop; };
    restore();
    cancelAnimationFrame(scrollRestoreFrame);
    scrollRestoreFrame = requestAnimationFrame(restore);
  }
}

// status bar (decorative + live clock + free-trial meter)
function renderStat() {
  const bar = clear($('#statBar'));
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  bar.appendChild(el('span', { text: `${hh}:${mm}` }));
  bar.appendChild(el('span', { class: 'r' }, [
    usingSharedKey() ? el('span', { style: { color: 'var(--led)' }, text: `◴ ${freeLeft()} FREE` }) : el('span', { text: '∞' }),
    el('span', { text: '▮▮▮▯' }),
  ]));
}

// plate header: logo (→home), screenprint, power LED, settings screw, decorative screws
function renderPlate() {
  const plate = clear($('#plate'));
  plate.appendChild(el('div', {}, [
    el('button', { class: 'logo', html: 'v<span>GPT</span>', onclick: () => goTo('home'), title: 'Mode wheel' }),
    el('div', { class: 'screen-print', text: 'venice instrument' }),
  ]));
  plate.appendChild(el('div', { class: 'pwr' }, [el('span', { class: 'led' }), 'PWR']));
  plate.appendChild(el('button', { class: 'util', html: icon('settings', 17), title: 'Service panel', onclick: openSettings }));
  plate.appendChild(el('div', { class: 'scr-row' }, [el('span', { class: 'screw' }), el('span', { class: 'screw' })]));
}

// ── home: mode wheel ──────────────────────────────────────────────────────────
let wheelIndex = 0;
function renderHome() {
  // start the pointer on the last tool used (if any)
  const lastIdx = NAV.findIndex(n => n.k === state._lastTool);
  if (lastIdx >= 0) wheelIndex = lastIdx;

  const frag = document.createDocumentFragment();

  const lcd = el('div', { class: 'lcd' }, [
    el('div', { class: 'ltop' }, [el('span', { text: 'MODE SELECT' }), el('span', { class: usingSharedKey() ? 'armed' : '', text: usingSharedKey() ? `◴ ${freeLeft()} FREE` : '∞ KEY' })]),
    el('div', { class: 'big', id: 'wheelBig', text: NAV[wheelIndex].label.toUpperCase() }),
    el('div', { class: 'sub', text: 'turn wheel · press to enter' }),
  ]);
  frag.appendChild(lcd);

  const wrap = el('div', { class: 'wheelwrap' });
  const modes = el('div', { class: 'modes' });

  // labels around a 300px ring
  const R = 124, cx = 150, cy = 150;
  const labelEls = NAV.map((n, i) => {
    const theta = (-90 + i * 72) * Math.PI / 180;
    const x = cx + R * Math.cos(theta);
    const y = cy + R * Math.sin(theta);
    const lab = el('button', {
      class: 'ml' + (i === wheelIndex ? ' on' : ''),
      style: { left: x + 'px', top: y + 'px', transform: 'translate(-50%,-50%)' },
      html: `<i class="mi">${icon(n.icon, 18)}</i>${n.label}`,
      onclick: () => { i === wheelIndex ? enter() : select(i); },
    });
    return lab;
  });
  labelEls.forEach(l => modes.appendChild(l));

  const ptr = el('div', { class: 'ptr' });
  const hubIcon = el('i', { class: 'ic', html: icon(NAV[wheelIndex].icon, 26) });
  const hub = el('div', { class: 'hub' }, [hubIcon, el('div', { class: 'hl', text: 'ENTER' })]);
  const wheel = el('div', { class: 'wheel' }, [ptr, hub]);
  modes.appendChild(wheel);

  const setPointer = () => { ptr.style.transform = `translateX(-50%) rotate(${wheelIndex * 72}deg)`; ptr.style.transformOrigin = '50% 79px'; };
  setPointer();

  function select(i) {
    wheelIndex = ((i % NAV.length) + NAV.length) % NAV.length;
    labelEls.forEach((l, idx) => l.classList.toggle('on', idx === wheelIndex));
    hubIcon.innerHTML = icon(NAV[wheelIndex].icon, 26);
    $('#wheelBig').textContent = NAV[wheelIndex].label.toUpperCase();
    setPointer();
  }
  function enter() { goTo(NAV[wheelIndex].k); }
  hub.addEventListener('click', enter);

  // drag the wheel to rotate the pointer toward the nearest mode
  let dragging = false;
  const pick = (clientX, clientY) => {
    const r = wheel.getBoundingClientRect();
    const ang = Math.atan2(clientY - (r.top + r.height / 2), clientX - (r.left + r.width / 2)) * 180 / Math.PI; // -180..180, 0 = east
    // mode i sits at (-90 + i*72) degrees
    let best = 0, bestD = 999;
    NAV.forEach((_, i) => {
      const t = -90 + i * 72;
      let d = Math.abs(((ang - t + 540) % 360) - 180);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== wheelIndex) select(best);
  };
  wheel.addEventListener('pointerdown', e => { dragging = true; wheel.setPointerCapture?.(e.pointerId); });
  wheel.addEventListener('pointermove', e => { if (dragging) pick(e.clientX, e.clientY); });
  const endDrag = () => { dragging = false; };
  wheel.addEventListener('pointerup', endDrag);
  wheel.addEventListener('pointercancel', endDrag);

  wrap.appendChild(modes);
  wrap.appendChild(el('div', { class: 'hint', text: '◀ FIVE TOOLS · ONE DIAL ▶' }));
  frag.appendChild(wrap);
  return frag;
}

function goTo(tool, opts = {}) {
  if (tool !== 'home') state._lastTool = tool;
  state.tool = tool;
  if (opts.mode && state.mode[tool] !== undefined) state.mode[tool] = opts.mode;
  if (tool === 'image' && opts.mode) state.mode.image = opts.mode;
  if (opts.handoff) state.handoff = opts.handoff;
  saveState();
  render();
}

// ── cartridge model picker ────────────────────────────────────────────────────
function modelBadges(m) {
  const out = [];
  (m.model_spec?.traits || []).slice(0, 2).forEach(t => out.push({ t, hot: /default|fastest|most/i.test(t) }));
  const c = m.model_spec?.capabilities || {};
  if (c.supportsVision) out.push({ t: 'vision' });
  if (c.supportsReasoning) out.push({ t: 'reasoning' });
  if (c.supportsWebSearch) out.push({ t: 'web' });
  if (c.optimizedForCode) out.push({ t: 'code' });
  const con = m.model_spec?.constraints || {};
  if (con.model_type) out.push({ t: String(con.model_type).replace(/-/g, '→') });
  if (Array.isArray(con.durations) && con.durations.length) out.push({ t: con.durations.slice(0, 3).join('/') });
  if (m.type === 'music' && m.model_spec?.supports_lyrics) out.push({ t: 'lyrics' });
  if (m.type === 'tts' && Array.isArray(m.model_spec?.voices)) out.push({ t: `${m.model_spec.voices.length} voices` });
  const p = priceHint(m);
  if (p != null) out.push({ t: '$' + (p < 0.01 ? p.toFixed(4) : p.toFixed(2)) });
  return out.slice(0, 5);
}
function openModelPicker(type) {
  const list = modelsByType(type);
  const current = selectedFor(type);
  const body = el('div', {});
  if (!list.length) { body.appendChild(el('div', { class: 'notice', text: 'No models of this type are available with the current key.' })); openSheet('Cartridge rack', body); return; }

  body.appendChild(el('div', { class: 'hint', text: `Insert a cartridge — ${list.length} loaded for this slot.` }));
  const search = el('input', { type: 'search', class: 'search-input', placeholder: `Search ${list.length} cartridges…` });
  const listEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const draw = (q = '') => {
    clear(listEl);
    const ql = q.toLowerCase();
    list.filter(m => !ql || modelLabel(m).toLowerCase().includes(ql) || m.id.toLowerCase().includes(ql) || (m.model_spec?.description || '').toLowerCase().includes(ql))
      .forEach(m => {
        const sel = m.id === current;
        listEl.appendChild(el('button', { class: 'model-item' + (sel ? ' sel' : ''), onclick: () => { state.selected[type] = m.id; saveState(); closeSheet(); toast(`Loaded ${modelLabel(m)}`, 'ok'); render(); } }, [
          el('div', { class: 'mi-body' }, [
            el('div', { class: 'mi-name', text: modelLabel(m) }),
            el('div', { class: 'mi-id', text: m.id }),
            m.model_spec?.description ? el('div', { class: 'mi-desc', text: m.model_spec.description }) : null,
            el('div', { class: 'model-badges' }, modelBadges(m).map(b => el('span', { class: 'tag' + (b.hot ? ' hot' : ''), text: b.t }))),
          ]),
          sel ? el('span', { style: { color: 'var(--accent)' }, html: icon('check', 18) }) : null,
        ]));
      });
    if (!listEl.children.length) listEl.appendChild(el('div', { class: 'notice', text: 'No matches.' }));
  };
  search.addEventListener('input', e => draw(e.target.value));
  draw();
  body.appendChild(search); body.appendChild(listEl);
  openSheet('Cartridge rack', body);
}

// ── service panel (settings) ──────────────────────────────────────────────────
function openSettings() {
  const body = el('div', {});

  const keyInput = el('input', { type: 'text', placeholder: 'Paste your Venice API key…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  keyInput.value = state.key || '';
  body.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'panel-title', html: `${icon('key', 13)} Your Venice API key` }),
    keyInput,
    el('div', { class: 'hint', text: 'Stored only on this device and sent directly to Venice. Use a key you generated, or one shared with you.' }),
    el('div', { class: 'inline-actions', style: { marginTop: '12px' } }, [
      el('button', { class: 'btn primary', style: { flex: '1' }, html: `${icon('check', 18)} Save key`, onclick: () => { setKey(keyInput.value); toast(state.key ? 'Key saved — unlimited access' : 'Key cleared'); render(); closeSheet(); } }),
      state.key ? el('button', { class: 'btn', html: icon('trash', 18), title: 'Remove key', onclick: () => { setKey(''); keyInput.value = ''; toast('Key removed'); render(); } }) : null,
    ].filter(Boolean)),
  ]));

  if (usingSharedKey()) {
    body.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', html: `${icon('zap', 13)} Free trial` }),
      el('div', { style: { fontSize: '14px' }, html: `<b>${freeLeft()}</b> of ${FREE_LIMIT} free queries remaining on the shared key.` }),
      el('div', { class: 'hint', text: 'Add your own key above for unlimited access with your own credits.' }),
      el('a', { class: 'btn full', style: { marginTop: '12px' }, href: REF_LINK, target: '_blank', rel: 'noopener', html: `${icon('key', 18)} Get your own Venice key` }),
    ]));
  } else if (state.key) {
    body.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', html: `${icon('cpu', 13)} Account` }),
      el('div', { id: 'balLine', style: { fontSize: '14px' }, text: 'Using your own key — unlimited access.' }),
      el('button', { class: 'btn full', style: { marginTop: '12px' }, html: `${icon('refresh', 18)} Check balance`, onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const b = await api.balance(); const usd = b?.balances?.usd, diem = b?.balances?.diem; $('#balLine').textContent = `Balance — ${usd != null ? '$' + usd.toFixed(2) : ''}${usd != null && diem != null ? ' · ' : ''}${diem != null ? diem.toFixed(1) + ' DIEM' : ''}` || 'Balance unavailable'; }
        catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
      } }),
    ]));
  }

  body.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'panel-title', html: `${icon('layers', 13)} Data` }),
    el('div', { class: 'inline-actions' }, [
      el('button', { class: 'btn', style: { flex: '1' }, html: `${icon('chat', 16)} New chat`, onclick: () => { newChat(); toast('Chat cleared'); closeSheet(); goTo('chat'); } }),
      el('button', { class: 'btn', style: { flex: '1' }, html: `${icon('trash', 16)} Clear library`, onclick: () => { clearAssets(); toast('Library cleared'); render(); } }),
    ]),
  ]));

  body.appendChild(el('div', { class: 'notice', html: `vGPT · Venice instrument powered by <a href="https://venice.ai" target="_blank" rel="noopener">Venice AI</a>. Private by design — your media stays on your device.` }));
  openSheet('Service panel', body);
}

// ── free-trial unlock sheet ────────────────────────────────────────────────────
function openUnlock(reason) {
  const body = el('div', {});
  const limit = reason === 'limit';
  body.appendChild(el('div', { class: 'center-col', style: { textAlign: 'center', marginBottom: '8px' } }, [
    el('div', { class: 'orb', html: icon('key', 32) }),
    el('h2', { style: { fontFamily: 'var(--sans)', fontWeight: '800', fontSize: '20px', marginTop: '14px' }, text: limit ? 'You’ve used your free queries' : 'Add a Venice API key' }),
    el('p', { class: 'muted', style: { fontSize: '14px', marginTop: '6px', maxWidth: '340px' }, text: limit ? `You’ve reached the ${FREE_LIMIT}-query free trial. Paste a Venice API key to keep creating — it’s unlimited and uses your own credits.` : 'This app needs a Venice API key. Paste one below to get started.' }),
  ]));

  const keyInput = el('input', { type: 'text', placeholder: 'Paste your Venice API key…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: { marginTop: '14px' } });
  const save = () => { if (!keyInput.value.trim()) { toast('Paste a key first', 'err'); return; } setKey(keyInput.value); toast('Key saved — unlimited access', 'ok'); closeSheet(); render(); };
  keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  body.appendChild(keyInput);
  body.appendChild(el('button', { class: 'btn primary full', style: { marginTop: '12px' }, html: `${icon('check', 18)} Save key & continue`, onclick: save }));

  body.appendChild(el('div', { class: 'divider' }));
  body.appendChild(el('div', { style: { textAlign: 'center', fontSize: '13px', color: 'var(--ink-2)', marginBottom: '10px' }, text: 'Don’t have a key yet?' }));
  body.appendChild(el('a', { class: 'btn full', href: REF_LINK, target: '_blank', rel: 'noopener', html: `${icon('key', 18)} Get your own Venice key — free` }));
  body.appendChild(el('div', { class: 'hint', style: { textAlign: 'center', marginTop: '10px' }, text: 'A key shared with you by anyone works too — just paste it above.' }));
  openSheet(limit ? 'Keep creating' : 'Welcome to vGPT', body);
}

// ── bootstrap ──────────────────────────────────────────────────────────────────
async function boot() {
  loadState();

  $('#sheetClose').innerHTML = icon('x', 22);
  $('#sheetClose').onclick = closeSheet;
  $('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });

  // shared hooks used by tools.js / core.js
  nav.goTo = goTo;
  nav.refresh = render;
  nav.openModelPicker = openModelPicker;
  nav.openSheet = openSheet;
  nav.closeSheet = closeSheet;
  nav.openSettings = openSettings;
  gate.onExceeded = openUnlock;

  // live clock in the status bar
  setInterval(renderStat, 30000);

  render();

  initAssets().then(() => { onAssets(() => { if (state.tool === 'library') render(); }); });

  try { state.config = await api.config(); } catch {}
  try {
    const res = await api.models('all');
    state.models = Array.isArray(res?.data) ? res.data : [];
    state.ready = true;
    render();
    if (!state.models.length) toast('No models returned — check your API key', 'err');
  } catch (e) {
    if (e.status === 401 || /key/i.test(e.message)) {
      if (!state.config.sharedKey && !state.key) openUnlock('nokey');
      else toast('Could not load models: ' + e.message, 'err');
    } else {
      toast('Could not load models: ' + e.message, 'err');
    }
  }

  try { const s = await api.styles(); state.styles = Array.isArray(s?.data) ? s.data : []; if (state.tool === 'image') render(); } catch {}

  if (!state.config.sharedKey && !state.key) openUnlock('nokey');
}

boot();
