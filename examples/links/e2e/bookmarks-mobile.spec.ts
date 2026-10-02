import { expect, test } from "@playwright/test";
import { z } from "zod";

test("compact header and bookmark layouts preserve targets and long content at 320px, mobile and desktop", async ({
  page,
}) => {
  const name = "W".repeat(200);
  const userId = "f6b267ef-d429-47d5-8a47-e18b49621881";
  const bookmark = {
    id: "873e3c4d-51a1-416d-bd86-4b1f2ac2d5ec",
    title: "T".repeat(200),
    url: `https://example.com/${"x".repeat(2028)}`,
    description: "D".repeat(2000),
    tags: Array.from({ length: 10 }, (_, index) => `${index}${"t".repeat(39)}`),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: {
          id: userId,
          name,
          email: "reader@example.com",
          emailVerified: true,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        },
        session: {
          id: "mobile-fixture",
          userId,
          token: "fixture-only",
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        },
      },
    }),
  );
  await page.route("**/api/bookmarks?*", (route) =>
    route.fulfill({ json: { items: [bookmark], hasMore: false } }),
  );
  await page.route(`**/api/bookmarks/${bookmark.id}`, (route) =>
    route.fulfill({ json: bookmark }),
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/bookmarks");
    const card = page.getByRole("article", {
      name: bookmark.title,
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(card.locator(".bookmark-url")).toHaveText(bookmark.url);
    await expect(card.locator(".bookmark-description")).toHaveText(
      bookmark.description,
    );
    await expect(
      card.getByRole("list", { name: "Tags" }).locator("li"),
    ).toHaveCount(10);
    await expect(page.locator(".account > span")).toHaveText(name);
    await expect(page.locator(".account > span")).toHaveAttribute(
      "title",
      name,
    );
    if (width === 320)
      await page
        .locator(".app-header, .bookmark-library .search")
        .evaluateAll((elements) => {
          // Exercise wider fallback-font metrics, not just this host's system-ui.
          for (const element of elements) {
            const target = element as HTMLElement;
            target.style.fontFamily = "Arial, sans-serif";
            target.style.letterSpacing = "1.5px";
          }
        });
    const header = await page.locator(".app-header").boundingBox();
    expect(header!.height).toBeLessThanOrEqual(width < 896 ? 112 : 80);
    if (width === 320)
      expect(
        (await page
          .getByRole("form", { name: "Search bookmarks" })
          .boundingBox())!.height,
      ).toBeLessThanOrEqual(190);
    for (const control of await page
      .locator(
        "header a, header button, .bookmark-library a, .bookmark-library button",
      )
      .all()) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    const bookmarksLink = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Bookmarks", exact: true });
    await expect(bookmarksLink).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "Add bookmark", exact: true }),
    ).toHaveAttribute("href", "/bookmarks/new");
    await bookmarksLink.focus();
    await expect(bookmarksLink).toHaveCSS("outline-width", "3px");
    await expect(
      page.getByRole("link", { name: "Account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    if (width === 320 || width === 1280)
      await page.screenshot({
        path: test.info().outputPath(`bookmarks-${width}.png`),
      });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.goto(`/bookmarks/${bookmark.id}/edit`);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      bookmark.title,
    );
    const save = page.getByRole("button", {
      name: "Save bookmark",
      exact: true,
    });
    const cancel = page.getByRole("link", { name: "Cancel", exact: true });
    const saveBox = (await save.boundingBox())!;
    const cancelBox = (await cancel.boundingBox())!;
    expect(saveBox.height).toBeGreaterThanOrEqual(44);
    expect(cancelBox.height).toBeGreaterThanOrEqual(44);
    expect(
      saveBox.y + saveBox.height <= cancelBox.y ||
        saveBox.x + saveBox.width <= cancelBox.x,
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

test("bookmark CRUD, search, tag and clear filters remain usable at 320px with real D1", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const origin = "http://127.0.0.1:5174";
  const email = `mobile-bookmarks-${crypto.randomUUID()}@example.com`;
  const password = "correct-horse-battery-staple";
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { name: "Mobile Reader", email, password },
      })
    ).status(),
  ).toBe(200);
  const message = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email })}`,
  );
  const verification = z
    .object({ text: z.string().url() })
    .parse(await message.json());
  expect((await page.request.get(verification.text)).ok()).toBe(true);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Save your first bookmark to get started."),
  ).toBeVisible();
  async function create(title: string, tags: string) {
    await page.getByRole("link", { name: "Add bookmark", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page
      .getByLabel("URL", { exact: true })
      .fill("https://example.com/reference");
    await page.getByLabel("Tags (comma-separated)").fill(tags);
    await page
      .getByRole("button", { name: "Save bookmark", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: title, exact: true }),
    ).toBeVisible();
  }
  await create("Foundation docs", "Docs, Work");
  await create("Other bookmark", "Personal");
  await page.getByLabel("Search", { exact: true }).fill("Foundation");
  await page.getByLabel("Filter by tag", { exact: true }).fill("DOCS");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  const selected = page.getByRole("article", {
    name: "Foundation docs",
    exact: true,
  });
  await expect(selected).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Filter by tag", { exact: true })).toHaveValue(
    "",
  );
  await selected.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Updated bookmark");
  await page
    .getByRole("button", { name: "Save bookmark", exact: true })
    .click();
  const updated = page.getByRole("article", {
    name: "Updated bookmark",
    exact: true,
  });
  await expect(updated).toBeVisible();
  await page.reload();
  await expect(updated).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await updated.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(updated).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Other bookmark", exact: true }),
  ).toBeVisible();
});
