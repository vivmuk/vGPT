# vGPT — Venice AI Super App

[![Venice AI](https://img.shields.io/badge/Powered%20by-Venice%20AI-FF7F50.svg)](https://venice.ai/)
[![PWA](https://img.shields.io/badge/PWA-installable-8A6BFF.svg)](#)

A **futuristic, mobile-first multimodal super app** that puts the entire Venice AI
platform in one place. Chat, generate and edit images, upscale, remove
backgrounds, make videos, compose music, synthesise voices, and transcribe audio —
then **chain any result into the next tool**. Generate an image → animate it into a
video → or edit, enhance, and remix it, all in a couple of taps.

The web app is a self-contained, instant-loading PWA served by a thin Node/Express
proxy. No heavy framework, no build step — it loads fast and feels native on a phone.

## ✨ What it can do

Every tool reads each model's advertised **capabilities and constraints** from the
Venice `/models` endpoint and builds its form (and request payload) dynamically — so
new models with new parameters work automatically, and unsupported parameters are
never sent.

| Tool | Venice endpoints | Highlights |
|------|------------------|------------|
| **Chat** | `/chat/completions` | Streaming, reasoning, web search, vision (attach images) |
| **Image · Generate** | `/image/generate` | Aspect ratio / resolution / steps / CFG / styles / variants — per model |
| **Image · Edit** | `/image/edit`, `/image/multi-edit` | Prompt-based editing, multi-image compositing |
| **Image · Enhance** | `/image/upscale` | Upscale up to 4× and AI detail enhancement |
| **Image · Remove BG** | `/image/background-remove` | Transparent-PNG cutouts |
| **Video** | `/video/queue` → `/video/retrieve` | Text-to-video & image-to-video, duration/resolution/audio, live price quote |
| **Audio · Music** | `/audio/queue` → `/audio/retrieve` | Lyrics, instrumental, voice, duration, speed — per model |
| **Audio · Speech** | `/audio/speech` | 100+ voices, formats, speed, style prompts |
| **Audio · Transcribe** | `/audio/transcriptions` | Speech-to-text from any audio/video file |
| **Library** | — | Every creation, persisted locally, with one-tap chaining |

## 🔑 Access & the 5-query free trial

- **Shared key (optional):** set `VENICE_API_KEY` on the server and *anyone* who
  opens the site gets **5 free queries** to try every feature.
- **Bring your own key:** after the free trial — or any time — a user pastes their
  own Venice API key for **unlimited** use on their own credits. The key is stored
  only in their browser (`localStorage`) and sent straight to Venice via the proxy;
  it is never persisted server-side.
- Don't have a key? The app links to **https://venice.ai/chat?ref=yN8qqI** to get one,
  and a key shared by anyone can simply be pasted in.

## 🚀 Run / deploy

```bash
npm install
VENICE_API_KEY=your_key_here npm start   # serves the PWA + proxy on :3000
```

On **Railway** (configured in `railway.toml`): build runs `npm install`, start runs
`npm start`. Set `VENICE_API_KEY` in the service variables for the shared free trial
(or leave it unset to require every visitor to bring their own key).

### Why Node and not Rust?

The server is a thin I/O-bound proxy — its job is to forward requests to Venice and
stream responses back. Latency is dominated by model inference and network round-trips,
not by our process's CPU, so a Rust rewrite would add a lot of complexity (and break
the zero-config Railway/Node pipeline) for no perceptible speed gain. The real
performance wins are already here: a framework-free static PWA that loads instantly,
60-second model caching, and streamed chat.

## 🏗️ Architecture

```
server.js                # Express proxy for the full Venice API + static host
  /api/config            # whether a shared key is configured
  /api/models            # model catalogue (cached 60s)
  /api/chat              # streaming chat completions
  /api/image/*           # generate · edit · multi-edit · upscale · background-remove · styles
  /api/video/*           # quote · queue · retrieve · complete
  /api/audio/*           # quote · queue · retrieve · complete · speech · transcriptions
  /api/fetch-media       # fetch presigned media (VPS-backed video models)
public/
  index.html             # app shell + PWA manifest
  styles.css             # futuristic glass/neon theme
  core.js                # state, API client, capability helpers, asset store
  tools.js               # one capability-driven view per feature
  app.js                 # navigation, model picker, settings, free-trial unlock
```

The proxy resolves the API key per request — a `x-venice-key` header (bring-your-own)
takes priority, falling back to the server's `VENICE_API_KEY`. Binary responses
(images, audio, video) are returned to the client as base64 data URLs for uniform,
CORS-free rendering, downloading and chaining.

> The `app/`, `constants/`, `types/` and `utils/` directories contain the original
> Expo/React Native project, kept for native development. The deployed web experience
> is the PWA in `public/`.

---

Made with ❤️ and powered by [Venice AI](https://venice.ai/).
