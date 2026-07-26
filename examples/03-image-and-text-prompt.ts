/**
 * Example 3 — Image + text prompt
 *
 * Uploads a local image to Gemini and asks a question about it.
 * The image is uploaded first to obtain a contribution token, then
 * attached to the generate() call.
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm examples/03-image-and-text-prompt.ts <path-to-image>
 *
 * Example:
 *   node --env-file=.env --import tsx/esm examples/03-image-and-text-prompt.ts ./photo.jpg
 */

import { createClientFromEnv, uploadImageToGemini, loadConfigFromEnv } from "../src/index.js";

const imagePath = process.argv[2];

if (!imagePath) {
  console.error("Usage: node ... examples/03-image-and-text-prompt.ts <path-to-image>");
  process.exit(1);
}

// Load config once — reused for both upload and generate
const config = loadConfigFromEnv();

// Step 1: upload the image to Gemini and receive a contribution token
console.log(`Uploading ${imagePath}...`);
const attachment = await uploadImageToGemini(config, imagePath);
console.log(`Uploaded — token: ${attachment.tokenPath}`);

// Step 2: attach the token to a generate() call
const client = createClientFromEnv({ keepalive: false });

const result = await client.generate({
  prompt: "Describe what you see in this image in detail.",
  imageAttachment: attachment,
});

if (!result.ok) {
  console.error("Error:", result.error.message);
  process.exit(1);
}

console.log("\nGemini:", result.value.text);

client.stopKeepalive();
