import { expect, test } from "@playwright/test";
import { z } from "zod";
import { extractEmailUrl } from "../test/email-link.js";

test("official reset GET exposes a stable final URL through real Worker/Assets without SPA navigation or consumption", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:5174";
  const email = `reset-transport-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "Reader", password: "password-before-reset" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/auth/request-password-reset", {
        headers: { Origin: origin },
        data: { email, redirectTo: "/reset-password" },
      })
    ).status(),
  ).toBe(200);
  const message = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject: "Reset your Links password" })}`,
  );
  const link = new URL(
    extractEmailUrl(
      z.object({ text: z.string() }).parse(await message.json()).text,
      origin,
    ),
  );
  const token = link.pathname.split("/").at(-1)!;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  const original = page.url();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  async function probe(value: string) {
    return page.evaluate(
      async ({ value, token }) => {
        const response = await fetch(value, {
          redirect: "follow",
          cache: "no-store",
          credentials: "same-origin",
          signal: new AbortController().signal,
        });
        const final = new URL(response.url);
        await response.body?.cancel();
        return {
          ok: response.ok,
          redirected: response.redirected,
          originMatches: final.origin === location.origin,
          path: final.pathname,
          tokenMatches: final.searchParams.get("token") === token,
          error: final.searchParams.get("error"),
          keys: [...final.searchParams.keys()],
        };
      },
      { value, token },
    );
  }
  for (let attempt = 0; attempt < 2; attempt++)
    expect(await probe(link.href)).toEqual({
      ok: true,
      redirected: true,
      originMatches: true,
      path: "/reset-password",
      tokenMatches: true,
      error: null,
      keys: ["token"],
    });
  const invalid = new URL(link);
  invalid.pathname = "/api/auth/reset-password/not-a-real-token";
  expect(await probe(invalid.href)).toEqual({
    ok: true,
    redirected: true,
    originMatches: true,
    path: "/reset-password",
    tokenMatches: false,
    error: "INVALID_TOKEN",
    keys: ["error"],
  });
  expect(
    (
      await page.request.post("/api/auth/reset-password", {
        headers: { Origin: origin },
        data: { token, newPassword: "password-after-reset" },
      })
    ).status(),
  ).toBe(200);
  expect((await probe(link.href)).error).toBe("INVALID_TOKEN");
  expect(page.url()).toBe(original);
  expect(navigations).toBe(0);
});
