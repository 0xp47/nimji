/**
 * Tests for src/session.ts
 * Covers: createSessionStore — load, save, clear, field normalization, size cap.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSessionStore } from "../src/session.js";

let tmpDir: string;
let sessionFile: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `nimji-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
  sessionFile = path.join(tmpDir, "session.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("createSessionStore — load", () => {
  it("returns empty state when file does not exist", async () => {
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.deepEqual(state, {});
  });

  it("loads conversationId, responseId, choiceId", async () => {
    const data = {
      conversationId: "c_abc123",
      responseId: "r_xyz789",
      choiceId: "rc_def456",
    };
    await writeFile(sessionFile, JSON.stringify(data), "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.equal(state.conversationId, "c_abc123");
    assert.equal(state.responseId, "r_xyz789");
    assert.equal(state.choiceId, "rc_def456");
  });

  it("ignores unknown fields in the file", async () => {
    const data = { conversationId: "c_x", extraField: "ignored", count: 99 };
    await writeFile(sessionFile, JSON.stringify(data), "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.equal(state.conversationId, "c_x");
    assert.equal((state as Record<string, unknown>).extraField, undefined);
  });

  it("returns empty state for invalid JSON", async () => {
    await writeFile(sessionFile, "not json {{{", "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.deepEqual(state, {});
  });

  it("returns empty state when file exceeds size cap", async () => {
    // Write > 64 KiB
    const bigJson = JSON.stringify({ conversationId: "c_" + "x".repeat(70_000) });
    await writeFile(sessionFile, bigJson, "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.deepEqual(state, {});
  });

  it("trims whitespace from field values", async () => {
    await writeFile(
      sessionFile,
      JSON.stringify({ conversationId: "  c_trimmed  ", responseId: " r_trim " }),
      "utf8",
    );
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.equal(state.conversationId, "c_trimmed");
    assert.equal(state.responseId, "r_trim");
  });

  it("ignores fields exceeding max field length", async () => {
    const long = "c_" + "a".repeat(5000);
    await writeFile(sessionFile, JSON.stringify({ conversationId: long }), "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.equal(state.conversationId, undefined);
  });

  it("returns empty state for non-object JSON (array)", async () => {
    await writeFile(sessionFile, JSON.stringify([1, 2, 3]), "utf8");
    const store = createSessionStore(sessionFile);
    const state = await store.load();
    assert.deepEqual(state, {});
  });
});

describe("createSessionStore — save", () => {
  it("creates the file with correct JSON", async () => {
    const store = createSessionStore(sessionFile);
    await store.save({ conversationId: "c_save1", responseId: "r_save1" });
    const raw = await readFile(sessionFile, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.conversationId, "c_save1");
    assert.equal(parsed.responseId, "r_save1");
  });

  it("creates parent directories if needed", async () => {
    const deepFile = path.join(tmpDir, "deep", "nested", "session.json");
    const store = createSessionStore(deepFile);
    await store.save({ conversationId: "c_deep" });
    assert.ok(existsSync(deepFile));
  });

  it("overwrites existing session on save", async () => {
    const store = createSessionStore(sessionFile);
    await store.save({ conversationId: "c_old" });
    await store.save({ conversationId: "c_new" });
    const raw = await readFile(sessionFile, "utf8");
    assert.ok(raw.includes("c_new"));
    assert.ok(!raw.includes("c_old"));
  });

  it("round-trips through save → load", async () => {
    const store = createSessionStore(sessionFile);
    const original = {
      conversationId: "c_roundtrip",
      responseId: "r_roundtrip",
      choiceId: "rc_roundtrip",
    };
    await store.save(original);
    const loaded = await store.load();
    assert.equal(loaded.conversationId, original.conversationId);
    assert.equal(loaded.responseId, original.responseId);
    assert.equal(loaded.choiceId, original.choiceId);
  });
});

describe("createSessionStore — clear", () => {
  it("removes the session file", async () => {
    const store = createSessionStore(sessionFile);
    await store.save({ conversationId: "c_to_delete" });
    assert.ok(existsSync(sessionFile));
    await store.clear();
    assert.ok(!existsSync(sessionFile));
  });

  it("does not throw when file does not exist", async () => {
    const store = createSessionStore(sessionFile);
    await assert.doesNotReject(() => store.clear());
  });

  it("after clear, load returns empty state", async () => {
    const store = createSessionStore(sessionFile);
    await store.save({ conversationId: "c_pre_clear" });
    await store.clear();
    const state = await store.load();
    assert.deepEqual(state, {});
  });
});

describe("createSessionStore — path property", () => {
  it("exposes the resolved file path", () => {
    const store = createSessionStore(sessionFile);
    assert.equal(store.path, sessionFile);
  });
});
