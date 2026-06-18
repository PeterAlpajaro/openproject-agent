import { describe, it, expect } from "vitest";
import {
  SESSION_KEY,
  generateSessionId,
  loadOrCreateSessionId,
  resetSessionId,
} from "./session.js";

// A tiny in-memory stand-in for the browser's sessionStorage so these tests
// run under plain Node without jsdom.
function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    _dump: () => Object.fromEntries(store),
  };
}

describe("generateSessionId", () => {
  it("produces a non-empty string", () => {
    expect(typeof generateSessionId()).toBe("string");
    expect(generateSessionId().length).toBeGreaterThan(0);
  });

  it("produces distinct ids on successive calls", () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

describe("loadOrCreateSessionId", () => {
  it("returns the existing id when one is already stored", () => {
    const storage = fakeStorage({ [SESSION_KEY]: "existing-id" });
    expect(loadOrCreateSessionId(storage)).toBe("existing-id");
  });

  it("mints and persists a new id when none exists", () => {
    const storage = fakeStorage();
    const id = loadOrCreateSessionId(storage);
    expect(id).toBeTruthy();
    // The minted id is written back so later reads are stable.
    expect(storage.getItem(SESSION_KEY)).toBe(id);
  });

  it("is stable across repeated calls on the same storage", () => {
    const storage = fakeStorage();
    expect(loadOrCreateSessionId(storage)).toBe(loadOrCreateSessionId(storage));
  });
});

describe("resetSessionId", () => {
  it("overwrites the stored id with a different value", () => {
    const storage = fakeStorage({ [SESSION_KEY]: "old-id" });
    const newId = resetSessionId(storage);
    expect(newId).not.toBe("old-id");
    expect(storage.getItem(SESSION_KEY)).toBe(newId);
  });
});
