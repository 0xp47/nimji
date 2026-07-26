/**
 * Example 4 — Image generation
 *
 * Asks Gemini to generate an image from a text description.
 * By default the returned CDN URLs are printed. Pass --save to also
 * download them to ./output-images/.
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm examples/04-image-generation.ts
 *   node --env-file=.env --import tsx/esm examples/04-image-generation.ts --save
 *
 * Note: image generation requires IMAGE_PIPELINE_ENABLED=1 in your .env
 * (or environment) when you want to download the result files.
 */

import { createClientFromEnv } from "../src/index.js";

const save = process.argv.includes("--save");

const client = createClientFromEnv({ keepalive: false });

const result = await client.generate({
  prompt: "Generate an image of a red fox sitting on a snowy mountain at sunset.",
  includeImages: true,
  saveImages: save,
  imageOutputDir: "./output-images",
});

if (!result.ok) {
  console.error("Error:", result.error.message);
  process.exit(1);
}

const { text, imageUrls, savedImagePaths } = result.value;

if (text) {
  console.log("Description:", text);
}

if (imageUrls.length === 0) {
  console.log("No image URLs returned — the model may have responded with text only.");
} else {
  console.log(`\nImage URL${imageUrls.length > 1 ? "s" : ""}:`);
  for (const url of imageUrls) {
    console.log(" ", url);
  }
}

if (savedImagePaths.length > 0) {
  console.log("\nSaved to:");
  for (const p of savedImagePaths) {
    console.log(" ", p);
  }
}

client.stopKeepalive();
