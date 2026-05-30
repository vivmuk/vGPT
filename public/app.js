// ═══════════════════════════════════════════════════════════════════════════
// vGPT app — navigation, router, model picker, settings, free-trial unlock,
// and bootstrap. Wires the shared `nav`/`gate` hooks used by tools.js + core.js.
// ═══════════════════════════════════════════════════════════════════════════
import {
  $, el, icon, clear, toast,
  state, loadState, saveState, api,
  modelsByType, findModel, modelName, modelLabel, selectedFor, priceHint, textCaps,
  openSheet, closeSheet, nav, gate,
  initAssets, onAssets, listAssets, clearAssets,
  FREE_LIMIT, REF_LINK, usingSharedKey, freeLeft, setKey,
} from './core.js';
import { views, currentModelContext, newChat } from './tools.js';

const NAV = [
  { k: 'chat', label: 'Chat', icon: 'chat', accent: '--c-chat' },
  { k: 'image', label: 'Image', icon: 'image', accent: '--c-image' },
  { k: 'video', label: 'Video', icon: 'video', accent: '--c-video' },
  { k: 'audio', label: 'Audio', icon: 'music', accent: '--c-music' },
  { k: 'library', label: 'Library', icon: 'library', accent: '--c-library' },
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
  const navMeta = NAV.find(n => n.k === tool) || NAV[0];
  document.documentElement.style.setProperty('--nav-accent', `var(${navMeta.accent})`);

  // main view
  const main = clear($('#main'));
  const section = el('section', { class: 'view active' });
  try { section.appendChild(views[tool]()); }
  catch (e) { console.error(e); section.appendChild(el('div', { class: 'pad' }, el('div', { class: 'notice', text: 'Something went wrong rendering this tool.' }))); }
  main.appendChild(section);
  renderedTool = tool;

  // Progress polling and streamed tokens rebuild the view. Preserve the user's
  // reading position unless they were already following the newest content.
  const nextScroll = $('#main .scroll');
  if (sameTool && nextScroll) {
    const restore = () => { nextScroll.scrollTop = followBottom ? nextScroll.scrollHeight : scrollTop; };
    restore();
    cancelAnimationFrame(scrollRestoreFrame);
    scrollRestoreFrame = requestAnimationFrame(restore);
  }

  renderNav();
  renderHeader();
}
function renderNav() {
  const navEl = clear($('#nav'));
  NAV.forEach(n => {
    navEl.appendChild(el('button', {
      class: state.tool === n.k ? 'active' : '',
      style: { '--nav-accent': `var(${n.accent})` },
      html: `${icon(n.icon, 22)}<span>${n.label}</span>`,
      onclick: () => goTo(n.k),
    }));
  });
}
function renderHeader() {
  const ctx = currentModelContext();
  const pill = $('#modelPill');
  const txt = $('#modelPillText');
  if (ctx.show && ctx.type) {
    pill.style.display = '';
    const id = selectedFor(ctx.type);
    txt.textContent = id ? modelName(id) : 'Select model';
    pill.onclick = () => openModelPicker(ctx.type);
  } else {
    pill.style.display = 'none';
  }
  // free-trial chip
  let chip = $('#freeChip');
  if (usingSharedKey()) {
    if (!chip) { chip = el('button', { id: 'freeChip', class: 'header-pill', style: { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } }); $('#settingsBtn').before(chip); }
    chip.innerHTML = `${icon('zap', 14)} <span>${freeLeft()} free</span>`;
    chip.onclick = () => openUnlock('limit');
  } else if (chip) { chip.remove(); }
}

function goTo(tool, opts = {}) {
  state.tool = tool;
  if (opts.mode && state.mode[tool] !== undefined) state.mode[tool] = opts.mode;
  if (tool === 'image' && opts.mode) state.mode.image = opts.mode;
  if (opts.handoff) state.handoff = opts.handoff;
  saveState();
  render();
}

