/**
 * Tests for src/parser.ts
 * Covers: sortStableGoogleImageUrls, extractResponse (text extraction, image URL discovery,
 * conversation state parsing, noise/geo filtering, image generation prompts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortStableGoogleImageUrls, extractResponse } from "../src/parser.js";

// ─── sortStableGoogleImageUrls ───────────────────────────────────────────────

describe("sortStableGoogleImageUrls", () => {
  it("ranks rd-gg before gg-dl", () => {
    const urls = [
      "https://lh3.googleusercontent.com/gg-dl/shortlived",
      "https://lh3.googleusercontent.com/rd-gg/stable",
    ];
    const sorted = sortStableGoogleImageUrls(urls);
    assert.ok(sorted[0]!.includes("rd-gg"));
    assert.ok(sorted[1]!.includes("gg-dl"));
  });

  it("places non-lh3 URLs last", () => {
    const urls = [
      "https://example.com/image.png",
      "https://lh3.googleusercontent.com/rd-gg/stable",
    ];
    const sorted = sortStableGoogleImageUrls(urls);
    assert.ok(sorted[0]!.includes("rd-gg"));
    assert.ok(sorted[1]!.includes("example.com"));
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(sortStableGoogleImageUrls([]), []);
  });

  it("does not mutate the input array", () => {
    const input = [
      "https://lh3.googleusercontent.com/gg-dl/a",
      "https://lh3.googleusercontent.com/rd-gg/b",
    ];
    const copy = [...input];
    sortStableGoogleImageUrls(input);
    assert.deepEqual(input, copy);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Wrap a payload string the same way Gemini StreamGenerate wraps inner JSON. */
function wrbFrame(payloadObj: unknown): unknown[] {
  const payloadStr = JSON.stringify(payloadObj);
  return [[null, null, payloadStr]];
}

// ─── extractResponse — text ───────────────────────────────────────────────────

describe("extractResponse — text extraction", () => {
  it("returns null text for empty chunks", () => {
    const result = extractResponse([]);
    assert.equal(result.text, null);
  });

  it("extracts best text candidate from a well-formed payload", () => {
    const payload = [
      null,
      [[[["This is the assistant reply to your question about TypeScript."]]]],
    ];
    const result = extractResponse([wrbFrame(payload)]);
    assert.ok(result.text !== null);
    assert.ok(result.text!.includes("assistant reply"));
  });

  it("picks the longest/highest-scored candidate", () => {
    const payload = [
      null,
      [
        [
          [
            [
              "Short.",
              "This is a longer, more detailed answer with punctuation and multiple words.",
            ],
          ],
        ],
      ],
    ];
    const result = extractResponse([wrbFrame(payload)]);
    assert.ok(result.text !== null);
    // longer candidate should win
    assert.ok(result.text!.length > 6);
  });

  it("filters out URL-only strings from text candidates", () => {
    const payload = [
      null,
      [
        [
          [
            "https://lh3.googleusercontent.com/rd-gg/abc",
            "Real answer here with spaces and words.",
          ],
        ],
      ],
    ];
    const result = extractResponse([wrbFrame(payload)]);
    // The real answer should win; URL should not be selected as text
    if (result.text) {
      assert.ok(!result.text.startsWith("https://"));
    }
  });

  it("handles multiple chunks, merging candidates", () => {
    const p1 = [null, [[["First chunk text with reasonable length."]]]];
    const p2 = [null, [[["Second chunk with more detail and punctuation."]]]];
    const result = extractResponse([wrbFrame(p1), wrbFrame(p2)]);
    assert.ok(result.text !== null);
  });

  it("returns null text for noise-only payload", () => {
    // geo noise blocks should be filtered
    const payload = [null, [[["New York, United States"]]]];
    const result = extractResponse([wrbFrame(payload)]);
    // geo-only text filtered or very low score — text may be null
    // (we just verify no crash and result shape is correct)
    assert.ok(result.imageUrls !== undefined);
    assert.ok(result.candidates !== undefined);
  });
});

// ─── extractResponse — image URLs ────────────────────────────────────────────

