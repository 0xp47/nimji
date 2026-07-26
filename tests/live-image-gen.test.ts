import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.IMAGE_PIPELINE_ENABLED = "1";

const { create } = await import("../src/index.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Live Image Generation Integration Test", () => {
  const COOKIES = process.env.COOKIES || "";
  const AT_TOKEN = process.env.AT_TOKEN || "";
  const F_SID = process.env.F_SID || "";

  const hasCredentials = COOKIES && AT_TOKEN && F_SID;

  it("downloads generated images successfully when credentials are provided", async () => {
    if (!hasCredentials) {
      console.log("\n[!] Skipping live image generation test (credentials not provided in environment).");
      return;
    }

    console.log("\n[~] Running live image generation query...");
    const client = create(
      { COOKIES, AT_TOKEN, F_SID },
      {
        onImageDownloadAttempt: (url) => console.log(`[test] Attempting: ${url.slice(0, 90)}…`),
        onImageDownloadSkip: (reason, url) => console.log(`[test] Skipped: ${reason}`),
      }
    );

    const tempOutputDir = path.join(__dirname, "../temp-test-images");

    try {
      const res = await client.generate({
        prompt: "generate a tiny blue circle",
        saveImages: true,
        imageOutputDir: tempOutputDir,
      });

      assert.ok(res.ok, `Generate request failed: ${res.ok === false ? res.error.message : ""}`);
      const val = res.value;

      console.log(`[~] Assistant text: ${val.text}`);
      console.log(`[~] imageUrls returned:`, val.imageUrls);
      console.log(`[~] savedImagePaths:`, val.savedImagePaths);

      assert.ok(val.imageUrls.length > 0, "Should return at least one image URL");
      assert.ok(val.savedImagePaths.length > 0, "Should have successfully saved at least one image file");

      // Verify each saved file exists and is non-empty
      for (const filePath of val.savedImagePaths) {
        assert.ok(fs.existsSync(filePath), `File does not exist: ${filePath}`);
        const stat = fs.statSync(filePath);
        assert.ok(stat.size > 1000, `Saved image file is too small or empty (${stat.size} bytes): ${filePath}`);
      }
    } finally {
      // Clean up temp images
      if (fs.existsSync(tempOutputDir)) {
        try {
          fs.rmSync(tempOutputDir, { recursive: true, force: true });
        } catch {}
      }
      client.stopKeepalive();
    }
  });
});
