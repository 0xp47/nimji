<div align="center">

# nimji

**Promise-first TypeScript client & CLI for Google Gemini web chat**

[![node](https://img.shields.io/badge/node-%3E%3D22.19-3C873A?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![ESM](https://img.shields.io/badge/module-ESM-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://nodejs.org/api/esm.html)

Multi-turn chat · Imagen 3 image generation · Google Image search · Multimodal upload · Keepalive · Polished terminal UI

</div>

---

## Contents

- [Install](#install)
- [Credentials](#credentials)
- [CLI](#cli)
  - [Interactive chat](#interactive-chat-recommended)
  - [One-shot](#one-shot)
  - [Image prompts](#image-prompts)
- [Library](#library)
  - [Quick start](#quick-start)
  - [Image attachment](#image-attachment)
  - [API reference](#api-reference)
- [Configuration files](#configuration-files)
- [Environment variables](#environment-variables)
- [Development](#development)

---

## Install

```bash
# Clone the repository
git clone https://github.com/0xp47/nimji.git
cd nimji

# Install dependencies and build
npm install
npm run build
```

---

## Credentials

`nimji` connects directly to Gemini web's private `StreamGenerate` endpoint using your browser session credentials. You need three values from DevTools (**Network tab** → click any `StreamGenerate` request):

| Variable   | Description & Location                                        |
| ---------- | ------------------------------------------------------------- |
| `COOKIES`  | `Cookie:` request header — full `SID=…; HSID=…; …` string     |
| `AT_TOKEN` | `at=` field in the POST body                                  |
| `F_SID`    | `f.sid=` query parameter in the request URL                   |

Save them into a `.env` file in the root directory:

```env
COOKIES="SID=g.a000…"
AT_TOKEN="ADR5zap…"
F_SID="-934583118011521981"
```

> **Note**: Credentials expire when you log out of Gemini or Chrome rotates session tokens. Re-copy fresh values from DevTools if requests start failing.

---

## CLI

### Interactive chat (Recommended)

Starts a continuous interactive terminal session with multi-turn conversation memory:

```bash
npm run chat
# or
npm start
```

Inside the interactive chat:
* Type text to chat normally with Gemini.
* **/draw `<prompt>`** — Generate high-resolution images via Imagen 3 (saved to `./images/generated/`)
* **/search `<query>`** — Search Google for images (saved to `./images/searched/`)
* **/attach `<path>`** — Attach a local image file to inspect in your next prompt
* **/reset** — Clear conversation memory
* **/exit** — Quit the session

### One-shot

Sends a single prompt or command, prints the result, and exits.

```bash
npm start "Explain async/await in JavaScript"
npm start "/draw a majestic golden dragon flying over mountains"
npm start "/search cute red panda in snowy forest"
```

### Image prompts

Attach a local image to your prompt. `nimji` uploads it via Google's resumable upload endpoint (`push.clients6.google.com`) and sends the contribution token to Gemini.

```bash
npm start "describe this photo" ./sunset.jpg
```

Supported formats: `png`, `jpg` / `jpeg`, `webp`, `gif`, `svg`, `bmp`, `tiff`.

---

## Library

### Quick start

```ts
import { create } from "nimji";

const client = create({
  COOKIES: process.env.COOKIES ?? "",
  AT_TOKEN: process.env.AT_TOKEN ?? "",
  F_SID: process.env.F_SID ?? "",
});

const res = await client.generate({ prompt: "hello" });
if (res.ok) {
  console.log(res.value.text);
}
client.stopKeepalive();
```

### Image attachment

```ts
import { loadConfigFromEnv, createClient, uploadImageToGemini } from "nimji";

const config = loadConfigFromEnv();
const client = createClient(config);

// 1. Upload local image to Google resumable upload endpoint
const attachment = await uploadImageToGemini(config, "./photo.png");

// 2. Pass attachment inside prompt generate call
const res = await client.generate({
  prompt: "What is in this image?",
  imageAttachment: attachment,
});

if (res.ok) {
  console.log(res.value.text);
}
```

### API Reference

#### `create(input, hooksOrOptions?, options?)` → `GemaiClient`
Creates a client taking flat env-style keys (`COOKIES`, `AT_TOKEN`, `F_SID`, etc.).

#### `client.generate(options)` → `Promise<Result<GenerateResult>>`

| Option            | Type               | Description                                         |
| ----------------- | ------------------ | --------------------------------------------------- |
| `prompt`          | `string`           | User prompt message                                 |
| `includeImages`   | `boolean?`         | Include extracted image URLs (default `true`)       |
| `saveImages`      | `boolean?`         | Download and save images locally                    |
| `imageOutputDir`  | `string?`          | Destination directory (default `./images/generated`)|
| `imageAttachment` | `ImageAttachment?` | Pre-uploaded image token from `uploadImageToGemini` |

---

## Configuration files

`nimji` automatically loads configuration from:
1. `process.env` / `.env` file
2. `./config.jsonc` or `./config.json` in the current directory
3. `~/.nimji/config.jsonc` or `~/.nimji/config.json`

---

## Environment variables

| Variable   | Description                           |
| ---------- | ------------------------------------- |
| `COOKIES`  | Full browser session cookie string    |
| `AT_TOKEN` | Anti-CSRF token from the POST body    |
| `F_SID`    | Session identifier from the URL query |

---

## Development

```bash
# Build TypeScript
npm run build

# Run unit test suite (155 tests)
npm test

# Format code
npm run format
```

---

<div align="center">

MIT © [0xp47](https://github.com/0xp47)

</div>
