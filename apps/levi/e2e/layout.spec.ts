import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { readyAccount, provision, showOrganizations } from "./helpers.js";

const churchName =
  "Igreja sintética de layout com um nome institucional longo para telas estreitas";

async function openChurch(page: Page) {
  await readyAccount(page);
  await provision(page, churchName);
  await showOrganizations(page);
  await page
    .getByRole("button", { name: `Acessar igreja ${churchName}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Igreja selecionada", exact: true }),
  ).toBeVisible();
}

async function expectReflow(page: Page, label: string) {
  for (const fontSize of ["100%", "200%"]) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${label} / ${fontSize}`,
    ).toBe(true);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  // A navegação fixa nunca cobre o fim do conteúdo principal.
  const covered = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar || getComputedStyle(sidebar).position !== "fixed")
      return false;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const main = document.querySelector("main")!.getBoundingClientRect();
    return main.bottom > sidebar.getBoundingClientRect().top + 1;
  });
  expect(covered, `${label}: navegação sobre o conteúdo`).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect((await new AxeBuilder({ page }).analyze()).violations, label).toEqual(
    [],
  );
}

test("layout: telas principais sem overflow, com contraste nos modos claro e escuro", async ({
  page,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await openChurch(page);
  const nav = page.getByRole("navigation", { name: "Navegação da igreja" });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await nav.getByRole("link", { name: "Início", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Visão geral", exact: true }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / painel`);

    await nav.getByRole("link", { name: "Membros", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Gestão de membros" }),
    ).toHaveAttribute("aria-busy", "false");
    await expectReflow(page, `${colorScheme} / membros`);

    await page
      .getByRole("button", { name: "Cadastrar membro", exact: true })
      .click();
    await page
      .getByLabel("Nome (obrigatório)", { exact: true })
      .fill(`Pessoa sintética de layout ${colorScheme}`);
    await page.getByLabel("Nome (obrigatório)", { exact: true }).blur();
    await expectReflow(page, `${colorScheme} / cadastro`);
    await page
      .getByRole("button", { name: "Salvar membro", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ficha do membro", exact: true }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / ficha`);

    await page
      .getByRole("link", { name: "Voltar aos membros", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: `Consultar ficha de Pessoa sintética de layout ${colorScheme}`,
        exact: true,
      }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / lista`);

    await nav.getByRole("link", { name: "Igrejas", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Igreja selecionada", exact: true }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / igrejas`);

    await page
      .getByRole("link", { name: "Gerenciar acessos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pessoas com acesso ao Levi" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revogar acesso", exact: true }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / acessos`);

    await page
      .getByRole("link", { name: "Editar igreja", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Editar igreja", exact: true }),
    ).toBeVisible();
    await expectReflow(page, `${colorScheme} / editar igreja`);
  }
});

test("layout: menu Mais fecha com Escape, toque fora e saída do foco", async ({
  page,
}) => {
  await openChurch(page);
  const menu = page.locator(".navigation-more");
  const summary = menu.locator("summary");
  const switchLink = page.getByRole("link", {
    name: "Trocar igreja",
    exact: true,
  });
  await summary.click();
  await expect(switchLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(switchLink).toBeHidden();
  await expect(summary).toBeFocused();

  await summary.click();
  await expect(switchLink).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(switchLink).toBeHidden();

  await summary.click();
  await expect(
    menu.getByRole("link", { name: "Configurar senha", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "Sair", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Início", exact: true }).focus();
  await expect(switchLink).toBeHidden();
});

test("layout: barra inferior recua enquanto um campo de texto está em foco", async ({
  page,
}) => {
  await openChurch(page);
  const sidebar = page.locator(".sidebar");
  test.skip(
    (await sidebar.evaluate(
      (element) => getComputedStyle(element).position,
    )) !== "fixed",
    "Somente a navegação inferior recua.",
  );
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Nenhum membro cadastrado.", { exact: true }),
  ).toBeVisible();
  const search = page.getByLabel("Nome", { exact: true });
  await search.focus();
  await expect(search).toBeFocused();
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  await search.blur();
  await expect(sidebar).toHaveCSS("visibility", "visible");
  await expect(
    page.getByRole("navigation", { name: "Navegação da igreja" }),
  ).toBeVisible();
});
