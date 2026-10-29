document.querySelectorAll(".simulate").forEach((form) =>
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    form.querySelector(".feedback").textContent = "Processando demonstração…";
    setTimeout(() => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      form.querySelector(".feedback").textContent =
        "Simulação concluída. Nenhum dado foi enviado ou salvo.";
    }, 700);
  }),
);
const search = document.querySelector("#search");
if (search)
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    let count = 0;
    document.querySelectorAll("[data-member]").forEach((row) => {
      row.hidden = !(
        row.dataset.member.includes(
          document.querySelector("#busca").value.toLowerCase(),
        ) &&
        (!document.querySelector("#situacao").value ||
          row.dataset.status === document.querySelector("#situacao").value)
      );
      if (!row.hidden) count++;
    });
    document.querySelector("#resultado").textContent =
      count + " registros encontrados";
    document.querySelector("#empty").hidden = count !== 0;
  });
if (location.search === "?editar=1") {
  document.querySelector("h1").textContent = "Editar cadastro";
  document.title = "Editar cadastro · Levi";
  document.querySelector("input").value = "Ana Exemplo";
  ["church", "status"].forEach((id) => {
    document.getElementById(id).disabled = true;
  });
}
