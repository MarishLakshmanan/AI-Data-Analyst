import { describe, expect, it, vi } from "vitest";
import { WELCOME_KEY, createWelcomeStore } from "../welcome-store";

const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage;
};

describe("welcome store", () => {
  it("is unseen on a fresh session and seen after dismiss", () => {
    const storage = fakeStorage();
    const store = createWelcomeStore(() => storage);
    expect(store.getSnapshot()).toBe("unseen");
    store.dismiss();
    expect(store.getSnapshot()).toBe("seen");
    expect(storage.getItem(WELCOME_KEY)).toBe("1");
  });

  it("stays seen for a new store sharing the same storage (e.g. a page reload)", () => {
    const storage = fakeStorage();
    createWelcomeStore(() => storage).dismiss();
    expect(createWelcomeStore(() => storage).getSnapshot()).toBe("seen");
  });

  it("notifies subscribers on dismiss and stops after unsubscribe", () => {
    const store = createWelcomeStore(() => fakeStorage());
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.dismiss();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    store.dismiss();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory when storage throws (blocked site data)", () => {
    const blocked = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const store = createWelcomeStore(blocked as unknown as () => Storage);
    expect(store.getSnapshot()).toBe("unseen");
    expect(() => store.dismiss()).not.toThrow();
    expect(store.getSnapshot()).toBe("seen");
  });

  it("works with no storage at all (server)", () => {
    const store = createWelcomeStore(() => undefined);
    expect(store.getSnapshot()).toBe("unseen");
    store.dismiss();
    expect(store.getSnapshot()).toBe("seen");
  });
});
