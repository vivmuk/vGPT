const express = require('express');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════════
// vGPT — Venice AI Super App server
// Serves the static PWA in /public and proxies the FULL Venice AI API surface:
//   chat · image generate/edit/multi-edit/upscale/background-remove/styles
//   video (queue/retrieve/quote/complete) · music (audio queue/retrieve/...)
//   speech (TTS) · transcription (STT) · document parsing · embeddings · billing
//
// API key resolution (so "anyone with the key can use it"):
//   1. Per-request header `x-venice-key` (bring-your-own-key, never stored)
//   2. Server env `VENICE_API_KEY` (shared key baked into the deployment)
// ═══════════════════════════════════════════════════════════════════════════

const VENICE_API_BASE = 'https://api.venice.ai/api/v1';
const SERVER_API_KEY = process.env.VENICE_API_KEY || '';

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'dist');
// Prefer the hand-built PWA in /public; fall back to an Expo export if present.
const WEB_ROOT = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : DIST_DIR;

app.use(express.json({ limit: '60mb' }));
app.use(express.text({ type: 'text/plain', limit: '60mb' }));

// CORS for the /api surface.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-venice-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

console.log('=== vGPT server starting ===');
console.log('Node:', process.version, '| PORT:', PORT);
console.log('Shared VENICE_API_KEY:', SERVER_API_KEY ? `***${SERVER_API_KEY.slice(-4)}` : 'NOT SET (users must bring their own key)');
console.log('Web root:', WEB_ROOT, fs.existsSync(WEB_ROOT) ? '(ok)' : '(MISSING!)');

// ── helpers ──────────────────────────────────────────────────────────────────

// Resolve the key for this request: per-request override wins, else shared key.
function resolveKey(req) {
  const header = req.headers['x-venice-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return SERVER_API_KEY;
}

function requireKey(req, res) {
  const key = resolveKey(req);
  if (!key) {
    res.status(401).json({
      error: 'No Venice API key available. Add your own key in Settings, or configure VENICE_API_KEY on the server.',
      code: 'NO_API_KEY',
    });
    return null;
  }
  return key;
}

async function veniceFetch(key, endpoint, { method = 'GET', body, stream } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (stream) headers['Accept'] = 'text/event-stream';
  return fetch(`${VENICE_API_BASE}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Forward a JSON request and return Venice's JSON verbatim (status preserved).
async function proxyJson(req, res, endpoint, method = 'POST') {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const r = await veniceFetch(key, endpoint, {
      method,
      body: method === 'GET' ? undefined : (req.body ?? {}),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    // Pass through useful Venice metadata headers.
    passMeta(r, res);
    res.send(text && isJson(text) ? text : JSON.stringify({ error: text || `Venice error ${r.status}` }));
  } catch (err) {
    console.error(`proxyJson ${endpoint}:`, err.message);
    res.status(502).json({ error: 'Upstream request failed', details: err.message });
  }
}

// Forward a request whose successful response is binary (image/audio/video).
// Returns JSON: { data: "data:<ctype>;base64,...", contentType, ...meta }
// If Venice responds with JSON (status poll or error), it's passed through.
async function proxyBinary(req, res, endpoint) {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const r = await veniceFetch(key, endpoint, { method: 'POST', body: req.body ?? {} });
    const ct = r.headers.get('content-type') || '';
    passMeta(r, res);

    if (ct.includes('application/json')) {
      const text = await r.text();
      res.status(r.status).type('application/json');
      return res.send(text && isJson(text) ? text : JSON.stringify({ error: text }));
    }
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text || `Venice error ${r.status}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
    res.json({
      data: dataUrl,
      contentType: ct,
      bytes: buf.length,
      model: r.headers.get('x-venice-model-id') || undefined,
      modelName: r.headers.get('x-venice-model-name') || undefined,
      balance: r.headers.get('x-balance-remaining') || undefined,
    });
  } catch (err) {
    console.error(`proxyBinary ${endpoint}:`, err.message);
    res.status(502).json({ error: 'Upstream request failed', details: err.message });
  }
}

function passMeta(r, res) {
  const bal = r.headers.get('x-balance-remaining');
  if (bal) res.setHeader('x-balance-remaining', bal);
}

function isJson(s) {
  try { JSON.parse(s); return true; } catch { return false; }
}

// Build a multipart/form-data body from a base64 payload (Node 18+ FormData/Blob).
function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) {
    // Maybe a raw base64 string with no prefix.
    return { blob: new Blob([Buffer.from(dataUrl || '', 'base64')]), type: 'application/octet-stream' };
  }
  return { blob: new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), type: m[1] };
}

