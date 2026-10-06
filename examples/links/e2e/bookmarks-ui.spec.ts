import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { extractEmailUrl } from "../test/email-link.js";
import { bookmarkResponseSchema } from "../src/shared/bookmarks.js";

const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function reader(page: Page) {
  const email = `bookmarks-ui-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { name: "Bookmark Reader", email, password },
      })
    ).ok(),
  ).toBe(true);
  const mail = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject: "Verify your email for Links" })}`,
  );
  const url = z
    .object({
      text: z.string().transform((text) => extractEmailUrl(text, origin)),
    })
    .parse(await mail.json()).text;
  expect((await page.request.get(url)).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
}
async function bookmark(page: Page, title: string, tags = ["docs"]) {
  const response = await page.request.post("/api/bookmarks", {
    headers: { Origin: origin },
    data: {
      title,
      url: "https://example.com/reference",
      description: "Private reference",
      tags,
    },
  });
  expect(response.status()).toBe(201);
  return bookmarkResponseSchema.parse(await response.json());
}

test("AlertDialog identifies the bookmark, traps focus, cancels with Escape and reflows at 320px", async ({
  page,
}) => {
  await reader(page);
  const item = await bookmark(page, "Long bookmark ".repeat(13));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let native = 0;
  let deletes = 0;
  page.on("dialog", (dialog) => {
    native++;
    void dialog.dismiss();
  });
  await page.route(`**/api/bookmarks/${item.id}`, async (route) => {
    if (route.request().method() === "DELETE") deletes++;
    await route.continue();
  });
  await page.goto("/bookmarks");
  const trigger = page
    .getByRole("article", { name: item.title, exact: true })
    .getByRole("button", { name: "Delete", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Delete bookmark?" });
  await expect(dialog).toContainText(item.title);
  await expect(dialog).toContainText(item.url);
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  const destroy = dialog.getByRole("button", {
    name: "Delete bookmark",
    exact: true,
  });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(destroy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.height).toBeLessThanOrEqual(720);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await cancel.click();
  await expect(trigger).toBeFocused();
  expect(deletes).toBe(0);
  expect(native).toBe(0);
});

test("initial skeleton never announces empty; refresh retains nodes, geometry and recoverable errors inline", async ({
  page,
}) => {
  await reader(page);
  await bookmark(page, "Retained result");
  let held = gate();
  let fail = true;
  await page.route("**/api/bookmarks?**", async (route) => {
    await held.promise;
    if (fail)
      await route.fulfill({
        status: 503,
        json: { error: { message: "Unavailable" } },
      });
    else await route.continue();
  });
  await page.goto("/bookmarks");
  const results = page.getByRole("region", { name: "Bookmark results" });
  await expect(results).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("Loading bookmark cards")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toHaveCount(0);
  await expect(page.locator(".bookmark-update-label")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  held.release();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load your bookmarks",
  );
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const card = page.getByRole("article", { name: "Retained result" });
  await expect(card).toBeVisible();
  const node = await card.elementHandle();
  const before = await card.boundingBox();
  held = gate();
  fail = true;
  await page.getByRole("button", { name: "Refresh list" }).click();
  await expect(
    page.getByText("Updating bookmarks...", { exact: true }),
  ).toBeVisible();
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await card.boundingBox()).toEqual(before);
  held.release();
  await expect(page.getByRole("alert")).toContainText(
    "Showing previously loaded results",
  );
  await expect(card).toBeVisible();
  await expect(results).toHaveAttribute("aria-busy", "false");
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
});

test("the latest filter wins over an aborted older response without erasing prior results", async ({
  page,
}) => {
  await reader(page);
  await bookmark(page, "Alpha reference");
  await bookmark(page, "Beta reference");
  await page.goto("/bookmarks");
  await expect(page.getByRole("article")).toHaveCount(2);
  const held = gate();
  const started = gate();
  await page.route("**/api/bookmarks?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "missing") {
      started.release();
      await held.promise;
      await route
        .fulfill({ json: { items: [], hasMore: false } })
        .catch(() => undefined);
    } else await route.continue();
  });
  await page.getByLabel("Search", { exact: true }).fill("missing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await started.promise;
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByLabel("Search", { exact: true }).fill("Alpha");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  held.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("article", { name: "Alpha reference" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No matching bookmarks" }),
  ).toHaveCount(0);
});

test("delete is single-submit, preserves filters and returns the last-page item to the previous page", async ({
  page,
}) => {
  await reader(page);
  for (let index = 0; index < 41; index++)
    await bookmark(page, `Matching ${index}`);
  await page.goto("/bookmarks?q=Matching&tag=docs&offset=40");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Page 3", { exact: true })).toBeVisible();
  await page
    .getByRole("article")
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(
    `${origin}/bookmarks?q=Matching&tag=docs&offset=40`,
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  const held = gate();
  let deletes = 0;
  await page.route("**/api/bookmarks/*", async (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      await held.promise;
    }
    await route.continue();
  });
  await page
    .getByRole("article")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const action = page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete bookmark", exact: true });
  await action.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      element.click();
      element.click();
    }
  });
  await expect(
    page.getByRole("alertdialog").getByRole("button", { name: "Deleting..." }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("article", { includeHidden: true })
      .getByRole("button", { name: "Deleting...", includeHidden: true }),
  ).toBeDisabled();
  held.release();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue(
    "Matching",
  );
  await expect(page.getByLabel("Filter by tag", { exact: true })).toHaveValue(
    "docs",
  );
  await expect(
    page.getByText("Bookmark deleted.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeFocused();
  expect(deletes).toBe(1);
  // A subsequent deletion on a nonempty page must not jump back to page 1.
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete bookmark", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(19);
  await expect(
    page.getByRole("region", { name: "Bookmark results" }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    `${origin}/bookmarks?q=Matching&tag=docs&offset=20`,
  );
  expect(deletes).toBe(2);
});

test("closing a pending delete does not claim rollback or success after a lost response", async ({
  page,
}) => {
  await reader(page);
  const item = await bookmark(page, "Uncertain deletion");
  await page.goto("/bookmarks");
  const held = gate();
  const committed = gate();
  let deletes = 0;
  await page.route(`**/api/bookmarks/${item.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      await route.fetch();
      committed.release();
      await held.promise;
      await route.abort().catch(() => undefined);
    } else await route.continue();
  });
  const card = page.getByRole("article", { name: item.title });
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: "Delete bookmark", exact: true })
    .click();
  await committed.promise;
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeFocused();
  await expect(
    card.getByRole("button", { name: "Deleting..." }),
  ).toBeDisabled();
  held.release();
  await expect(page.getByRole("alert")).toContainText("couldn't confirm");
  await expect(card).toBeVisible();
  await expect(
    page.getByText("Bookmark deleted.", { exact: true }),
  ).toHaveCount(0);
  expect(deletes).toBe(1);
  await page.getByRole("button", { name: "Refresh list" }).click();
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("save keeps validated drafts on failure, guards double submits and returns to the filtered library with one toast", async ({
  page,
}) => {
  await reader(page);
  await page.goto(
    `/bookmarks/new?${new URLSearchParams({ returnTo: "/bookmarks?q=Draft&tag=docs" })}`,
  );
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Draft reference");
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://example.com/draft");
  await page.getByLabel("Tags (comma-separated)").fill("Docs");
  const held = gate();
  let writes = 0;
  let fail = true;
  await page.route("**/api/bookmarks", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      if (fail) {
        await held.promise;
        await route.fulfill({
          status: 500,
          json: { error: { message: "Could not save" } },
        });
        return;
      }
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Save bookmark" })
    .evaluate((element) => {
      if (element instanceof HTMLButtonElement) {
        element.click();
        element.click();
      }
    });
  await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
  await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  held.release();
  await expect(page.getByRole("alert")).toHaveText("Could not save");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Draft reference",
  );
  expect(writes).toBe(1);
  fail = false;
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page).toHaveURL(`${origin}/bookmarks?q=Draft&tag=docs`);
  const card = page.getByRole("article", { name: "Draft reference" });
  await expect(card).toBeVisible();
  await expect(page.getByText("Bookmark added.", { exact: true })).toHaveCount(
    1,
  );
  expect(writes).toBe(2);
  await card.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Description (optional)").fill("Saved description");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page).toHaveURL(`${origin}/bookmarks?q=Draft&tag=docs`);
  await expect(card).toContainText("Saved description");
  await expect(page.getByText("Bookmark saved.", { exact: true })).toHaveCount(
    1,
  );
});

test("edit skeleton/retry keeps unknown distinct from missing and old saves cannot affect another identity", async ({
  page,
}) => {
  await reader(page);
  const item = await bookmark(page, "Private A reference");
  const held = gate();
  let fail = true;
  await page.route(`**/api/bookmarks/${item.id}`, async (route) => {
    if (fail) {
      await held.promise;
      await route.fulfill({
        status: 503,
        json: { error: { message: "Unavailable" } },
      });
    } else await route.continue();
  });
  await page.goto(`/bookmarks/${item.id}/edit`);
  await expect(
    page.getByRole("region", { name: "Loading bookmark form" }),
  ).toBeVisible();
  await expect(
    page.getByText("Bookmark not found", { exact: true }),
  ).toHaveCount(0);
  held.release();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load the bookmark. Please try again.",
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    item.title,
  );
  await page.getByLabel("Title", { exact: true }).fill("Late private save");
  const release = gate();
  const started = gate();
  await page.unroute(`**/api/bookmarks/${item.id}`);
  await page.route(`**/api/bookmarks/${item.id}`, async (route) => {
    const response = await route.fetch();
    started.release();
    await release.promise;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await started.promise;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await reader(page);
  await page.goto("/bookmarks");
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  release.release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByText("Late private save", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Bookmark saved.", { exact: true })).toHaveCount(
    0,
  );
});
