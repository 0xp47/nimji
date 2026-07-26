#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "./client.js";
import { IMAGE_PIPELINE_DISABLED, inferMimeTypeFromPath, uploadImageToGemini } from "./images.js";
import { loadConfigFromEnv, mergeProjectConfigIntoEnv, validateConfig } from "./config.js";
import { resolveAppHomeDir } from "./paths.js";
import { createSessionStore } from "./session.js";
import type { GemaiClient, GemaiHooks, GenerateResult, ImageAttachment, Result } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readPkgVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const j = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof j.version === "string" ? j.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const PKG_VERSION = readPkgVersion();

const argValue = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const eqMatch = process.argv.find((arg) => arg.startsWith(prefix));
  if (eqMatch) return eqMatch.slice(prefix.length);

  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next;
};

const hasFlag = (...names: string[]): boolean => names.some((name) => process.argv.includes(name));
const valueOf = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = argValue(name);
    if (value) return value;
  }
  return undefined;
};

const toPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const nextReqId = (): string => String(Math.floor(1_000_000 + Math.random() * 9_000_000));
const nextSourcePath = (): string => `/app/${randomUUID().replace(/-/g, "").slice(0, 16)}`;

const withRefreshedContext = (config: ReturnType<typeof loadConfigFromEnv>) => ({
  ...config,
  context: {
    ...config.context,
    reqId: nextReqId(),
    requestUuid: randomUUID().toUpperCase(),
    sourcePath: nextSourcePath(),
  },
});

const COLOR_ENABLED =
  process.env.NO_COLOR !== "1" &&
  process.env.TERM !== "dumb" &&
  (process.env.FORCE_COLOR === "1" ||
    process.env.FORCE_COLOR === "true" ||
    process.stdout.isTTY ||
    process.stderr.isTTY);

const hex = (value: string, text: string): string => {
  if (!COLOR_ENABLED) return text;
  const cleaned = value.replace("#", "");
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `\u001b[38;2;${r};${g};${b}m${text}\u001b[0m`;
};
const muted = (text: string): string => hex("#8b95a7", text);
const accent = (text: string): string => hex("#6ea8fe", text);
const success = (text: string): string => hex("#59d499", text);
const warn = (text: string): string => hex("#ffb86c", text);
const strong = (text: string): string => hex("#d7e3ff", text);
const danger = (text: string): string => hex("#ff6b7a", text);
const codeTone = (text: string): string => hex("#b4c7ff", text);
/** Fenced code only — block / line comments vs executable lines. */
const codeCommentTone = (text: string): string => {
  if (!COLOR_ENABLED) return text;
  return `\u001b[3m${hex("#7d9a88", text)}\u001b[23m`;
};
const dim = (text: string): string => (COLOR_ENABLED ? `\u001b[2m${text}\u001b[0m` : text);

const betaPill = (label = "beta"): string => {
  if (!COLOR_ENABLED) return `[${label}]`;
  const fr = 255;
  const fg = 247;
  const fb = 230;
  const br = 194;
  const bg = 65;
  const bb = 12;
  return `\u001b[1m\u001b[38;2;${fr};${fg};${fb}m\u001b[48;2;${br};${bg};${bb}m ${label} \u001b[0m`;
};

type EmitLine = (line: string) => void;

const termWidth = (): number => {
  const cols = process.stdout.columns ?? process.stderr.columns ?? 100;
  return Math.max(72, Math.min(cols, 120));
};

const brand = (subtitle: string): void => {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const width = termWidth();

  const titlePart = `── nimji • ${subtitle} `;
  const timePart = ` ${stamp} ──`;
  const fillLength = Math.max(2, width - titlePart.length - timePart.length - 2);
  console.error(`\n${accent("┌")}${accent(titlePart)}${accent("─".repeat(fillLength))}${accent(timePart)}${accent("┐")}`);

  const cmdText = `commands:  ${strong("/exit")}${muted(" or ")}${strong("/quit")}${muted("  |  ")}${strong("/help")}${muted(" for all commands")}`;
  const cmdPlain = `commands:  /exit or /quit  |  /help for all commands`;
  const cmdPadding = " ".repeat(Math.max(0, width - cmdPlain.length - 4));
  console.error(`${accent("│")}  ${cmdText}${cmdPadding}${accent("│")}`);

  console.error(`${accent("└")}${accent("─".repeat(width - 2))}${accent("┘")}`);
};

const section = (title: string, emit: EmitLine = console.log): void => {
  const label = strong(title.toUpperCase());
  emit(`\n${accent("▌")} ${label}`);
};

const kv = (label: string, value: string | number, emit: EmitLine = console.log): void => {
  const left = muted(label.padEnd(12, " "));
  emit(`  ${left} ${strong(String(value))}`);
};

const banner = (kind: "ok" | "warn" | "error", text: string): void => {
  if (kind === "ok") {
    console.error(`  ${success("✔")}  ${text}`);
  } else if (kind === "warn") {
    console.error(`  ${warn("⚠")}  ${text}`);
  } else {
    console.error(`  ${danger("✗")}  ${text}`);
  }
};

type UiDensity = "compact" | "comfortable";
type AnswerStyle = "boxed" | "plain";

