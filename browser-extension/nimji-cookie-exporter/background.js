/* global chrome, URL */

const STORAGE_KEY = "nimjiAuthCapture";

const defaultState = () => ({
  atToken: "",
  fSid: "",
  lastCapturedAt: 0,
  lastUrl: "",
});

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...defaultState(), ...(stored[STORAGE_KEY] || {}) };
}

async function writeState(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

function normalizeForEnv(value) {
  return String(value || "")
    .replace(/\r?\n/g, "")
    .trim();
}

function shellQuote(value) {
  return `'${normalizeForEnv(value).replace(/'/g, "'\\''")}'`;
}

function buildEnvBlock(cookies, atToken, fSid) {
  return [
    `COOKIES=${shellQuote(cookies)}`,
    `AT_TOKEN=${shellQuote(atToken)}`,
    `F_SID=${shellQuote(fSid)}`,
  ].join("\n");
}

async function getCookiesHeader() {
  const cookies = await chrome.cookies.getAll({ url: "https://gemini.google.com/" });
  const sorted = [...cookies].sort((a, b) => a.name.localeCompare(b.name));
  return sorted
    .filter((cookie) => cookie.name && typeof cookie.value === "string")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function parseStreamRequest(details) {
  try {
    const url = new URL(details.url);
    const path = url.pathname || "";
    const isGeminiRpc = path.includes("/BardFrontendService/StreamGenerate");
    const isBatch = path.includes("/data/batchexecute");

    if (!isGeminiRpc && !isBatch) return null;

    const fSid = normalizeForEnv(url.searchParams.get("f.sid") || "");

    let atToken = "";
    const formData = details.requestBody && details.requestBody.formData;
    if (formData && Array.isArray(formData.at) && formData.at.length > 0) {
      atToken = normalizeForEnv(formData.at[0]);
    }

    return {
      atToken,
      fSid,
      lastUrl: details.url,
      lastCapturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function updateFromRequest(details) {
  const parsed = parseStreamRequest(details);
  if (!parsed) return;

  const current = await readState();
  const next = {
    atToken: parsed.atToken || current.atToken,
    fSid: parsed.fSid || current.fSid,
    lastCapturedAt: parsed.lastCapturedAt,
    lastUrl: parsed.lastUrl,
  };

  await writeState(next);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void updateFromRequest(details);
  },
  {
    urls: [
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate*",
      "https://gemini.google.com/_/BardChatUi/data/batchexecute*",
    ],
  },
  ["requestBody"],
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "clear-capture") {
    void (async () => {
      await writeState(defaultState());
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "get-export") {
    void (async () => {
      const [cookies, state] = await Promise.all([getCookiesHeader(), readState()]);
      const atToken = normalizeForEnv(state.atToken);
      const fSid = normalizeForEnv(state.fSid);
      const envBlock = buildEnvBlock(cookies, atToken, fSid);
      sendResponse({
        ok: true,
        cookies,
        atToken,
        fSid,
        envBlock,
        hasAll: Boolean(cookies && atToken && fSid),
        lastCapturedAt: state.lastCapturedAt,
        lastUrl: state.lastUrl,
      });
    })();
    return true;
  }

  return false;
});
