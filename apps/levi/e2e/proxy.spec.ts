import { test, expect } from "@playwright/test";
import { readyAccount, provision, showOrganizations } from "./helpers.js";

test("Vite e Hono completam o fluxo real em mesma origem, sem liberar CORS", async ({
  page,
  context,
}) => {
  await readyAccount(page);
  await provision(page, "Igreja pelo proxy");
  await showOrganizations(page);
  await page
    .getByRole("button", {
      name: "Acessar igreja Igreja pelo proxy",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Igreja selecionada" }),
  ).toBeVisible();
  await expect(
    page.getByText("Igreja pelo proxy", { exact: true }).first(),
  ).toBeVisible();
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.httpOnly && cookie.name.includes("session_token"),
    ),
  ).toBe(true);
  const response = await context.request.post("/api/context/church", {
    headers: { Origin: "https://malicioso.example" },
    data: { churchId: "11111111-1111-4111-8111-111111111111" },
  });
  expect(response.status()).toBe(403);
  const unknown = await context.request.get("/api/nao-existe");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["content-type"]).toContain("application/json");
});
