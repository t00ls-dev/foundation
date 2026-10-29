import { test, expect } from "@playwright/test";
import { readyAccount, provision, showOrganizations } from "./helpers.js";

test("Vite e Hono completam o fluxo real em mesma origem, sem liberar CORS", async ({
  page,
  context,
}) => {
  await readyAccount(page);
  await provision(page, "Organização pelo proxy");
  await showOrganizations(page);
  await page
    .getByRole("button", {
      name: "Acessar organização Organização pelo proxy",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();
  await expect(
    page.getByText("Primeira igreja sintética", { exact: true }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.httpOnly && cookie.name.includes("session_token"),
    ),
  ).toBe(true);
  const response = await context.request.post("/api/tenant", {
    headers: { Origin: "https://malicioso.example" },
    data: { organizationId: "11111111-1111-4111-8111-111111111111" },
  });
  expect(response.status()).toBe(403);
  const unknown = await context.request.get("/api/nao-existe");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["content-type"]).toContain("application/json");
});