// ── model picker ──────────────────────────────────────────────────────────────
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
  if (!list.length) { body.appendChild(el('div', { class: 'notice', text: 'No models of this type are available with the current key.' })); openSheet('Select model', body); return; }

  const search = el('input', { type: 'text', class: 'search-input', placeholder: `Search ${list.length} models…` });
  const listEl = el('div', {});
  const draw = (q = '') => {
    clear(listEl);
    const ql = q.toLowerCase();
    list.filter(m => !ql || modelLabel(m).toLowerCase().includes(ql) || m.id.toLowerCase().includes(ql) || (m.model_spec?.description || '').toLowerCase().includes(ql))
      .forEach(m => {
        const sel = m.id === current;
        listEl.appendChild(el('button', { class: 'model-item' + (sel ? ' sel' : ''), onclick: () => { state.selected[type] = m.id; saveState(); closeSheet(); render(); } }, [
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
  openSheet('Select model', body);
}

// ── settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  const body = el('div', {});

  // API key
  const keyInput = el('input', { type: 'text', placeholder: 'Paste your Venice API key…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  keyInput.value = state.key || '';
  const keyCard = el('div', { class: 'card' }, [
    el('div', { class: 'panel-title', html: `${icon('key', 13)} Your Venice API key` }),
    keyInput,
    el('div', { class: 'hint', text: 'Stored only on this device and sent directly to Venice. Use a key you generated, or one shared with you.' }),
    el('div', { class: 'inline-actions', style: { marginTop: '12px' } }, [
      el('button', { class: 'btn primary', style: { flex: '1' }, html: `${icon('check', 18)} Save key`, onclick: () => { setKey(keyInput.value); toast(state.key ? 'Key saved — unlimited access' : 'Key cleared'); render(); closeSheet(); } }),
      state.key ? el('button', { class: 'btn', html: icon('trash', 18), title: 'Remove key', onclick: () => { setKey(''); keyInput.value = ''; toast('Key removed'); render(); } }) : null,
    ].filter(Boolean)),
  ]);
  body.appendChild(keyCard);

  // free trial status
  if (usingSharedKey()) {
    body.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', html: `${icon('zap', 13)} Free trial` }),
      el('div', { style: { fontSize: '14px' }, html: `<b>${freeLeft()}</b> of ${FREE_LIMIT} free queries remaining on the shared key.` }),
      el('div', { class: 'hint', text: 'Add your own key above for unlimited access with your own credits.' }),
      el('a', { class: 'btn full', style: { marginTop: '12px' }, href: REF_LINK, target: '_blank', rel: 'noopener', html: `${icon('key', 18)} Get your own Venice key` }),
    ]));
  } else if (state.key) {
    const balCard = el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', html: `${icon('cpu', 13)} Account` }),
      el('div', { id: 'balLine', style: { fontSize: '14px' }, text: 'Using your own key — unlimited access.' }),
      el('button', { class: 'btn full', style: { marginTop: '12px' }, html: `${icon('refresh', 18)} Check balance`, onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const b = await api.balance(); const usd = b?.balances?.usd, diem = b?.balances?.diem; $('#balLine').textContent = `Balance — ${usd != null ? '$' + usd.toFixed(2) : ''}${usd != null && diem != null ? ' · ' : ''}${diem != null ? diem.toFixed(1) + ' DIEM' : ''}` || 'Balance unavailable'; }
        catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
      } }),
    ]);
    body.appendChild(balCard);
  }

  // data
  body.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'panel-title', html: `${icon('layers', 13)} Data` }),
    el('div', { class: 'inline-actions' }, [
      el('button', { class: 'btn', style: { flex: '1' }, html: `${icon('chat', 16)} New chat`, onclick: () => { newChat(); toast('Chat cleared'); closeSheet(); goTo('chat'); } }),
      el('button', { class: 'btn', style: { flex: '1' }, html: `${icon('trash', 16)} Clear library`, onclick: () => { clearAssets(); toast('Library cleared'); render(); } }),
    ]),
  ]));

  body.appendChild(el('div', { class: 'notice', style: { marginTop: '4px' }, html: `vGPT · multimodal super app powered by <a href="https://venice.ai" target="_blank" rel="noopener">Venice AI</a>. Private by design — your media stays on your device.` }));
  openSheet('Settings', body);
}

