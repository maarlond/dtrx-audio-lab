+"use strict";
(() => {
  const collections = window.DTRX_SUNO_COLLECTIONS || [];
  const grid = document.getElementById("track-grid");
  if (!grid || !collections.length) return;
  const host = document.createElement("section");
  host.className = "suno-collections";
  host.innerHTML =
    '<p class="featured-kicker">COLEÇÕES SUNO</p><div class="suno-collection-grid"></div><div class="suno-collection-tracks" hidden></div>';
  grid.after(host);
  const cards = host.querySelector(".suno-collection-grid"),
    list = host.querySelector(".suno-collection-tracks");
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const catalog = window.DTRX_CATALOG || [];
  const render = (c) => {
    list.hidden = false;
    list.innerHTML =
      '<div class="library-heading"><span>' +
      esc(c.name) +
      '</span><button type="button" class="collection-close">Fechar</button></div><div class="suno-track-list">' +
      c.tracks
        .map((t) => {
          const local = catalog.find((x) => x.sunoId === t.sunoId);
          return (
            '<article class="suno-track"><div class="suno-track__art">' +
            (local?.coverUrl
              ? '<img src="' + esc(local.coverUrl) + '" alt="">'
              : "<span>DTRX</span>") +
            "</div><div><strong>" +
            esc(t.title) +
            "</strong><small>" +
            (local?.audioUrl
              ? "Disponível no DTRX"
              : t.visibility === "private"
                ? "Faixa privada no Suno"
                : "Disponível no Suno") +
            "</small></div>" +
            (local?.audioUrl
              ? '<button type="button" data-action="play" data-id="' +
                esc(local.id) +
                '">Ouvir</button>'
              : t.visibility === "private"
                ? '<span class="suno-track__unavailable">Sem áudio público</span>'
                : '<a target="_blank" rel="noopener" href="' +
                  esc(t.songUrl) +
                  '">Ouvir no Suno</a>') +
            "</article>"
          );
        })
        .join("") +
      "</div>";
    list.querySelector(".collection-close").onclick = () =>
      (list.hidden = true);
  };
  collections.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suno-collection";
    const first = c.tracks[0];
    b.innerHTML =
      (first?.coverUrl
        ? '<img src="' + esc(first.coverUrl) + '" alt="">'
        : "<span>DTRX</span>") +
      "<strong>" +
      esc(c.name.replace("DTRX | ", "")) +
      "</strong><small>" +
      c.tracks.length +
      " músicas</small>";
    b.onclick = () => render(c);
    cards.append(b);
  });
})();
