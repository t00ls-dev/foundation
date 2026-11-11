const drawer = document.querySelector("#drawer");
const template = document.querySelector("#nav-template");
for (const id of ["desktop", "mobile"])
  document.getElementById(id).append(template.content.cloneNode(true));
const title = document.querySelector("#title");
const content = document.querySelector("#content");
const pages = {
  inicio: "Visão geral",
  membros: "Membros",
  igrejas: "Igrejas",
  equipe: "Equipe",
  atividades: "Atividades",
  configuracoes: "Configurações da igreja",
  conta: "Minha conta",
  senha: "Trocar senha",
  sair: "Sessão encerrada",
  ajuda: "Ajuda",
};
const churches = [
  { id: "esperanca", name: "Comunidade Esperança", initials: "CE" },
  { id: "jardim", name: "Comunidade Jardim", initials: "CJ" },
  { id: "central", name: "Comunidade Central", initials: "CC" },
];
let activeChurch = churches[0];
function updateIdentity() {
  document.querySelectorAll("[data-church-name]").forEach((element) => {
    element.textContent = activeChurch.name;
  });
  document.querySelectorAll("[data-church-initials]").forEach((element) => {
    element.textContent = activeChurch.initials;
  });
  for (const button of document.querySelectorAll("[data-switch-church]")) {
    const church = churches.find(
      (item) => item.id === button.dataset.switchChurch,
    );
    button.querySelector("[data-switch-name]").textContent = church.name;
    button.querySelector("[data-current-church]").hidden =
      church.id !== activeChurch.id;
    button.setAttribute("aria-pressed", String(church.id === activeChurch.id));
  }
  document.title = activeChurch.name + " · Gestão";
}
let current = "inicio";
let dirty = false;
let navigating = false;
document
  .querySelector("#open")
  .addEventListener("click", () => drawer.showModal());
document
  .querySelector("#close")
  .addEventListener("click", () => drawer.close());