// ── free-trial unlock sheet ────────────────────────────────────────────────────
function openUnlock(reason) {
  const body = el('div', {});
  const limit = reason === 'limit';
  body.appendChild(el('div', { class: 'center-col', style: { textAlign: 'center', marginBottom: '8px' } }, [
    el('div', { class: 'orb', style: { width: '76px', height: '76px' }, html: icon('key', 32) }),
    el('h2', { style: { fontFamily: 'var(--font-display)', fontSize: '20px', marginTop: '14px' }, text: limit ? 'You’ve used your free queries' : 'Add a Venice API key' }),
    el('p', { class: 'muted', style: { fontSize: '14px', marginTop: '6px', maxWidth: '340px' }, text: limit ? `You’ve reached the ${FREE_LIMIT}-query free trial. Paste a Venice API key to keep creating — it’s unlimited and uses your own credits.` : 'This app needs a Venice API key. Paste one below to get started.' }),
  ]));

  const keyInput = el('input', { type: 'text', placeholder: 'Paste your Venice API key…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: { marginTop: '14px' } });
  const save = () => { if (!keyInput.value.trim()) { toast('Paste a key first', 'err'); return; } setKey(keyInput.value); toast('Key saved — unlimited access', 'ok'); closeSheet(); render(); };
  keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  body.appendChild(keyInput);
  body.appendChild(el('button', { class: 'btn primary full', style: { marginTop: '12px' }, html: `${icon('check', 18)} Save key & continue`, onclick: save }));

  body.appendChild(el('div', { class: 'divider' }));
  body.appendChild(el('div', { style: { textAlign: 'center', fontSize: '13px', color: 'var(--text-3)', marginBottom: '10px' }, text: 'Don’t have a key yet?' }));
  body.appendChild(el('a', { class: 'btn full', href: REF_LINK, target: '_blank', rel: 'noopener', html: `${icon('key', 18)} Get your own Venice key — free` }));
  body.appendChild(el('div', { class: 'hint', style: { textAlign: 'center', marginTop: '10px' }, text: 'A key shared with you by anyone works too — just paste it above.' }));
  openSheet(limit ? 'Keep creating' : 'Welcome to vGPT', body);
}

// ── bootstrap ──────────────────────────────────────────────────────────────────
async function boot() {
  loadState();

  // header / chrome icons
  $('#brandMark').innerHTML = icon('sparkles', 16);
  $('#settingsBtn').innerHTML = icon('settings', 20);
  $('#sheetClose').innerHTML = icon('x', 22);
  $('#settingsBtn').onclick = openSettings;
  $('.brand').onclick = () => goTo('chat');
  $('#sheetClose').onclick = closeSheet;
  $('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });

  // wire shared hooks used by tools.js / core.js
  nav.goTo = goTo;
  nav.refresh = render;
  nav.openModelPicker = openModelPicker;
  nav.openSheet = openSheet;
  nav.closeSheet = closeSheet;
  gate.onExceeded = openUnlock;

  render();

  // assets (best-effort persistence)
  initAssets().then(() => { onAssets(() => { if (state.tool === 'library') render(); }); });

  // config + models
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

  // image styles (best-effort)
  try { const s = await api.styles(); state.styles = Array.isArray(s?.data) ? s.data : []; if (state.tool === 'image') render(); } catch {}

  // first-run welcome if there is genuinely no usable key
  if (!state.config.sharedKey && !state.key) openUnlock('nokey');
}

boot();
