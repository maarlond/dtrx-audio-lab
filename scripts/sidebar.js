"use strict";

(() => {
  const storageKey = "dtrx-sidebar-collapsed";
  const root = document.documentElement;
  try {
    root.classList.toggle(
      "sidebar-collapsed",
      localStorage.getItem(storageKey) === "1",
    );
  } catch {
    /* Storage may be unavailable. */
  }

  function init() {
    const toggle = document.getElementById("sidebar-toggle");
    const tooltip = document.getElementById("sidebar-tooltip");
    const status = document.getElementById("audio-engine-status");
    const statusLabel = document.getElementById("audio-engine-label");
    const audio = document.getElementById("library-audio");
    const desktop = matchMedia("(min-width: 1000px)");
    if (!toggle || !tooltip || !status || !statusLabel || !audio) return;

    const release = document.getElementById("sidebar-release");
    const featured =
      window.DTRX_CATALOG?.find((track) => track.featured) ||
      window.DTRX_CATALOG?.[0];
    if (release) {
      if (featured) {
        release.href = `#track/${encodeURIComponent(featured.id)}`;
        release.setAttribute("aria-label", `Ver lançamento ${featured.title}`);
        document.getElementById("sidebar-release-title").textContent =
          featured.title;
      } else release.hidden = true;
    }

    const isCollapsed = () =>
      desktop.matches && root.classList.contains("sidebar-collapsed");
    const hideTooltip = () => {
      tooltip.hidden = true;
    };
    const syncToggle = () => {
      const collapsed = root.classList.contains("sidebar-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute(
        "aria-label",
        collapsed ? "Expandir menu" : "Recolher menu",
      );
      hideTooltip();
    };
    toggle.addEventListener("click", () => {
      const collapsed = root.classList.toggle("sidebar-collapsed");
      try {
        localStorage.setItem(storageKey, collapsed ? "1" : "0");
      } catch {
        /* Keep the current session usable. */
      }
      syncToggle();
    });
    syncToggle();

    const updateStatus = () => {
      const supported = typeof window.AudioContext === "function";
      const playing =
        supported && !audio.paused && !audio.ended && !audio.error;
      const message = !supported
        ? "Web Audio · Indisponível"
        : playing
          ? "Web Audio · Em reprodução"
          : "Web Audio · Pronto";
      statusLabel.textContent = message;
      status.setAttribute("aria-label", `Status do motor de áudio: ${message}`);
      status.classList.toggle("is-playing", playing);
      status.classList.toggle("is-unavailable", !supported);
    };
    ["play", "pause", "ended", "error", "emptied"].forEach((event) =>
      audio.addEventListener(event, updateStatus),
    );
    updateStatus();

    const tooltipTargets = [
      ...document.querySelectorAll(
        "#sidebar-navigation .nav-link, #sidebar-navigation .nav-cta",
      ),
      status,
    ];
    for (const target of tooltipTargets) {
      const label =
        target === status
          ? () => statusLabel.textContent
          : () => target.textContent.trim();
      if (target !== status) target.setAttribute("aria-label", label());
      const show = () => {
        if (!isCollapsed()) return;
        tooltip.textContent = label();
        tooltip.hidden = false;
        const rect = target.getBoundingClientRect();
        tooltip.style.left = `${Math.round(rect.right + 14)}px`;
        tooltip.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - tooltip.offsetHeight - 8, rect.top + (rect.height - tooltip.offsetHeight) / 2)))}px`;
      };
      target.addEventListener("mouseenter", show);
      target.addEventListener("mouseleave", hideTooltip);
      target.addEventListener("focus", show);
      target.addEventListener("blur", hideTooltip);
    }
    desktop.addEventListener("change", hideTooltip);
    window.addEventListener("scroll", hideTooltip, { passive: true });
    window.addEventListener("resize", hideTooltip);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