function normalizeUiDensity(raw: string | undefined, fallback: UiDensity): UiDensity {
  const t = raw?.trim().toLowerCase();
  if (t === "compact") return "compact";
  if (t === "comfortable") return "comfortable";
  return fallback;
}

function normalizeAnswerStyle(raw: string | undefined, fallback: AnswerStyle): AnswerStyle {
  const t = raw?.trim().toLowerCase();
  if (t === "plain") return "plain";
  if (t === "boxed") return "boxed";
  return fallback;
}

function startKeepaliveInBackground(intervalMinutes: number): void {
  const keepaliveFile = path.resolve(__dirname, "runtime", "keepalive.js");
  const keepaliveSessionFile = process.env.KEEPALIVE_SESSION_FILE ?? "keepalive-session.json";
  const child = spawn(process.execPath, [...process.execArgv, keepaliveFile, "--daemon"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KEEPALIVE_INTERVAL_MINUTES: String(intervalMinutes),
      KEEPALIVE_BASE_DIR: resolveAppHomeDir(),
      KEEPALIVE_SESSION_FILE: keepaliveSessionFile,
    },
  });
  child.unref();
  console.error(
    `  ${success(
      `[keepalive] background on  pid=${child.pid ?? "unknown"}  every=${intervalMinutes}m  file=${keepaliveSessionFile}`,
    )}  ${betaPill()}`,
  );
}

function printHelp(): void {
  console.log(`nimji ${PKG_VERSION} — Gemini StreamGenerate CLI`);
  console.log("");
  console.log("Usage:");
  console.log("  nimji                       Start interactive terminal chat (default)");
  console.log("  nimji [prompt]              One-shot prompt (single reply, then exit)");
  console.log("");
  console.log("Commands inside interactive chat:");
  console.log("  /help                       Show chat help menu");
  console.log("  /attach <file-path>         Attach a local image for the next prompt");
  console.log("  /draw <prompt>              Generate an image from your prompt");
  console.log("  /search <query>             Search for images of your query");
  console.log("  /reset                      Clear the chat memory");
  console.log("  /exit or /quit              Exit the session");
  console.log("");
  console.log("Flags:");
  console.log("  --prompt \"text\"             One-shot prompt (alternative to positional)");
  console.log("  --keepalive                 Keep session active in the background");
  console.log("  --no-session                Do not load/save session history");
  console.log("  --reset-session             Clear session history before starting");
  console.log("  -v, --version               Display version info");
  console.log("  -h, --help                  Display this help menu");
  console.log("");
  console.log("Environment configuration: COOKIES, AT_TOKEN, F_SID");
}

type ResponseIssue = "none" | "partial_stream" | "no_text";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function classifyResponse(value: {
  text: string | null;
  imageUrls?: readonly string[];
  savedImagePaths?: readonly string[];
  meta: { chunkCount: number; rawSize: number; statusCode: number };
}): ResponseIssue {
  if (value.meta.statusCode !== 200) return "partial_stream";
  if (value.meta.chunkCount <= 1 || value.meta.rawSize < 220) return "partial_stream";
  const hasImages =
    (value.imageUrls && value.imageUrls.length > 0) ||
    (value.savedImagePaths && value.savedImagePaths.length > 0);
  if (!hasImages && (!value.text || value.text.trim().length === 0)) return "no_text";
  return "none";
}

