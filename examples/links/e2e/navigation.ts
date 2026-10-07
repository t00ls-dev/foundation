import { expect, type Page } from "@playwright/test";

export async function openNavigation(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Open navigation menu",
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await trigger.isVisible()) ||
        (await page
          .getByRole("navigation", { name: "Account navigation" })
          .getByRole("link", { name: "Account", exact: true })
          .isVisible()),
    )
    .toBe(true);
  if (await trigger.isVisible()) {
    if ((await trigger.getAttribute("aria-expanded")) === "false")
      await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  }
}
