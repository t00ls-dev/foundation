import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest } from "../../src/client/api.js";
import {
  invalidateSessionGeneration,
  setSessionIdentity,
} from "../../src/client/session-generation.js";

describe("private request session generation", () => {
  let events: EventTarget;
  beforeEach(() => {
    events = new EventTarget();
    vi.stubGlobal("window", events);
    invalidateSessionGeneration();
    setSessionIdentity("A");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([200, 401])(
    "ignores an old %s mutation response after B signs in",
    async (status) => {
      let release!: (response: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        ),
      );
      const unauthorized = vi.fn();
      events.addEventListener("links:unauthorized", unauthorized);
      const pending = apiRequest("/api/bookmarks/old", z.unknown(), {
        method: "PATCH",
      });
      invalidateSessionGeneration();
      setSessionIdentity(undefined);
      setSessionIdentity("B");
      release(
        Response.json(
          status === 401
            ? { error: { message: "Expired A" } }
            : { title: "A's data" },
          { status },
        ),
      );
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(unauthorized).not.toHaveBeenCalled();
    },
  );

  it("checks generation again after reading a delayed error body", async () => {
    let release!: (body: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const response = Response.json({}, { status: 401 });
    vi.spyOn(response, "json").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
          started();
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response)),
    );
    const unauthorized = vi.fn();
    events.addEventListener("links:unauthorized", unauthorized);
    const pending = apiRequest("/api/bookmarks/old", z.unknown());
    await ready;
    setSessionIdentity("B");
    release({ error: { message: "Expired A" } });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("still expires the current session on a current 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: { message: "Expired" } }, { status: 401 }),
        ),
      ),
    );
    const unauthorized = vi.fn();
    events.addEventListener("links:unauthorized", unauthorized);
    await expect(
      apiRequest("/api/bookmarks", z.unknown()),
    ).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("aborts pending transport before an old response can change browser cookies", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = options.signal!;
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    const pending = apiRequest("/api/bookmarks/old", z.unknown(), {
      method: "PATCH",
    });
    invalidateSessionGeneration();
    expect(signal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