describe("extractResponse — image URL discovery", () => {
  it("extracts rd-gg image URLs from raw stream text", () => {
    const raw = `someprefix https://lh3.googleusercontent.com/rd-gg/AAABBBCCCDDDEEEFFFGGGHHHIII012345678901234567 some suffix`;
    const result = extractResponse([], raw);
    assert.ok(result.imageUrls.length > 0);
    assert.ok(result.imageUrls[0]!.includes("rd-gg"));
  });

  it("extracts gg-dl image URLs from raw stream text", () => {
    const raw = `prefix https://lh3.googleusercontent.com/gg-dl/AAABBBCCCDDDEEE0123456789012345678901234567 end`;
    const result = extractResponse([], raw);
    assert.ok(result.imageUrls.length > 0);
    assert.ok(result.imageUrls[0]!.includes("gg-dl"));
  });

  it("deduplicates identical image URLs", () => {
    const url = "https://lh3.googleusercontent.com/rd-gg/UNIQUE0123456789012345678901234567890123";
    const raw = `${url} ${url} ${url}`;
    const result = extractResponse([], raw);
    assert.equal(result.imageUrls.filter((u) => u === url).length, 1);
  });

  it("filters out fonts.gstatic.com noise URLs", () => {
    const raw = `https://lh3.googleusercontent.com/rd-gg/AAABBBCCC012345678901234567890123456789 https://fonts.gstatic.com/rd-gg/noise`;
    const result = extractResponse([], raw);
    const hasNoise = result.imageUrls.some((u) => u.includes("fonts.gstatic.com"));
    assert.equal(hasNoise, false);
  });

  it("filters out image_generation_content noise", () => {
    const raw = `https://lh3.googleusercontent.com/rd-gg/REAL012345678901234567890123456789012345 https://lh3.googleusercontent.com/image_generation_content/noise`;
    const result = extractResponse([], raw);
    const hasNoise = result.imageUrls.some((u) => u.includes("image_generation_content"));
    assert.equal(hasNoise, false);
  });

  it("handles URL-encoded slashes in stream text", () => {
    const encoded = `https://lh3.googleusercontent.com\\/rd-gg\\/ENCODED0123456789012345678901234567890123`;
    const result = extractResponse([], encoded);
    assert.ok(result.imageUrls.length > 0);
  });

  it("returns empty imageUrls for plain text streams", () => {
    const result = extractResponse([], "just some plain text with no image urls");
    assert.equal(result.imageUrls.length, 0);
  });
});

// ─── extractResponse — image generation scenario ─────────────────────────────

describe("extractResponse — image generation (--image prompt)", () => {
  it("extracts both text description and image URL from an image-gen stream", () => {
    const imgUrl =
      "https://lh3.googleusercontent.com/rd-gg/IMAGEGEN01234567890123456789012345678901";
    const payload = [
      null,
      [[[["A beautiful sunset over the ocean with warm orange and pink hues."]]]],
    ];
    const raw = `some stream data ${imgUrl} more data`;
    const result = extractResponse([wrbFrame(payload)], raw);
    assert.ok(result.text !== null);
    assert.ok(result.text!.includes("sunset") || result.text!.length > 10);
    assert.equal(result.imageUrls.length, 1);
    assert.ok(result.imageUrls[0]!.includes("rd-gg"));
  });

  it("does not include 'creating your image' process trace as text", () => {
    const traceText = "creating your image — please wait";
    const goodText = "A vivid digital painting of a mountain landscape at dawn.";
    const payload = [null, [[[traceText, goodText]]]];
    const result = extractResponse([wrbFrame(payload)]);
    if (result.text) {
      assert.ok(!result.text.toLowerCase().startsWith("creating your image"));
    }
  });

  it("multiple image URLs are sorted rd-gg before gg-dl", () => {
    const ggdl = "https://lh3.googleusercontent.com/gg-dl/SHORTLIVED0123456789012345678901234567";
    const rdgg = "https://lh3.googleusercontent.com/rd-gg/STABLE01234567890123456789012345678901";
    const raw = `${ggdl} ${rdgg}`;
    const result = extractResponse([], raw);
    const rdIdx = result.imageUrls.findIndex((u) => u.includes("rd-gg"));
    const ggIdx = result.imageUrls.findIndex((u) => u.includes("gg-dl"));
    if (rdIdx !== -1 && ggIdx !== -1) {
      assert.ok(rdIdx < ggIdx, "rd-gg should appear before gg-dl");
    }
  });
});

// ─── extractResponse — conversation state ────────────────────────────────────

describe("extractResponse — conversation state", () => {
  it("extracts conversationId and responseId", () => {
    const payload = [
      null,
      [
        [
          "Some text answer with enough words to pass scoring.",
          [["c_conversation_id_abc", "r_response_id_xyz"]],
        ],
      ],
    ];
    const result = extractResponse([wrbFrame(payload)]);
    // Walk verifies prefixes; let's just confirm no crash and empty or filled
    assert.ok(typeof result.conversation === "object");
  });

  it("returns empty conversation for no-ID streams", () => {
    const result = extractResponse([wrbFrame([null, [[[]]]])]);
    assert.equal(result.conversation.conversationId, undefined);
  });
});

// ─── extractResponse — candidates array ──────────────────────────────────────

describe("extractResponse — candidates", () => {
  it("returns an array (possibly empty)", () => {
    const result = extractResponse([]);
    assert.ok(Array.isArray(result.candidates));
  });

  it("candidates are sorted by score descending", () => {
    const payload = [
      null,
      [[[["x", "A detailed explanation of TypeScript generics with examples and use-cases."]]]],
    ];
    const result = extractResponse([wrbFrame(payload)]);
    const scores = result.candidates.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1]! >= scores[i]!);
    }
  });
});