async function runGenerateWithRetry(
  client: GemaiClient,
  prompt: string,
  saveImages: boolean,
  noRetry: boolean,
  allowSessionRecovery: boolean,
  maxRetries: number,
  imageAttachment?: ImageAttachment,
  imageOutputDir?: string,
): Promise<{
  result: Result<GenerateResult>;
  issue: ResponseIssue;
  usedRetry: boolean;
  usedSessionRecovery: boolean;
  usedFreshNoSessionRetry: boolean;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const result = await client.generate({
    prompt,
    includeImages: true,
    saveImages,
    imageAttachment,
    imageOutputDir,
  });
  if (!result.ok) {
    return {
      result,
      issue: "partial_stream",
      usedRetry: false,
      usedSessionRecovery: false,
      usedFreshNoSessionRetry: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  let issue = classifyResponse(result.value);
  if (issue === "none" || noRetry) {
    return {
      result,
      issue,
      usedRetry: false,
      usedSessionRecovery: false,
      usedFreshNoSessionRetry: false,
      elapsedMs: Date.now() - startedAt,
    };
  }
  let usedRetry = false;
  let retried: Result<GenerateResult> = result;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const retryConfig = loadConfigFromEnv();
    const checked = validateConfig(retryConfig);
    if (!checked.ok) {
      return {
        result,
        issue,
        usedRetry: false,
        usedSessionRecovery: false,
        usedFreshNoSessionRetry: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const conversationState = client.getConversation();
    const retryClient = createClient({
      ...checked.value,
      context: { ...checked.value.context, reqId: nextReqId() },
    });
    retryClient.setConversation(conversationState);

    retried = await retryClient.generate({
      prompt,
      includeImages: true,
      saveImages,
      imageAttachment,
      imageOutputDir,
    });
    usedRetry = true;

    if (retried.ok) {
      client.setConversation(retryClient.getConversation());
      issue = classifyResponse(retried.value);
      if (issue === "none") break;
    } else {
      issue = "partial_stream";
    }

    if (attempt < maxRetries) await sleep(1200);
  }

  if (
    allowSessionRecovery &&
    retried.ok &&
    issue !== "none" &&
    Boolean(client.getConversation().conversationId)
  ) {
    const freshConfig = loadConfigFromEnv();
    const freshChecked = validateConfig(freshConfig);
    if (!freshChecked.ok) {
      return {
        result: retried,
        issue,
        usedRetry,
        usedSessionRecovery: false,
        usedFreshNoSessionRetry: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const recoveryClient = createClient({
      ...withRefreshedContext(freshChecked.value),
      conversation: {},
    });

    const recovered = await recoveryClient.generate({
      prompt,
      includeImages: true,
      saveImages,
      imageAttachment,
      imageOutputDir,
    });
    if (recovered.ok) {
      issue = classifyResponse(recovered.value);
      client.resetConversation();
      client.setConversation(recoveryClient.getConversation());
    }
    return {
      result: recovered,
      issue,
      usedRetry,
      usedSessionRecovery: true,
      usedFreshNoSessionRetry: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  if (allowSessionRecovery && retried.ok && issue !== "none") {
    const freshConfig = loadConfigFromEnv();
    const freshChecked = validateConfig(freshConfig);
    if (!freshChecked.ok) {
      return {
        result: retried,
        issue,
        usedRetry,
        usedSessionRecovery: false,
        usedFreshNoSessionRetry: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const freshClient = createClient({
      ...withRefreshedContext(freshChecked.value),
      conversation: {},
    });

    const fresh = await freshClient.generate({
      prompt,
      includeImages: true,
      saveImages,
      imageAttachment,
      imageOutputDir,
    });
    if (fresh.ok) {
      issue = classifyResponse(fresh.value);
      client.resetConversation();
      client.setConversation(freshClient.getConversation());
    } else {
      issue = "partial_stream";
    }

    return {
      result: fresh,
      issue,
      usedRetry,
      usedSessionRecovery: false,
      usedFreshNoSessionRetry: true,
      elapsedMs: Date.now() - startedAt,
    };
  }

  return {
    result: retried,
    issue,
    usedRetry,
    usedSessionRecovery: false,
    usedFreshNoSessionRetry: false,
    elapsedMs: Date.now() - startedAt,
  };
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

type CodeStyleChunk = { readonly text: string; readonly comment: boolean };

/** Line `//` and block (slash-star … star-slash) comments, incl. multi-line blocks; quote-aware. */
function scanJsLikeCodeLine(
  line: string,
  blockContinuesIn: boolean,
): { chunks: CodeStyleChunk[]; blockContinues: boolean } {
  type Mode = "code" | "blk" | "sq" | "dq" | "tm";
  let mode: Mode = blockContinuesIn ? "blk" : "code";
  let commentFlag = blockContinuesIn;
  const chunks: CodeStyleChunk[] = [];
  let cur = "";

  const flush = (): void => {
    if (!cur) return;
    chunks.push({ text: cur, comment: commentFlag });
    cur = "";
  };

  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const n = line[i + 1];

    if (mode === "code") {
      if (c === "/" && n === "/") {
        flush();
        commentFlag = true;
        cur = line.slice(i);
        flush();
        return { chunks, blockContinues: false };
      }
      if (c === "/" && n === "*") {
        flush();
        commentFlag = true;
        cur = "/*";
        i += 2;
        mode = "blk";
        continue;
      }
      if (c === "'") {
        cur += "'";
        i += 1;
        mode = "sq";
        continue;
      }
      if (c === '"') {
        cur += '"';
        i += 1;
        mode = "dq";
        continue;
      }
      if (c === "`") {
        cur += "`";
        i += 1;
        mode = "tm";
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }

    if (mode === "blk") {
      if (c === "*" && n === "/") {
        cur += "*/";
        i += 2;
        flush();
        commentFlag = false;
        mode = "code";
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }

    if (mode === "sq") {
      cur += c;
      i += 1;
      if (c === "\\" && i < line.length) {
        cur += line[i];
        i += 1;
      } else if (c === "'") {
        mode = "code";
      }
      continue;
    }

    if (mode === "dq") {
      cur += c;
      i += 1;
      if (c === "\\" && i < line.length) {
        cur += line[i];
        i += 1;
      } else if (c === '"') {
        mode = "code";
      }
      continue;
    }

    if (mode === "tm") {
      cur += c;
      i += 1;
      if (c === "\\" && i < line.length) {
        cur += line[i];
        i += 1;
      } else if (c === "`") {
        mode = "code";
      }
      continue;
    }
  }

  flush();
  return { chunks, blockContinues: mode === "blk" };
}

function mergeAdjacentCodeChunks(chunks: CodeStyleChunk[]): CodeStyleChunk[] {
  const out: CodeStyleChunk[] = [];
  for (const ch of chunks) {
    const prev = out[out.length - 1];
    if (prev && prev.comment === ch.comment) {
      out[out.length - 1] = { text: prev.text + ch.text, comment: prev.comment };
    } else {
      out.push({ ...ch });
    }
  }
  return out;
}

/** Word-wrap fenced code with per-token styling; hard-wraps tokens longer than width. */
function wrapCodeStyleChunks(chunks: CodeStyleChunk[], wrapWidth: number): string[] {
  const merged = mergeAdjacentCodeChunks(chunks);
  const linesOut: string[] = [];
  let buf = "";
  let len = 0;

  const appendFrag = (frag: string, comment: boolean): void => {
    if (!frag) return;
    let offset = 0;
    while (offset < frag.length) {
      const room = wrapWidth - len;
      if (room <= 0) {
        linesOut.push(buf);
        buf = "";
        len = 0;
        continue;
      }
      const take = Math.min(room, frag.length - offset);
      const piece = frag.slice(offset, offset + take);
      const styled = comment ? codeCommentTone(piece) : codeTone(piece);
      buf += styled;
      len += take;
      offset += take;
      if (offset < frag.length) {
        linesOut.push(buf);
        buf = "";
        len = 0;
      }
    }
  };

  const emitToken = (raw: string, comment: boolean): void => {
    if (!raw) return;
    const tokens = raw.match(/\S+|\s+/g) ?? [];
    for (const tok of tokens) {
      appendFrag(tok, comment);
    }
  };

  for (const ch of merged) {
    emitToken(ch.text, ch.comment);
  }
  if (len > 0) linesOut.push(buf);
  return linesOut;
}

/** Inline spans for answers (fenced blocks skipped). Code wins over `**` wrapping. */
type InlineToken =
  | { readonly kind: "plain"; readonly text: string }
  | { readonly kind: "bold"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "boldCode"; readonly text: string };

function parseInlineMarkdownTokens(line: string, bold = false): InlineToken[] {
  const out: InlineToken[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const j = line.indexOf("`", i + 1);
      if (j !== -1) {
        const inner = line.slice(i + 1, j);
        out.push(bold ? { kind: "boldCode", text: inner } : { kind: "code", text: inner });
        i = j + 1;
        continue;
      }
    }
    if (!bold && line[i] === "*" && line[i + 1] === "*") {
      const j = line.indexOf("**", i + 2);
      if (j !== -1) {
        const inner = line.slice(i + 2, j);
        out.push(...parseInlineMarkdownTokens(inner, true));
        i = j + 2;
        continue;
      }
    }
    let j = i;
    while (j < line.length) {
      if (line[j] === "`") break;
      if (!bold && line[j] === "*" && line[j + 1] === "*") break;
      j += 1;
    }
    const textRun = line.slice(i, j);
    if (textRun) {
      out.push(bold ? { kind: "bold", text: textRun } : { kind: "plain", text: textRun });
    }
    i = j;
  }
  return out;
}

function stylizeInlineWord(word: string, kind: InlineToken["kind"]): string {
  if (!COLOR_ENABLED) return word;
  switch (kind) {
    case "plain":
      return word;
    case "bold":
      return `\u001b[1m${strong(word)}\u001b[22m`;
    case "code":
      return codeTone(word);
    case "boldCode":
      return `\u001b[1m${codeTone(word)}\u001b[22m`;
    default:
      return word;
  }
}

/** Word-wrap using visible length only; preserves ANSI spans from {@link stylizeInlineWord}. */
function wrapInlineTokens(tokens: InlineToken[], width: number): string[] {
  const lines: string[] = [];
  let buf = "";
  let len = 0;

  const emitWord = (word: string, kind: InlineToken["kind"]): void => {
    const ansi = stylizeInlineWord(word, kind);
    const wlen = word.length;
    const needSpace = len > 0 ? 1 : 0;
    if (len + needSpace + wlen <= width || len === 0) {
      buf += (needSpace ? " " : "") + ansi;
      len += needSpace + wlen;
    } else {
      lines.push(buf);
      buf = ansi;
      len = wlen;
    }
  };

  for (const tok of tokens) {
    const parts = tok.text.split(/\s+/).filter(Boolean);
    for (const w of parts) emitWord(w, tok.kind);
  }
  if (len > 0) lines.push(buf);
  return lines;
}

function uppercaseHeadingTokens(tokens: InlineToken[]): InlineToken[] {
  return tokens.map((t) => {
    if (t.kind === "code" || t.kind === "boldCode") return t;
    return { ...t, text: t.text.toUpperCase() };
  });
}

const renderMarkdownLines = (text: string, width: number, density: UiDensity): string[] => {
  const lines = text.split("\n");
  const rendered: string[] = [];
  let inCode = false;
  let codeBlockComment = false;
  const gap = density === "comfortable" ? "" : null;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      codeBlockComment = false;
      if (density === "comfortable") rendered.push("");
      continue;
    }

    if (inCode) {
      const { chunks, blockContinues } = scanJsLikeCodeLine(line, codeBlockComment);
      codeBlockComment = blockContinues;
      const innerWidth = Math.max(10, width - 2);
      const codeLines = wrapCodeStyleChunks(chunks, innerWidth);
      if (codeLines.length === 0) {
        rendered.push("  ");
      } else {
        for (const item of codeLines) {
          rendered.push(`  ${item}`);
        }
      }
      continue;
    }

    if (!trimmed) {
      if (density === "comfortable" && rendered[rendered.length - 1] !== "") rendered.push("");
      continue;
    }

    if (trimmed.startsWith("#")) {
      const heading = trimmed.replace(/^#+\s*/, "");
      const headingTokens = uppercaseHeadingTokens(parseInlineMarkdownTokens(heading));
      const richHeading = headingTokens.some((t) => t.kind !== "plain");
      const wrapped = wrapInlineTokens(headingTokens, width);
      rendered.push(...(richHeading ? wrapped : wrapped.map((w) => strong(w))));
      if (density === "comfortable") rendered.push("");
      continue;
    }

    const bulletMatch = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/);
    if (bulletMatch) {
      const content = bulletMatch[2];
      const wrapped = wrapInlineTokens(parseInlineMarkdownTokens(content), Math.max(10, width - 4));
      if (wrapped.length > 0) {
        rendered.push(`${accent("•")} ${wrapped[0]}`);
        for (const item of wrapped.slice(1)) rendered.push(`  ${item}`);
      }
      continue;
    }

    const wrapped = wrapInlineTokens(parseInlineMarkdownTokens(trimmed), width);
    rendered.push(...wrapped);
    if (gap !== null) rendered.push(gap);
  }

  const isBlank = (s: string) => !s || s.trim().length === 0;
  while (rendered.length > 0 && isBlank(rendered[0])) {
    rendered.shift();
  }
  while (rendered.length > 0 && isBlank(rendered[rendered.length - 1])) {
    rendered.pop();
  }

  const collapsed: string[] = [];
  for (const line of rendered) {
    if (isBlank(line)) {
      if (collapsed.length > 0 && !isBlank(collapsed[collapsed.length - 1])) {
        collapsed.push("");
      }
    } else {
      collapsed.push(line);
    }
  }
  return collapsed;
};

const stripAnsi = (value: string): string => {
  let out = "";
  let inEsc = false;
  for (const ch of value) {
    if (!inEsc && ch === "\u001b") {
      inEsc = true;
      continue;
    }
    if (inEsc) {
      if (ch === "m") inEsc = false;
      continue;
    }
    out += ch;
  }
  return out;
};

const renderAssistantBlock = (text: string, style: AnswerStyle, density: UiDensity): void => {
  const width =
    style === "boxed"
      ? Math.max(50, Math.min(termWidth() - 8, 96))
      : Math.max(50, Math.min(termWidth() - 4, 100));
  const rendered = renderMarkdownLines(text, width, density);

  if (style === "plain") {
    for (const lineText of rendered) {
      console.log(`  ${lineText}`);
    }
    return;
  }

  const boxBorder = (t: string) => hex("#42526e", t);

  console.log(boxBorder(`  ┌${"─".repeat(width + 2)}┐`));
  for (const lineText of rendered) {
    const plain = stripAnsi(lineText);
    const padded = lineText + " ".repeat(Math.max(0, width - plain.length));
    console.log(boxBorder("  │ ") + padded + boxBorder(" │"));
  }
  console.log(boxBorder(`  └${"─".repeat(width + 2)}┘`));
};

function printGenerateOutput(
  value: GenerateResult,
  issue: ResponseIssue,
  saveImages: boolean,
  showSourceImageUrls: boolean,
  elapsedMs: number,
  answerStyle: AnswerStyle,
  density: UiDensity,
): void {
  const statusStr = value.meta.statusCode === 200
    ? success("✔  200 OK")
    : danger(`✖  Status ${value.meta.statusCode}`);
  const latencyStr = elapsedMs >= 5000
    ? warn(`${(elapsedMs / 1000).toFixed(1)}s`)
    : success(`${(elapsedMs / 1000).toFixed(1)}s`);
  const sizeStr = muted(formatBytes(value.meta.rawSize));
  const chunkStr = muted(`${value.meta.chunkCount} chunks`);

  console.error(`\n  ${statusStr}  ${dim("•")}  ${latencyStr}  ${dim("•")}  ${sizeStr}  ${dim("•")}  ${chunkStr}\n`);

  if (value.text) {
    renderAssistantBlock(value.text, answerStyle, density);
  }

  if (issue !== "none") {
    const reason = issue === "partial_stream" ? "partial stream payload" : "no text extracted";
    banner("warn", `${reason}. usually stale auth/session state.`);
  }

  if (value.savedImagePaths.length > 0) {
    const count = value.savedImagePaths.length;
    const dest = path.dirname(value.savedImagePaths[0]);
    const relDest = path.relative(process.cwd(), dest) || dest;
    const cleanDest = "./" + relDest.replace(/\\/g, "/");
    console.log(`  ${success("✔")}  Saved ${count} image${count > 1 ? "s" : ""} to ${accent(cleanDest)}:`);
    for (const file of value.savedImagePaths) {
      const absPath = path.resolve(file);
      const fileUrl = pathToFileURL(absPath).href;
      console.log(`  ${muted("-")} ${strong(fileUrl)}`);
    }
  } else if (saveImages && value.imageUrls.length > 0) {
    banner("warn", "image URLs found but save failed (gated/expired).");
  }

  if (value.imageUrls.length > 0) {
    const hideEphemeral = value.savedImagePaths.length > 0 && !showSourceImageUrls;
    if (hideEphemeral) {
      console.log(
        dim(
          `  Omitted ${value.imageUrls.length} ephemeral lh3 link(s); files above are canonical. ${muted("--show-source-image-urls to print CDN URLs.")}`,
        ),
      );
    } else {
      console.log(`  ${muted("•")} ${strong("Source CDN URLs:")}`);
      for (const url of value.imageUrls) {
        console.log(`  ${muted("-")} ${url}`);
      }
    }
  }
}

async function main(): Promise<void> {
  if (hasFlag("--help", "-h")) {
    printHelp();
    process.exit(0);
  }
  if (hasFlag("--version", "-v")) {
    console.log(PKG_VERSION);
    process.exit(0);
  }

  mergeProjectConfigIntoEnv(process.cwd());

  const argv = process.argv.slice(2);
  const consumedValues = new Set<string>();
  const promptFromFlag = valueOf("--prompt");
  if (promptFromFlag) consumedValues.add(promptFromFlag);

  // --input-image <path>: explicit image attachment
  const inputImageFlag = valueOf("--input-image");
  if (inputImageFlag) consumedValues.add(inputImageFlag);

  const positional = argv.filter((arg) => !arg.startsWith("--") && !consumedValues.has(arg));

  // Auto-detect: if the first positional looks like an image path (known extension),
  // treat it as the image file and the remaining positionals as the prompt text.
  // Also handles: nimji "describe this" ./photo.jpg  (image as last positional)
  const IMAGE_EXTS = /\.(png|jpe?g|webp|gif|svg|bmp|tiff?)$/i;
  let detectedImagePath: string | undefined = inputImageFlag;
  let promptPositionals = positional;

  if (!detectedImagePath && positional.length > 0) {
    const lastArg = positional[positional.length - 1];
    if (IMAGE_EXTS.test(lastArg ?? "")) {
      detectedImagePath = lastArg;
      promptPositionals = positional.slice(0, -1);
    } else if (IMAGE_EXTS.test(positional[0] ?? "")) {
      detectedImagePath = positional[0];
      promptPositionals = positional.slice(1);
    }
  }

  const prompt = (promptFromFlag ?? promptPositionals.join(" ")) || "hi";
  const imageMode = hasFlag("--image");
  const saveImagesExplicit = process.argv.includes("--save-images");
  const noSaveImages = process.argv.includes("--no-save-images");
  const saveImagesRequested = saveImagesExplicit || (imageMode && !noSaveImages);
  const showSourceImageUrls = hasFlag("--show-source-image-urls");
  const resetSession = process.argv.includes("--reset-session");
  const noSession = process.argv.includes("--no-session");
  const keepalive = hasFlag("--keepalive", "--keep-alive");
  const noRetry = process.argv.includes("--no-retry");
  const noSessionRecover = process.argv.includes("--no-session-recover");
  const mode = (hasFlag("--chat") || (positional.length === 0 && !promptFromFlag) ? "chat" : (valueOf("--mode") ?? "once")).toLowerCase();
  const keepaliveMinutes = toPositiveInt(
    valueOf("--keepalive-minutes", "--keep-alive-minutes") ??
      process.env.KEEPALIVE_INTERVAL_MINUTES,
    10,
  );
  const density = normalizeUiDensity(valueOf("--density") ?? process.env.UI_DENSITY, "comfortable");
  const answerStyle = normalizeAnswerStyle(
    valueOf("--answer-style") ?? process.env.UI_ANSWER_STYLE,
    "boxed",
  );
  const maxRetries = imageMode || Boolean(detectedImagePath) ? 2 : 1;

  if (keepalive && mode !== "chat") {
    startKeepaliveInBackground(keepaliveMinutes);
  }

  const config = loadConfigFromEnv();

  const saveImages = saveImagesRequested;


  const store = createSessionStore(path.resolve(resolveAppHomeDir(), "session.json"));

  const hooks: GemaiHooks = {
    onCandidates: async (candidates) => {
      if (!config.runtime.debugCandidates) return;
      console.error("[*] Top text candidates:");
      for (const item of candidates.slice(0, 40)) {
        console.error(`  [${item.score}] ${item.value.slice(0, 200)}`);
      }
    },
    onImageDownloadSkip: async (reason, url) => {
      console.error(`[*] Skipped image URL (${reason}): ${url.slice(0, 120)}`);
    },
  };

  let client: GemaiClient;
  try {
    client = createClient(config, hooks);
  } catch (err) {
    banner("error", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!noSession) {
    const restored = await store.load();
    if (restored.conversationId) {
      client.setConversation(restored);
    }
  }

  if (resetSession) {
    client.resetConversation();
    if (!noSession) {
      await store.clear();
    }
    banner("ok", "session reset");
  }

  // Upload image attachment if provided (either via --input-image or auto-detected path)
  let imageAttachment: ImageAttachment | undefined;
  if (detectedImagePath) {
    const mimeType = inferMimeTypeFromPath(detectedImagePath);
    if (mimeType === "application/octet-stream") {
      banner("warn", `${detectedImagePath}: unrecognised image extension, skipping upload`);
    } else {
      banner("ok", `uploading image  ${muted(detectedImagePath)}  ${muted(`(${mimeType})`)}`);
      try {
        imageAttachment = await uploadImageToGemini(config, detectedImagePath);
        banner("ok", `image attached  ${muted(imageAttachment.tokenPath.slice(0, 60))}…`);
      } catch (err) {
        banner("error", `image upload failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
  }

  if (mode === "chat") {
    if (keepalive) {
      client.startKeepalive({
        enabled: true,
        intervalMs: keepaliveMinutes * 60_000,
        prompt: process.env.KEEPALIVE_PROMPT ?? "hi",
      });
      banner("ok", `keepalive active (${keepaliveMinutes}m interval)  ${betaPill()}`);
    }
    brand("interactive chat");
    console.error(`  ${muted("type text")}       chat normally`);
    console.error(`  ${accent("/draw <prompt>")}   generate an image (saved to ./images/generated/)`);
    console.error(`  ${accent("/search <query>")}  search Google for images (saved to ./images/searched/)`);
    console.error(`  ${accent("/attach <path>")}   attach a local image for your next message`);
    console.error(`  ${accent("/reset")}           clear chat memory`);
    console.error(`  ${accent("/exit")}            quit session\n`);
    if (imageAttachment) {
      banner("ok", `image attached — will be sent with the first message  ${betaPill()}`);
    }
    const rl = createInterface({ input, output });
    // Image attachment applies to the first message only; subsequent turns are text-only.
    let pendingImageAttachment: ImageAttachment | undefined = imageAttachment;
    try {
      while (true) {
        const line = (await rl.question(`${accent("nimji")} ${muted("›")} `)).trim();
        if (!line) continue;

        let processedLine = line;
        let inlineAttachment: ImageAttachment | undefined = undefined;

        // Auto-detect and extract inline /attach <path> anywhere in the prompt line
        const attachRegex = /\/attach\s+("([^"]+)"|'([^']+)'|([^\s]+))/i;
        const match = attachRegex.exec(line);
        if (match) {
          const fullMatch = match[0];
          const filePath = match[2] || match[3] || match[4];
          const mimeType = inferMimeTypeFromPath(filePath);
          if (mimeType === "application/octet-stream") {
            banner("warn", `${filePath}: unrecognised image extension, skipping upload`);
          } else {
            banner("ok", `uploading image  ${muted(filePath)}  ${muted(`(${mimeType})`)}`);
            try {
              inlineAttachment = await uploadImageToGemini(config, filePath);
              banner("ok", `image attached successfully!`);
              processedLine = line.replace(fullMatch, "").trim();
            } catch (err) {
              banner("error", `image upload failed: ${err instanceof Error ? err.message : String(err)}`);
              continue;
            }
          }
        }

        // If the processed line is empty but we successfully attached an image, wait for prompt
        if (!processedLine && inlineAttachment) {
          pendingImageAttachment = inlineAttachment;
          continue;
        }

        if (processedLine.startsWith("/")) {
          const parts = processedLine.split(/\s+/);
          const cmd = parts[0].toLowerCase();
          const args = parts.slice(1).join(" ");

          if (cmd === "/exit" || cmd === "/quit") {
            break;
          }
          if (cmd === "/help") {
            console.error(`\n  ${strong("Interactive Chat Commands:")}`);
            console.error(`  ${accent("/help")}                - Show this menu`);
            console.error(`  ${accent("/exit")} or ${accent("/quit")}     - Close the chat session`);
            console.error(`  ${accent("/reset")}               - Clear chat memory`);
            console.error(`  ${accent("/attach <file-path>")}  - Attach a local image for the next prompt`);
            console.error(`  ${accent("/draw <prompt>")}       - Generate an image based on your prompt`);
            console.error(`  ${accent("/image <prompt>")}      - Alias for /draw`);
            console.error(`  ${accent("/search <query>")}      - Search for images of your query\n`);
            continue;
          }
          if (cmd === "/reset") {
            client.resetConversation();
            if (!noSession) {
              await store.clear();
            }
            banner("ok", "session reset");
            continue;
          }
          if (cmd === "/attach") {
            if (!args) {
              banner("error", "Usage: /attach <local-image-path>");
              continue;
            }
            const mimeType = inferMimeTypeFromPath(args);
            if (mimeType === "application/octet-stream") {
              banner("warn", `${args}: unrecognised image extension, skipping upload`);
              continue;
            }
            banner("ok", `uploading image  ${muted(args)}  ${muted(`(${mimeType})`)}`);
            try {
              pendingImageAttachment = await uploadImageToGemini(config, args);
              banner("ok", `image attached successfully for next prompt!`);
            } catch (err) {
              banner("error", `image upload failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            continue;
          }
          if (cmd === "/draw" || cmd === "/image") {
            if (!args) {
              banner("error", "Usage: /draw <prompt> or /image <prompt>");
              continue;
            }
            banner("ok", `generating image for: "${args}"`);
            const {
              result,
              issue,
              usedRetry,
              elapsedMs,
            } = await runGenerateWithRetry(
              client,
              `Create an image of: ${args}`,
              true, // force saveImages = true for download
              noRetry,
              !noSessionRecover,
              2, // maxRetries = 2 for images
              undefined,
              "./images/generated",
            );
            if (!result.ok) {
              banner("error", result.error.message);
              continue;
            }
            printGenerateOutput(
              result.value,
              issue,
              true,
              showSourceImageUrls,
              elapsedMs,
              answerStyle,
              density,
            );
            continue;
          }
          if (cmd === "/search" || cmd === "/search-image" || cmd === "/find") {
            if (!args) {
              banner("error", "Usage: /search <query> or /search-image <query>");
              continue;
            }
            banner("ok", `searching images for: "${args}"`);
            const {
              result,
              issue,
              usedRetry,
              elapsedMs,
            } = await runGenerateWithRetry(
              client,
              `Search Google for images of: ${args}`,
              true, // force saveImages = true to download search results
              noRetry,
              !noSessionRecover,
              maxRetries,
              undefined,
              "./images/searched",
            );
            if (!result.ok) {
              banner("error", result.error.message);
              continue;
            }
            printGenerateOutput(
              result.value,
              issue,
              true, // force print saved image paths
              showSourceImageUrls,
              elapsedMs,
              answerStyle,
              density,
            );
            continue;
          }

          banner("error", `Unknown command: ${cmd}. Type /help for available commands.`);
          continue;
        }

        const turnAttachment = inlineAttachment || pendingImageAttachment;
        pendingImageAttachment = undefined; // consume once

        const {
          result,
          issue,
          usedRetry,
          usedSessionRecovery,
          usedFreshNoSessionRetry,
          elapsedMs,
        } = await runGenerateWithRetry(
          client,
          processedLine,
          saveImages,
          noRetry,
          !noSessionRecover,
          maxRetries,
          turnAttachment,
        );
        if (!result.ok) {
          banner("error", result.error.message);
          continue;
        }
        if (usedSessionRecovery) {
          banner("ok", "session recovery applied");
        }
        if (usedFreshNoSessionRetry) {
          banner("ok", "fresh no-session retry applied");
        }
        if (usedRetry && issue !== "none") {
          banner("warn", "retry used, response still limited");
        }
        printGenerateOutput(
          result.value,
          issue,
          saveImages,
          showSourceImageUrls,
          elapsedMs,
          answerStyle,
          density,
        );
      }
    } finally {
      rl.close();
      client.stopKeepalive();
    }
  } else {
    brand("one-shot mode");
    console.error(`\n  ${accent("❯")} ${strong(prompt)}`);
    if (imageAttachment) {
      console.error(
        `  ${muted("image")}    ${strong(imageAttachment.fileName)}  ${muted(`(${imageAttachment.mimeType})`)}`,
      );
    }
    if (imageMode) banner("ok", "image mode enabled (extra retries)");
    if (imageMode && saveImages && !saveImagesExplicit) {
      banner("ok", "auto-saving images to ./images/generated (--no-save-images to skip disk)");
    }

    let finalPrompt = prompt;
    let finalSaveImages = saveImages;
    let finalOutputDir: string | undefined = undefined;
    let finalMaxRetries = maxRetries;

    if (prompt.startsWith("/")) {
      const parts = prompt.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(" ");

      if (cmd === "/draw" || cmd === "/image") {
        if (!args) {
          banner("error", "Usage: /draw <prompt> or /image <prompt>");
          process.exit(1);
        }
        finalPrompt = `Create an image of: ${args}`;
        finalSaveImages = true;
        finalOutputDir = "./images/generated";
        finalMaxRetries = 2; // extra retries for images
      } else if (cmd === "/search" || cmd === "/search-image" || cmd === "/find") {
        if (!args) {
          banner("error", "Usage: /search <query> or /search-image <query>");
          process.exit(1);
        }
        finalPrompt = `Search Google for images of: ${args}`;
        finalSaveImages = true;
        finalOutputDir = "./images/searched";
      } else {
        banner("error", `Unknown command: ${cmd} in one-shot mode.`);
        process.exit(1);
      }
    }

    const { result, issue, usedRetry, usedSessionRecovery, usedFreshNoSessionRetry, elapsedMs } =
      await runGenerateWithRetry(
        client,
        finalPrompt,
        finalSaveImages,
        noRetry,
        !noSessionRecover,
        finalMaxRetries,
        imageAttachment,
        finalOutputDir,
      );
    if (!result.ok) {
      banner("error", result.error.message);
      process.exit(1);
    }
    if (usedSessionRecovery) {
      banner("ok", "session recovery applied");
    }
    if (usedFreshNoSessionRetry) {
      banner("ok", "fresh no-session retry applied");
    }
    if (usedRetry && issue !== "none") {
      banner("warn", `${issue} detected, still limited response`);
    }
    printGenerateOutput(
      result.value,
      issue,
      finalSaveImages,
      showSourceImageUrls,
      elapsedMs,
      answerStyle,
      density,
    );
  }

  const finalState = client.getConversation();
  if (!noSession) {
    await store.save(finalState);
  }
}

main().catch((err) => {
  banner("error", `fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