drawer.addEventListener("click", (event) => {
  if (event.target === drawer) {
    const rect = drawer.getBoundingClientRect();
    if (event.clientX > rect.right || event.clientY > rect.bottom)
      drawer.close();
  }
});
drawer.addEventListener("close", () => {
  if (navigating) {
    title.focus();
    navigating = false;
  }
});
const desktop = matchMedia("(min-width: 901px)");
desktop.addEventListener("change", (event) => {
  if (event.matches && drawer.open) {
    drawer.close();
    (
      document.querySelector(`#desktop [data-page="${current}"]`) ?? title
    ).focus();
  }
});
function render(page) {
  current = page;
  dirty = false;
  title.textContent = pages[page];
  document.querySelectorAll("[data-page]").forEach((link) => {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  updateIdentity();
  if (page === "inicio")
    content.innerHTML =
      '<div class="grid"><article class="card">Membros cadastrados<strong class="metric">128</strong><p>Cadastros da organização.</p></article><article class="card">Igrejas<strong class="metric">3</strong><p>Unidades acompanhadas pela liderança.</p></article><article class="card">Equipe<strong class="metric">12</strong><p>Integrantes da equipe de gestão.</p></article></div><section class="feature"><h2>Gestão de membros</h2><p>Consulte os cadastros e acompanhe as informações dos membros da organização.</p><button class="primary" data-go="membros">Consultar membros</button></section><section class="card" style="margin-top:24px"><h2>Agenda da organização</h2><div class="row"><div><strong>Encontro da comunidade</strong><p>Encontro programado da organização.</p></div><small>Domingo · 10h</small></div><div class="row"><div><strong>Reunião da equipe</strong><p>Alinhamento da liderança.</p></div><small>Terça · 19h</small></div></section>';
  else if (page === "configuracoes") {
    content.innerHTML =
      '<section class="card"><h2>Dados da igreja</h2><p>Informações cadastrais da igreja.</p><form><label for="church-name">Nome da igreja</label><input id="church-name" name="name" maxlength="160" required><button class="primary">Salvar alterações</button><p class="status" role="status"></p></form></section>';
    const name = content.querySelector("input");
    name.value = activeChurch.name;
    name.addEventListener("input", () => {
      dirty = name.value !== activeChurch.name;
      name.setCustomValidity(
        name.value.trim() ? "" : "Informe o nome da igreja.",
      );
      content.querySelector(".status").textContent = "";
    });
    content.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      activeChurch.name = name.value.trim();
      name.value = activeChurch.name;
      updateIdentity();
      dirty = false;
      content.querySelector(".status").textContent =
        "Alterações salvas nesta demonstração.";
    });
  } else if (page === "conta") {
    content.innerHTML =
      '<section class="card account-card"><h2>Dados da conta</h2><p>Suas informações de acesso, independentes da igreja selecionada.</p><dl class="account-data"><dt>Nome</dt><dd>Ana Lima</dd><dt>E-mail</dt><dd>ana@example.com</dd></dl><button class="primary" data-go="senha">Trocar senha</button></section>';
  } else if (page === "senha") {
    content.innerHTML =
      '<section class="card account-card"><h2>Segurança da conta</h2><p>Demonstração do formulário. Use apenas valores fictícios; a senha não será alterada.</p><form><label for="current-password">Senha atual</label><input id="current-password" type="password" autocomplete="current-password" required><label for="new-password">Nova senha</label><input id="new-password" type="password" minlength="8" autocomplete="new-password" required aria-describedby="password-help"><p id="password-help">Use pelo menos 8 caracteres.</p><label for="confirm-password">Confirmar nova senha</label><input id="confirm-password" type="password" autocomplete="new-password" required><button class="primary">Alterar senha</button><p class="status" role="status"></p></form></section>';
    const form = content.querySelector("form");
    const password = content.querySelector("#new-password");
    const confirmation = content.querySelector("#confirm-password");
    form.addEventListener("input", () => {
      dirty = [...form.querySelectorAll("input")].some(
        (input) => input.value.length > 0,
      );
      confirmation.setCustomValidity(
        confirmation.value === password.value ? "" : "As senhas não coincidem.",
      );
      content.querySelector(".status").textContent = "";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      form.reset();
      dirty = false;
      content.querySelector(".status").textContent =
        "Simulação concluída. Nenhuma senha foi alterada.";
    });
  } else if (page === "sair") {
    content.innerHTML =
      '<section class="card account-card"><h2>Você saiu da demonstração</h2><p>Este preview não possui autenticação. Na aplicação, esta ação encerrará sua sessão.</p><button class="primary" data-go="inicio">Voltar à demonstração</button></section>';
  } else if (page === "ajuda")
    content.innerHTML =
      '<section class="card"><h2>Experimente a navegação</h2><p>Em telas estreitas, use o botão de navegação no canto superior esquerdo para abrir o painel. Feche com o botão, Escape ou toque fora.</p><p>Expanda Organização para acessar Equipe e Atividades. Em Configurações, edite o nome e tente sair antes de salvar.</p><p>Em telas largas, a lateral fica sempre disponível. Todos os dados desta demonstração são fictícios.</p></section>';
  else {
    const lists = {
      membros: [
        "Ana Oliveira",
        "Bruno Santos",
        "Carla Lima",
        "Daniel Costa",
        "Elisa Alves",
        "Felipe Souza",
        "Gabriela Rocha",
        "Hugo Ribeiro",
        "Isabela Martins",
        "João Pereira",
        "Larissa Melo",
        "Marcos Silva",
      ],
      igrejas: [
        "Comunidade Esperança",
        "Comunidade Jardim",
        "Comunidade Central",
      ],
      equipe: [
        "Acolhimento",
        "Administração",
        "Cuidado pastoral",
        "Comunicação",
      ],
      atividades: [
        "Encontro da comunidade",
        "Reunião da equipe",
        "Ação solidária",
      ],
    };
    content.innerHTML =
      '<section class="card">' +
      lists[page]
        .map(
          (name, i) =>
            `<div class="row"><span class="avatar">${name.slice(0, 1)}</span><div><strong>${name}</strong><p data-row-context>${page === "membros" ? "Pessoa da comunidade" : ""}</p></div><small>${i + 1}</small></div>`,
        )
        .join("") +
      "</section>";
  }
  if (page !== "membros")
    content.querySelectorAll("[data-row-context]").forEach((element) => {
      element.textContent = activeChurch.name;
    });
}
function navigate(page) {
  if (!Object.hasOwn(pages, page)) return;
  if (
    dirty &&
    !confirm("Há alterações não salvas. Deseja descartá-las e sair?")
  )
    return;
  if (document.querySelector("#user-menu").matches(":popover-open"))
    document.querySelector("#user-menu").hidePopover();
  history.pushState(null, "", "#" + page);
  render(page);
  if (drawer.open) {
    navigating = true;
    drawer.close();
  } else title.focus();
  window.scrollTo(0, 0);
}
document.addEventListener("pointerdown", (event) => {
  document.querySelectorAll(".switch-church[open]").forEach((element) => {
    if (event.target instanceof Node && !element.contains(event.target))
      element.open = false;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const opened = [...document.querySelectorAll(".switch-church[open]")].find(
    (element) => element.getBoundingClientRect().width > 0,
  );
  if (!opened) return;
  event.preventDefault();
  event.stopPropagation();
  opened.open = false;
  opened.querySelector("summary").focus();
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const churchButton = event.target.closest("[data-switch-church]");
  if (churchButton) {
    const selected = churches.find(
      (church) => church.id === churchButton.dataset.switchChurch,
    );
    if (
      !selected ||
      (dirty && !confirm("Descartar alterações não salvas e trocar de igreja?"))
    )
      return;
    dirty = false;
    activeChurch = selected;
    document.querySelectorAll(".switch-church").forEach((element) => {
      element.open = false;
    });
    navigate("inicio");
    return;
  }
  const link = event.target.closest("[data-page], [data-go]");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate(link.dataset.page ?? link.dataset.go);
});
window.addEventListener("popstate", () => {
  const page = location.hash.slice(1);
  if (dirty && !confirm("Descartar alterações não salvas?")) {
    history.pushState(null, "", "#" + current);
    return;
  }
  render(Object.hasOwn(pages, page) ? page : "inicio");
  if (drawer.open) {
    navigating = true;
    drawer.close();
  } else title.focus();
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
render(
  Object.hasOwn(pages, location.hash.slice(1))
    ? location.hash.slice(1)
    : "inicio",
);
