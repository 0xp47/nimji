/**
 * Tests for src/paths.ts
 * Covers: resolveAppHomeDir with and without env overrides.
 * Note: resolveAppHomeDir reads process.env at call time, so we can test it
 * by setting env vars before calling the function.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { resolveAppHomeDir } from "../src/paths.js";

describe("resolveAppHomeDir", () => {
  let savedNimjiHome: string | undefined;
  let savedGemaiHome: string | undefined;

  beforeEach(() => {
    savedNimjiHome = process.env.NIMJI_HOME;
    savedGemaiHome = process.env.GEMAI_HOME;
    delete process.env.NIMJI_HOME;
    delete process.env.GEMAI_HOME;
  });

  afterEach(() => {
    if (savedNimjiHome !== undefined) process.env.NIMJI_HOME = savedNimjiHome;
    else delete process.env.NIMJI_HOME;
    if (savedGemaiHome !== undefined) process.env.GEMAI_HOME = savedGemaiHome;
    else delete process.env.GEMAI_HOME;
  });

  it("defaults to ~/.nimji when neither NIMJI_HOME nor GEMAI_HOME is set", () => {
    const dir = resolveAppHomeDir();
    assert.equal(dir, path.resolve(os.homedir(), ".nimji"));
  });

  it("returns NIMJI_HOME when set to an absolute path", () => {
    process.env.NIMJI_HOME = "/custom/nimji/home";
    const dir = resolveAppHomeDir();
    assert.equal(dir, path.resolve("/custom/nimji/home"));
  });

  it("NIMJI_HOME wins over GEMAI_HOME when both are set", () => {
    process.env.NIMJI_HOME = "/nimji-wins";
    process.env.GEMAI_HOME = "/gemai-loses";
    const dir = resolveAppHomeDir();
    assert.equal(dir, path.resolve("/nimji-wins"));
  });

  it("falls back to GEMAI_HOME when NIMJI_HOME is absent", () => {
    delete process.env.NIMJI_HOME;
    process.env.GEMAI_HOME = "/gemai-fallback";
    const dir = resolveAppHomeDir();
    assert.equal(dir, path.resolve("/gemai-fallback"));
  });

  it("resolves relative NIMJI_HOME to an absolute path", () => {
    process.env.NIMJI_HOME = "relative/path";
    const dir = resolveAppHomeDir();
    assert.ok(path.isAbsolute(dir));
    // Normalize separators so the check works on both POSIX and Windows
    assert.ok(dir.split(path.sep).join("/").endsWith("relative/path"));
  });

  it("returns a string (never null or undefined)", () => {
    const dir = resolveAppHomeDir();
    assert.equal(typeof dir, "string");
    assert.ok(dir.length > 0);
  });
});
