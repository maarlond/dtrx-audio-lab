"use strict";

(() => {
  const routes = new Set([
    "home",
    "library",
    "favorites",
    "experiences",
    "headphone-test",
    "drop-zone",
  ]);
  const routeFromHash = () => {
    if (location.hash.startsWith("#track/")) return "library";
    const route = location.hash.slice(1);
    return routes.has(route) ? route : "home";
  };
  let current = "";
  function navigate() {
    const route = routeFromHash();
    document.body.dataset.view = route;
    const libraryTitle = document.getElementById("library-title");
    const libraryDescription = document.getElementById("library-description");
    const libraryHeading = document.getElementById("library-heading-label");
    if (route === "favorites") libraryTitle.textContent = "Favoritos";
    else if (!libraryTitle.querySelector("em"))
      libraryTitle.innerHTML = "DTRX<br><em>Biblioteca</em>";
    if (libraryDescription)
      libraryDescription.textContent = route === "favorites"
        ? "Faixas salvas nos favoritos deste dispositivo."
        : "Músicas autorais do DTRX. Áudio, capas e informações aparecem conforme são adicionados ao catálogo.";
    if (libraryHeading)
      libraryHeading.textContent = route === "favorites"
        ? "Faixas favoritas"
        : "Todas as faixas";
    document
      .querySelectorAll("body > .section .section-inner.reveal")
      .forEach((section) => {
        const id = section.closest("section")?.id;
        if (
          id === route ||
          (route === "home" && id === "recent-releases") ||
          (route === "favorites" && id === "library")
        )
          section.classList.add("is-visible");
      });
    document
      .querySelectorAll(".header-nav .nav-link, .mobile-nav a")
      .forEach((link) => {
        const active = link.getAttribute("href") === `#${route}`;
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    if (route !== current) {
      current = route;
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    window.dispatchEvent(new Event("dtrx-view-change"));
  }
  window.addEventListener("hashchange", navigate);
  navigate();
})();
