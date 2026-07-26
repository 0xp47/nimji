/**
 * Example 1 — Simple text prompt
 *
 * Sends a single question to Gemini and prints the reply.
 * Credentials are read from environment variables (or a .env file).
 *
 * Run:
 *   COOKIES="..." AT_TOKEN="..." F_SID="..." npx tsx examples/01-text-prompt.ts
 *   — or with a .env file —
 *   node --env-file=.env --import tsx/esm examples/01-text-prompt.ts
 */

import { createClientFromEnv } from "../src/index.js";

const client = createClientFromEnv({ keepalive: false });

const result = await client.generate({ prompt: "What is the capital of Japan?" });

if (!result.ok) {
  console.error("Error:", result.error.message);
  process.exit(1);
}

console.log(result.value.text);

client.stopKeepalive();
