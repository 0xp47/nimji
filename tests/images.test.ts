/**
 * Tests for src/images.ts
 * Covers: inferMimeTypeFromPath, IMAGE_PIPELINE_DISABLED env flag,
 * downloadImages (disabled path), upgradeGgDlUrlsFromRedirects (disabled path).
 * Live network calls (uploadImageToGemini, actual downloads) are integration-only
 * and require real session credentials — they are excluded here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferMimeTypeFromPath, IMAGE_PIPELINE_DISABLED, redactErrorBody } from "../src/images.js";

// ─── inferMimeTypeFromPath ────────────────────────────────────────────────────

describe("inferMimeTypeFromPath", () => {
  const cases: [string, string][] = [
    ["photo.png", "image/png"],
    ["PHOTO.PNG", "image/png"],
    ["image.jpg", "image/jpeg"],
    ["image.jpeg", "image/jpeg"],
    ["animation.gif", "image/gif"],
    ["graphic.webp", "image/webp"],
    ["icon.svg", "image/svg+xml"],
    ["scan.tiff", "image/tiff"],
    ["scan.tif", "image/tiff"],
    ["bitmap.bmp", "image/bmp"],
    ["/absolute/path/to/photo.jpg", "image/jpeg"],
    ["relative/sub/dir/file.png", "image/png"],
    ["no-extension", "application/octet-stream"],
    ["file.xyz", "application/octet-stream"],
    ["file.tar.gz", "application/octet-stream"],
    [".hidden", "application/octet-stream"],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      assert.equal(inferMimeTypeFromPath(input), expected);
    });
  }

  it("is case-insensitive for extensions", () => {
    assert.equal(inferMimeTypeFromPath("FILE.PNG"), inferMimeTypeFromPath("file.png"));
    assert.equal(inferMimeTypeFromPath("FILE.JPG"), inferMimeTypeFromPath("file.jpg"));
  });

  it("handles paths with multiple dots", () => {
    assert.equal(inferMimeTypeFromPath("my.backup.photo.jpeg"), "image/jpeg");
  });
});

// ─── IMAGE_PIPELINE_DISABLED ─────────────────────────────────────────────────

describe("IMAGE_PIPELINE_DISABLED", () => {
  it("is a boolean", () => {
    assert.equal(typeof IMAGE_PIPELINE_DISABLED, "boolean");
  });

  it("reflects IMAGE_PIPELINE_DISABLED env — disabled when set to '1'", () => {
    if (process.env.IMAGE_PIPELINE_DISABLED === "1") {
      assert.equal(IMAGE_PIPELINE_DISABLED, true);
    } else {
      assert.equal(IMAGE_PIPELINE_DISABLED, false);
    }
  });
});

// ─── downloadImages — disabled path ──────────────────────────────────────────

describe("downloadImages — when IMAGE_PIPELINE_DISABLED is true", () => {
  it("returns empty arrays immediately without touching the network", async () => {
    // Only run this assertion when the pipeline is disabled (default test env)
    if (!IMAGE_PIPELINE_DISABLED) return;

    const { downloadImages } = await import("../src/images.js");
    // makeConfig stub — auth not needed since pipeline is disabled
    const cfg = {
      auth: { cookies: "", atToken: "", fSid: "" },
      context: {
        blParam: "bl",
        sourcePath: "/app/x",
        sessionFingerprint: "fp",
        ext525001261Tail: 1,
        browserValidation: "v",
        clientData: "cd",
        language: "en",
        chromeFullVersion: "147.0",
        acceptLanguage: "en-US",
        secChUaPlatform: "Windows",
        secChUaPlatformVersion: "19.0.0",
        browserChannel: "stable",
        browserCopyright: "c",
        userAgent: "UA",
      },
      runtime: {
        streamIdleTimeoutMs: 30_000,
        streamMaxDurationMs: 180_000,
        imageStreamIdleTimeoutMs: 120_000,
        imageStreamMaxDurationMs: 600_000,
        debugCandidates: false,
      },
    } as Parameters<typeof downloadImages>[0];

    const result = await downloadImages(
      cfg,
      ["https://lh3.googleusercontent.com/rd-gg/fake"],
      "/tmp/nimji-test-out",
    );
    assert.deepEqual(result, { savedPaths: [], uploadedUrls: [] });
  });
});

// ─── upgradeGgDlUrlsFromRedirects — disabled path ────────────────────────────

describe("upgradeGgDlUrlsFromRedirects — when IMAGE_PIPELINE_DISABLED is true", () => {
  it("returns URLs unchanged without making any network requests", async () => {
    if (!IMAGE_PIPELINE_DISABLED) return;

    const { upgradeGgDlUrlsFromRedirects } = await import("../src/images.js");
    const input = [
      "https://lh3.googleusercontent.com/gg-dl/abc",
      "https://lh3.googleusercontent.com/rd-gg/xyz",
    ];
    const cfg = {
      auth: { cookies: "", atToken: "", fSid: "" },
      context: {
        blParam: "bl",
        sourcePath: "/app/x",
        sessionFingerprint: "fp",
        ext525001261Tail: 1,
        browserValidation: "v",
        clientData: "cd",
        language: "en",
        chromeFullVersion: "147.0",
        acceptLanguage: "en-US",
        secChUaPlatform: "Windows",
        secChUaPlatformVersion: "19.0.0",
        browserChannel: "stable",
        browserCopyright: "c",
        userAgent: "UA",
      },
      runtime: {
        streamIdleTimeoutMs: 30_000,
        streamMaxDurationMs: 180_000,
        imageStreamIdleTimeoutMs: 120_000,
        imageStreamMaxDurationMs: 600_000,
        debugCandidates: false,
      },
    } as Parameters<typeof upgradeGgDlUrlsFromRedirects>[0];

    const out = await upgradeGgDlUrlsFromRedirects(cfg, input);
    assert.deepEqual(out, input);
  });
});

// ─── redactErrorBody ──────────────────────────────────────────────────────────

describe("redactErrorBody", () => {
  it("replaces known SID cookie patterns", () => {
    const body = "error: SID=g.a000xyz1234567890abcdef; NID=531=somevalue";
    const out = redactErrorBody(body);
    assert.ok(!out.includes("g.a000xyz1234567890abcdef"), "raw SID value must be redacted");
    assert.ok(out.includes("SID=[redacted]"), "SID key must be preserved with redacted marker");
  });

  it("replaces bare long base64-ish tokens", () => {
    const fakeParam = "sample_test_value_for_redaction_check_9876543210";
    const body = `upload_id=${fakeParam}&other=x`;
    const out = redactErrorBody(body);
    assert.ok(!out.includes(fakeParam), "long token must be redacted");
  });

  it("preserves short values and plain text", () => {
    const body = "Not found";
    assert.equal(redactErrorBody(body), "Not found");
  });

  it("truncates to maxLen", () => {
    const body = "x".repeat(1000);
    assert.ok(redactErrorBody(body, 100).length <= 100);
  });

  it("does not throw on empty string", () => {
    assert.doesNotThrow(() => redactErrorBody(""));
    assert.equal(redactErrorBody(""), "");
  });
});