// ── health / config ───────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), sharedKey: !!SERVER_API_KEY });
});

// Tells the client whether a shared key exists (so it can prompt for one if not).
app.get('/api/config', (req, res) => {
  res.json({ sharedKey: !!SERVER_API_KEY, hasKey: !!resolveKey(req) });
});

// ── models & styles (with a tiny cache) ─────────────────────────────────────────

const modelCache = new Map(); // key -> { at, body }
const MODEL_TTL = 60_000;

app.get('/api/models', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const type = typeof req.query.type === 'string' ? req.query.type : 'all';
  const cacheKey = `${type}:${key.slice(-6)}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MODEL_TTL) {
    return res.type('application/json').send(cached.body);
  }
  try {
    const r = await veniceFetch(key, `/models?type=${encodeURIComponent(type)}`);
    const text = await r.text();
    if (r.ok) modelCache.set(cacheKey, { at: Date.now(), body: text });
    res.status(r.status).type('application/json').send(text);
  } catch (err) {
    console.error('models:', err.message);
    res.status(502).json({ error: 'Failed to fetch models', details: err.message });
  }
});

app.get('/api/image/styles', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const r = await veniceFetch(key, '/image/styles');
    res.status(r.status).type('application/json').send(await r.text());
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch styles', details: err.message });
  }
});

// ── chat (streaming passthrough) ────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const wantsStream = req.body?.stream !== false;
    const response = await veniceFetch(key, '/chat/completions', {
      method: 'POST',
      body: req.body,
      stream: wantsStream,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).type('application/json')
        .send(isJson(errorText) ? errorText : JSON.stringify({ error: errorText }));
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && response.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) { res.end(); break; }
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch (e) {
          console.error('stream:', e.message);
          res.end();
        }
      };
      pump();
      req.on('close', () => reader.cancel().catch(() => {}));
    } else {
      res.status(response.status).type('application/json').send(await response.text());
    }
  } catch (err) {
    console.error('chat:', err.message);
    res.status(502).json({ error: 'Chat request failed', details: err.message });
  }
});

// ── image ────────────────────────────────────────────────────────────────────

app.post('/api/image/generate', (req, res) => proxyJson(req, res, '/image/generate'));
app.post('/api/image', (req, res) => proxyJson(req, res, '/image/generate')); // legacy alias
app.post('/api/image/edit', (req, res) => proxyBinary(req, res, '/image/edit'));
app.post('/api/image/multi-edit', (req, res) => proxyBinary(req, res, '/image/multi-edit'));
app.post('/api/image/upscale', (req, res) => proxyBinary(req, res, '/image/upscale'));
app.post('/api/image/background-remove', (req, res) => proxyBinary(req, res, '/image/background-remove'));

// ── video (async queue/poll) ────────────────────────────────────────────────────

app.post('/api/video/quote', (req, res) => proxyJson(req, res, '/video/quote'));
app.post('/api/video/queue', (req, res) => proxyJson(req, res, '/video/queue'));
app.post('/api/video/retrieve', (req, res) => proxyBinary(req, res, '/video/retrieve'));
app.post('/api/video/complete', (req, res) => proxyJson(req, res, '/video/complete'));

// ── audio: music (async queue/poll), speech (TTS), transcription (STT) ───────────

app.post('/api/audio/quote', (req, res) => proxyJson(req, res, '/audio/quote'));
app.post('/api/audio/queue', (req, res) => proxyJson(req, res, '/audio/queue'));
app.post('/api/audio/retrieve', (req, res) => proxyBinary(req, res, '/audio/retrieve'));
app.post('/api/audio/complete', (req, res) => proxyJson(req, res, '/audio/complete'));
app.post('/api/audio/speech', (req, res) => proxyBinary(req, res, '/audio/speech'));

// Transcription expects multipart/form-data upstream. Client sends JSON with a
// base64 data URL; we rebuild a multipart body here (Node 18+ FormData/Blob).
app.post('/api/audio/transcriptions', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const { audio, filename = 'audio.mp3', model, response_format, timestamps, language } = req.body || {};
    if (!audio) return res.status(400).json({ error: 'Missing audio data.' });
    const { blob } = dataUrlToBlob(audio);
    const form = new FormData();
    form.append('file', blob, filename);
    if (model) form.append('model', model);
    if (response_format) form.append('response_format', response_format);
    if (timestamps != null) form.append('timestamps', String(timestamps));
    if (language) form.append('language', language);
    const r = await fetch(`${VENICE_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(await r.text());
  } catch (err) {
    console.error('transcriptions:', err.message);
    res.status(502).json({ error: 'Transcription failed', details: err.message });
  }
});

