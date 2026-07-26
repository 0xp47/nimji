/**
 * Example 2 — Multi-turn conversation
 *
 * Sends several follow-up messages in the same session. The client
 * automatically threads conversation IDs from each reply into the next request.
 *
 * Run:
 *   node --env-file=.env --import tsx/esm examples/02-multi-turn-conversation.ts
 */

import { createClientFromEnv } from "../src/index.js";

const client = createClientFromEnv({ keepalive: false });

const turns = [
  "My name is Alex. Remember that.",
  "What is my name?",
  "What is 12 multiplied by 8? Show your working.",
];

for (const prompt of turns) {
  console.log(`\nYou: ${prompt}`);

  const result = await client.generate({ prompt });

  if (!result.ok) {
    console.error("Error:", result.error.message);
    process.exit(1);
  }

  console.log(`Gemini: ${result.value.text}`);
}

client.stopKeepalive();
