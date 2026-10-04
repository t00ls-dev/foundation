import { describe, expect, it, vi } from "vitest";
import { createProgressStore } from "../src/lib/progress-store.js";

describe("explicit progress operations", () => {
  it("keeps concurrent operations visible until the last completion", () => {
    const store = createProgressStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const finishFirst = store.begin();
    const finishSecond = store.begin();
    finishFirst();
    finishFirst();
    expect(store.getSnapshot()).toBe(true);
    finishSecond();
    expect(store.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    store.begin()();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("cleans aborted operations without completing unrelated work", () => {
    const store = createProgressStore();
    const controller = new AbortController();
    const finish = store.begin(controller.signal);
    const finishOther = store.begin();
    controller.abort();
    finish();
    expect(store.getSnapshot()).toBe(true);
    finishOther();
    expect(store.getSnapshot()).toBe(false);
    store.begin(controller.signal)();
    expect(store.getSnapshot()).toBe(false);
  });
});