// ── augment: document text extraction ───────────────────────────────────────────

app.post('/api/augment/text-parser', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const { file, filename = 'document', response_format = 'json' } = req.body || {};
    if (!file) return res.status(400).json({ error: 'Missing file data.' });
    const { blob } = dataUrlToBlob(file);
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('response_format', response_format);
    const r = await fetch(`${VENICE_API_BASE}/augment/text-parser`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(await r.text());
  } catch (err) {
    console.error('text-parser:', err.message);
    res.status(502).json({ error: 'Document parsing failed', details: err.message });
  }
});

// ── embeddings & billing ──────────────────────────────────────────────────────

app.post('/api/embeddings', (req, res) => proxyJson(req, res, '/embeddings'));
app.get('/api/billing/balance', (req, res) => proxyJson(req, res, '/billing/balance', 'GET'));

// ── media fetch (presigned download URLs for VPS-backed video models) ─────────────

const MEDIA_HOST_ALLOW = ['venice.ai', 'amazonaws.com', 'cloudfront.net', 'byteplus.com',
  'bytepluses.com', 'googleapis.com', 'blob.core.windows.net', 'tos-s3-cn', 'oss-'];
const MEDIA_MAX_BYTES = 80 * 1024 * 1024;

app.post('/api/fetch-media', async (req, res) => {
  try {
    const url = (req.body || {}).url;
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return res.status(400).json({ error: 'A https URL is required.' });
    }
    let host = '';
    try { host = new URL(url).hostname; } catch { return res.status(400).json({ error: 'Invalid URL.' }); }
    if (!MEDIA_HOST_ALLOW.some(h => host.includes(h))) {
      return res.status(400).json({ error: `Refusing to fetch from host: ${host}` });
    }
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `Fetch failed: ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MEDIA_MAX_BYTES) return res.status(413).json({ error: 'Media too large.' });
    const ct = r.headers.get('content-type') || 'video/mp4';
    res.json({ data: `data:${ct};base64,${buf.toString('base64')}`, contentType: ct, bytes: buf.length });
  } catch (err) {
    console.error('fetch-media:', err.message);
    res.status(502).json({ error: 'Media fetch failed', details: err.message });
  }
});

// ── static files + SPA fallback ────────────────────────────────────────────────

app.use(express.static(WEB_ROOT, {
  extensions: ['html'],
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const indexPath = path.join(WEB_ROOT, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(indexPath);
  } else {
    res.status(500).send('index.html not found — web root is missing.');
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=== vGPT ready on http://0.0.0.0:${PORT} ===`);
});
server.on('error', (err) => { console.error('Server error:', err); process.exit(1); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
