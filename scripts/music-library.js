"use strict";

(() => {
  const tracks = window.DTRX_CATALOG || [];
  const favoritesKey = "dtrx-library-favorites";
  const favorites = new Set(
    JSON.parse(localStorage.getItem(favoritesKey) || "[]"),
  );
  let selected = null;
  let filter = "";
  let genre = "all";
  let libraryView = "all";
  let audioContext,
    analyser,
    source,
    visualizerFrame = 0,
    repeatEnabled = false,
    heroParallaxFrame = 0;
  let mobileArtObserver,
    mobileArtPast = false,
    mobileDockActive = false;
  const levels = { bass: 0, mid: 0, high: 0 };
  const planetLevels = { bass: 0, mid: 0, high: 0, beat: 0 };
  let planetRmsAverage = 0;
  const planetBars = new Float32Array(48);
  const mobileBarPeaks = new Float32Array(48);
  const mobileBarDisplay = new Float32Array(48);
  let mobileLoudness = 0;
  const desktopPlanetBars = new Float32Array(52);
  const nowPlayingBands = new Float32Array(64);
  const nowPlayingRaw = new Float32Array(64);
  let nowPlayingPeak = 0.18;
  let desktopRms = 0;
  let desktopBassMean = 0;
  let desktopBeat = 0;
  const adaptive = {
    bass: { peak: 0.14, floor: 0 },
    mid: { peak: 0.14, floor: 0 },
    high: { peak: 0.14, floor: 0 },
  };
  let previousBass = 0,
    beatPulse = 0;
  let shuffleEnabled = false;
  const $ = (id) => document.getElementById(id);
  const audio = $("library-audio");
  audio.volume = Number($("player-volume").value);
  $("now-playing-volume").value = String(audio.volume);
  let lyricLines = [],
    lyricRequest = 0,
    activeLyricIndex = -1;
  const debugAudio =
    new URLSearchParams(location.search).get("debugAudio") === "1";
  const debugPanel = debugAudio
    ? document.body.appendChild(
        Object.assign(document.createElement("output"), {
          className: "audio-debug",
          role: "status",
        }),
      )
    : null;
  if (debugPanel)
    debugPanel.textContent =
      "Áudio: pausado | Contexto: não criado\nReproduza uma faixa para inspecionar as frequências reais";
  let debugLast = 0,
    debugFrames = 0,
    debugFps = 0;
  const escaped = (value) =>
    String(value).replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const available = (track) => Boolean(track.audioUrl);
  const artistLabel = (track) =>
    track.artist?.trim() || "DTRX";
  const genreLabel = (track) => track.genre?.trim() || "Não informado";
  const cover = (track) =>
    track.coverUrl
      ? `<img src="${escaped(track.coverUrl)}" alt="Capa de ${escaped(track.title)}">`
      : `<span aria-hidden="true">DTRX</span>`;
  const status = (track) =>
    available(track) ? "Disponível para ouvir" : "Áudio ainda não adicionado";
  const playGlyph =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
  const pauseGlyph =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14"/></svg>';
  function syncCardPlayback() {
    document
      .querySelectorAll(".track-card[data-track-id]")
      .forEach((card) =>
        card.classList.toggle(
          "is-playing",
          !audio.paused && selected?.id === card.dataset.trackId,
        ),
      );
    document
      .querySelectorAll('[data-action="play"][data-id]')
      .forEach((button) => {
        if (button.disabled) return;
        const track = tracks.find((item) => item.id === button.dataset.id);
        const playing = !audio.paused && selected?.id === track?.id;
        button.textContent = playing
          ? "Pausar"
          : button.closest("#home, #track-dialog")
            ? "Ouvir lançamento"
            : "Ouvir";
        button.setAttribute(
          "aria-label",
          `${playing ? "Pausar" : "Ouvir"} ${track?.title || "faixa"}`,
        );
      });
  }
  function saveFavorites() {
    localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
  }
  function updatePlayerFavorite() {
    if (!selected) return;
    const active = favorites.has(selected.id);
    for (const id of ["player-favorite", "now-playing-favorite"]) {
      $(id).setAttribute("aria-pressed", String(active));
      $(id).setAttribute(
        "aria-label",
        `${active ? "Remover" : "Adicionar"} ${selected.title} ${active ? "dos" : "aos"} favoritos`,
      );
    }
  }
  function card(track, featured = false) {
    const isFavorite = favorites.has(track.id);
    return `<article class="track-card ${featured ? "track-card--featured" : ""} ${available(track) ? "" : "is-unavailable"} ${selected?.id === track.id && !audio.paused ? "is-playing" : ""}" data-track-id="${track.id}"><div class="track-cover">${cover(track)}</div><div class="track-card__body"><span class="track-state">${status(track)}</span><h3>${escaped(track.title)}</h3><p>${escaped(artistLabel(track))}${track.genre ? ` · ${escaped(track.genre)}` : ""}</p><div class="track-card__actions"><button type="button" data-action="play" data-id="${track.id}" ${available(track) ? "" : "disabled"}>${available(track) ? "Ouvir" : "Sem áudio"}</button><button type="button" class="icon-button" data-action="favorite" data-id="${track.id}" aria-label="${isFavorite ? "Remover" : "Adicionar"} ${escaped(track.title)} ${isFavorite ? "dos" : "aos"} favoritos" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button><a href="#track/${track.id}" data-action="details" data-id="${track.id}">Detalhes</a></div></div></article>`;
  }
  function render() {
    const shown = tracks.filter(
      (t) =>
        (libraryView !== "favorites" || favorites.has(t.id)) &&
        (genre === "all" || t.genre === genre) &&
        `${t.title} ${t.artist} ${t.genre}`.toLowerCase().includes(filter),
    );
    $("track-grid").innerHTML = shown.map((track) => card(track)).join("");
    $("recent-grid").innerHTML = tracks
      .filter(
        (track) =>
          track.id !== (tracks.find((item) => item.featured) || tracks[0])?.id,
      )
      .slice(0, 3)
      .map((track) => card(track))
      .join("");
    $("track-count").textContent =
      `${shown.length} ${shown.length === 1 ? "faixa" : "faixas"}`;
    $("library-empty").hidden = shown.length > 0;
    $("library-empty").textContent =
      libraryView === "favorites"
        ? genre !== "all" || filter
          ? "Nenhuma faixa favorita corresponde aos filtros."
          : "Nenhum favorito ainda. Salve uma faixa da biblioteca."
        : "Nenhuma faixa encontrada para esta busca.";
    const featured = tracks.find((t) => t.featured) || tracks[0];
    const home = $("home-feature");
    const titleParts = featured ? escaped(featured.title).split(" ") : [];
    const heroTitle =
      titleParts.length > 1
        ? `${titleParts.slice(0, -1).join(" ")}<br>${titleParts.at(-1)}`
        : titleParts[0];
    if (home && featured)
      home.innerHTML = `<p class="hero-eyebrow">LANÇAMENTO EM DESTAQUE</p><div class="release-hero__layout"><div class="release-hero__title"><p class="hero-eyebrow hero-eyebrow--desktop">LANÇAMENTO EM DESTAQUE</p><p class="release-hero__artist">${escaped(artistLabel(featured))}</p><h1 class="hero-title">${heroTitle}</h1><p class="hero-subtitle">Gênero: ${escaped(genreLabel(featured))}</p><div class="hero-ctas"><button class="btn btn-primary" type="button" data-action="play" data-id="${featured.id}" ${available(featured) ? "" : "disabled"}>${available(featured) ? "Ouvir lançamento" : "Áudio indisponível"}</button><a class="btn btn-ghost" href="#track/${featured.id}">Ver lançamento</a></div></div><div class="release-hero__cover" aria-hidden="true"><div class="release-hero__planet"></div><div class="release-hero__atmosphere"></div><div class="release-hero__stars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><canvas id="hero-mini-visualizer"></canvas></div></div>`;
    $("featured-track").innerHTML = featured
      ? `<p class="featured-kicker">Lançamento em destaque</p>${card(featured, true)}`
      : "";
    const genres = [...new Set(tracks.map((t) => t.genre).filter(Boolean))];
    $("genre-filters").innerHTML = ["all", ...genres]
      .map(
        (g) =>
          `<button class="genre-filter ${genre === g ? "is-active" : ""}" data-genre="${escaped(g)}" aria-pressed="${genre === g}">${g === "all" ? "Todos os lançamentos" : escaped(g)}</button>`,
      )
      .join("");
    syncCardPlayback();
    requestHeroParallax();
    observeMobileArt();
  }
  function syncMobileDock() {
    const dock = $("mobile-visualizer-dock");
    const mobile = innerWidth <= 768;
    dock.classList.toggle("is-paused", audio.paused);
    dock.hidden = !mobile || !selected || !available(selected);
    if (dock.hidden) {
      mobileDockActive = false;
      document.body.classList.remove("has-mobile-visualizer-dock");
      return;
    }
    const headerHeight = document
      .querySelector(".site-header")
      .getBoundingClientRect().height;
    dock.style.setProperty("--mobile-header-height", `${headerHeight}px`);
    const onHome = !location.hash || location.hash === "#home";
    mobileDockActive =
      !document.hidden &&
      !$("now-playing-dialog").open &&
      !$("track-dialog").open &&
      (!onHome || mobileArtPast);
    dock.classList.toggle("is-active", mobileDockActive);
    document.body.classList.toggle(
      "has-mobile-visualizer-dock",
      mobileDockActive,
    );
  }
  function observeMobileArt() {
    mobileArtObserver?.disconnect();
    const art = document.querySelector("#home .release-hero__cover");
    if (!art || innerWidth > 768 || !("IntersectionObserver" in window)) {
      syncMobileDock();
      return;
    }
    const headerHeight = document
      .querySelector(".site-header")
      .getBoundingClientRect().height;
    mobileArtPast = art.getBoundingClientRect().bottom <= headerHeight;
    mobileArtObserver = new IntersectionObserver(
      ([entry]) => {
        mobileArtPast =
          !entry.isIntersecting &&
          entry.boundingClientRect.bottom <= headerHeight + 1;
        syncMobileDock();
      },
      { rootMargin: `-${Math.ceil(headerHeight)}px 0px 0px 0px`, threshold: 0 },
    );
    mobileArtObserver.observe(art);
    syncMobileDock();
  }
  function updateHeroParallax() {
    heroParallaxFrame = 0;
    const art = document.querySelector(".release-hero__cover");
    if (!art) return;
    const active =
      document.body.dataset.view === "home" &&
      innerWidth <= 760 &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const offset = active
      ? Math.min(
          42,
          Math.max(
            0,
            (document.querySelector(".site-header").offsetHeight -
              $("home").getBoundingClientRect().top) *
              0.2,
          ),
        )
      : 0;
    art.style.setProperty("--hero-parallax", `${offset.toFixed(1)}px`);
    if (innerWidth <= 768) syncMobileDock();
  }
  function requestHeroParallax() {
    if (!heroParallaxFrame)
      heroParallaxFrame = requestAnimationFrame(updateHeroParallax);
  }
  function select(track, autoplay = false) {
    if (selected?.id !== track.id) {
      nowPlayingBands.fill(0);
      nowPlayingPeak = 0.18;
    }
    selected = track;
    $("persistent-player").hidden = false;
    $("player-title").textContent = track.title;
    syncMobileDock();
    document.body.classList.add("has-music-player");
    $("now-playing-empty").hidden = true;
    $("now-playing-content").hidden = false;
    updatePlayerFavorite();
    $("player-artist").textContent = artistLabel(track);
    syncCardPlayback();
    $("now-playing-title").textContent = track.title;
    $("now-playing-artist").textContent = artistLabel(track);
    $("now-playing-genre").textContent = genreLabel(track);
    $("now-playing-mini-title").textContent = track.title;
    $("now-playing-mini-artist").textContent = artistLabel(track);
    $("now-playing-mini-time").textContent = `0:00 / ${format(track.duration)}`;
    $("player-expand").innerHTML = cover(track);
    const nowPlayingArt = $("now-playing-art");
    nowPlayingArt.innerHTML = cover(track);
    nowPlayingArt.style.setProperty(
      "--now-cover-image",
      track.coverUrl ? `url(${JSON.stringify(track.coverUrl)})` : "none",
    );
    $("now-playing-elapsed").textContent = "0:00";
    $("now-playing-duration").textContent = format(track.duration);
    $("now-playing-progress").value = 0;
    $("now-playing-progress").style.setProperty("--seek-progress", "0%");
    loadLyrics(track);
    $("player-toggle").disabled = !available(track);
    $("player-progress").disabled = !available(track);
    $("player-progress").value = 0;
    $("player-progress").style.setProperty("--seek-progress", "0%");
    $("player-progress").setAttribute(
      "aria-valuetext",
      `0:00 de ${format(track.duration)}`,
    );
    $("now-playing-toggle").disabled = !available(track);
    $("now-playing-progress").disabled = !available(track);
    $("player-time").textContent = `0:00 / ${format(track.duration)}`;
    $("player-mobile-time").textContent = `0:00 / ${format(track.duration)}`;
    if (!available(track)) return;
    if (audio.src !== new URL(track.audioUrl, location.href).href) {
      audio.src = track.audioUrl;
      audio.load();
    }
    if (autoplay) audio.play().catch(() => {});
  }
  function format(seconds) {
    if (!Number.isFinite(seconds)) return "--:--";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }
  async function loadLyrics(track) {
    const request = ++lyricRequest;
    const toggle = $("now-playing-lyrics-toggle");
    const panel = $("now-playing-lyrics");
    const lines = $("now-playing-lyrics-lines");
    lyricLines = [];
    activeLyricIndex = -1;
    lines.replaceChildren();
    panel.hidden = !track.lyricsUrl;
    toggle.hidden = !track.lyricsUrl;
    toggle.setAttribute("aria-expanded", String(!!track.lyricsUrl));
    toggle.textContent = "Ocultar letras";
    if (!track.lyricsUrl) return;
    $("now-playing-lyrics-status").textContent = "Carregando letras…";
    try {
      const response = await fetch(track.lyricsUrl);
      if (!response.ok) throw new Error("Letras indisponíveis");
      const lrc = await response.text();
      if (request !== lyricRequest) return;
      lyricLines = lrc.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        if (match)
          return match[3]
            ? [
                {
                  time: Number(match[1]) * 60 + Number(match[2]),
                  text: match[3],
                },
              ]
            : [];
        if (/^\[[^\]]+\]/.test(line) || !line.trim()) return [];
        return [{ time: null, text: line.trim() }];
      });
      for (const item of lyricLines) {
        const paragraph = document.createElement("p");
        const text = document.createElement("span");
        text.className = "lyric-text";
        text.textContent = item.text;
        paragraph.appendChild(text);
        lines.appendChild(paragraph);
      }
      $("now-playing-lyrics-status").textContent = lyricLines.length
        ? lyricLines.some((line) => line.time !== null)
          ? "Acompanhando a reprodução"
          : "Letras sem marcação de tempo — acompanhe a música"
        : "Letras indisponíveis.";
      syncLyrics();
    } catch {
      if (request !== lyricRequest) return;
      $("now-playing-lyrics-status").textContent = "Letras indisponíveis.";
    }
  }
  function focusLyricLine(index) {
    const panel = $("now-playing-lyrics");
    const line = $("now-playing-lyrics-lines").children[index];
    if (!line || panel.hidden || !$("now-playing-dialog").open) return;
    const top = panel.scrollTop + line.getBoundingClientRect().top -
      panel.getBoundingClientRect().top - panel.clientHeight / 2 + line.clientHeight / 2;
    panel.scrollTo({
      top,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  function syncLyrics() {
    if (!lyricLines.some((line) => line.time !== null)) return;
    let index = lyricLines.findLastIndex(
      (line) => line.time !== null && line.time <= audio.currentTime,
    );
    // Instrumental breaks can last much longer than a sung phrase. Do not
    // leave the previous line highlighted until the next vocal begins.
    if (index >= 0 && audio.currentTime - lyricLines[index].time > 8.5)
      index = -1;
    const lines = $("now-playing-lyrics-lines");
    const elements = lines.children;
    if (activeLyricIndex === -1) {
      const previous = lines.querySelector(".is-active");
      previous?.classList.remove("is-active");
      previous?.removeAttribute("aria-current");
    }
    if (index !== activeLyricIndex) {
      elements[activeLyricIndex]?.classList.remove("is-active");
      elements[activeLyricIndex]?.removeAttribute("aria-current");
      elements[index]?.style.setProperty("--lyric-fill", "0%");
      elements[index]?.classList.add("is-active");
      elements[index]?.setAttribute("aria-current", "true");
      activeLyricIndex = index;
      focusLyricLine(index);
    }
    if (index < 0) return;
    const next = lyricLines.slice(index + 1).find((line) => line.time !== null);
    const nextTime = next?.time ??
      (Number.isFinite(audio.duration)
        ? audio.duration
        : lyricLines[index].time + 4.5);
    const phraseSeconds = Math.min(
      7.5,
      Math.max(0.8, nextTime - lyricLines[index].time - 0.12),
    );
    const progress = Math.max(
      0,
      Math.min(100, ((audio.currentTime - lyricLines[index].time) / phraseSeconds) * 100),
    );
    elements[index]?.style.setProperty("--lyric-fill", `${progress.toFixed(1)}%`);
  }
  function selectRelative(direction, autoplay = false) {
    if (!selected || tracks.length < 2) return;
    const index = tracks.findIndex((track) => track.id === selected.id);
    if (shuffleEnabled && direction > 0) {
      const options = tracks.filter(
        (track) => available(track) && track.id !== selected.id,
      );
      if (options.length) {
        select(options[Math.floor(Math.random() * options.length)], autoplay);
        return;
      }
    }
    for (let step = 1; step < tracks.length; step++) {
      const candidate =
        tracks[(index + direction * step + tracks.length) % tracks.length];
      if (available(candidate)) {
        select(candidate, autoplay);
        return;
      }
    }
  }
  function setupVisualizer() {
    if (audioContext) {
      if (audioContext.state === "suspended") audioContext.resume();
      return;
    }
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
  }
  function bandAverage(data, fromHz, toHz) {
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.ceil(fromHz / binHz));
    const end = Math.min(data.length - 1, Math.floor(toHz / binHz));
    let total = 0;
    for (let i = start; i <= end; i++) total += data[i];
    return total / Math.max(1, end - start + 1) / 255;
  }
  function adaptiveLevel(name, raw) {
    const state = adaptive[name];
    state.peak = Math.max(raw, state.peak * 0.997);
    state.floor = Math.min(raw, state.floor * 0.995 + raw * 0.005);
    const normalized = Math.max(
      0,
      Math.min(
        1,
        (raw - state.floor) / Math.max(0.06, state.peak - state.floor),
      ),
    );
    const target = raw < 0.018 ? 0 : Math.min(1, normalized * 0.82 + raw * 0.6);
    const rate = target > levels[name] ? 0.58 : 0.09;
    levels[name] += (target - levels[name]) * rate;
    return levels[name];
  }
  function updatePlanetLevels(rawBass, rawMid, rawHigh, rms) {
    const mobile = innerWidth <= 768;
    const gate = rms < 0.005 ? 0 : 1;
    const beatTarget =
      gate && rawBass > (mobile ? 0.06 : 0.12)
        ? Math.min(
            1,
            Math.max(
              0,
              (rms - planetRmsAverage - (mobile ? 0.008 : 0.025)) *
                (mobile ? 10 : 4),
            ),
          )
        : 0;
    planetRmsAverage +=
      (rms - planetRmsAverage) * (rms > planetRmsAverage ? 0.025 : 0.09);
    planetLevels.beat +=
      (beatTarget - planetLevels.beat) *
      (beatTarget > planetLevels.beat ? 0.7 : 0.16);
    const targets = {
      bass: Math.min(1, Math.max(0, (rawBass - 0.035) / 0.58)) * gate,
      mid: Math.min(1, Math.max(0, (rawMid - 0.045) / 0.42)) * gate,
      high: Math.min(1, Math.max(0, (rawHigh - 0.04) / 0.35)) * gate,
    };
    for (const band of ["bass", "mid", "high"]) {
      const rate = targets[band] > planetLevels[band] ? 0.46 : 0.085;
      planetLevels[band] += (targets[band] - planetLevels[band]) * rate;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const visibleBeat = reduced ? 0 : planetLevels.beat;
    const homeVisible = !location.hash || location.hash === "#home";
    const art = mobileDockActive
      ? $("mobile-visualizer-dock")
      : !mobile ||
          (homeVisible && !mobileArtPast && !$("now-playing-dialog").open)
        ? document.querySelector("#home .release-hero__cover")
        : null;
    if (!art) return;
    const desktopHero =
      innerWidth >= 1000 && art.classList.contains("release-hero__cover");
    const compact = art.id === "mobile-visualizer-dock";
    const compactBass = compact && !reduced
      ? Math.min(1, levels.bass * 0.8 + planetLevels.beat * 0.65)
      : 0;
    art.style.setProperty(
      "--planet-scale",
      (
        1 +
        planetLevels.bass * (reduced ? 0.003 : mobile ? 0.016 : 0.014) +
        visibleBeat * (mobile ? 0.015 : 0.004) +
        compactBass * (reduced ? 0 : 0.007)
      ).toFixed(4),
    );
    art.style.setProperty(
      "--planet-brightness",
      (1 + planetLevels.bass * (desktopHero ? 0.055 : 0.09) + compactBass * 0.08).toFixed(3),
    );
    art.style.setProperty(
      "--planet-atmosphere",
      (
        (compact ? 0.2 : 0.12) +
        planetLevels.bass * (desktopHero ? 0.25 : 0.42) +
        visibleBeat * (desktopHero ? 0.08 : 0.24) +
        compactBass * 0.35
      ).toFixed(3),
    );
    art.style.setProperty(
      "--planet-details",
      (0.04 + planetLevels.high * 0.22).toFixed(3),
    );
    art.style.setProperty(
      "--stars-high",
      (reduced ? 0 : Math.min(1, planetLevels.high * 1.5)).toFixed(3),
    );
    art.style.setProperty(
      "--stars-mid",
      (reduced ? 0 : Math.min(0.8, planetLevels.mid * 1.1)).toFixed(3),
    );
    art.style.setProperty(
      "--planet-horizon",
      (
        (compact ? 0.24 : 0.18) +
        planetLevels.bass * (desktopHero ? 0.22 : 0.45) +
        visibleBeat * (desktopHero ? 0.08 : 0.24) +
        compactBass * 0.35
      ).toFixed(3),
    );
    art.style.setProperty(
      "--planet-rim",
      (
        0.03 +
        planetLevels.bass * (desktopHero ? 0.06 : 0.1) +
        visibleBeat * (desktopHero ? 0.08 : 0.2) +
        planetLevels.high * 0.03
      ).toFixed(3),
    );
  }
  function clearVisualizer() {
    cancelAnimationFrame(visualizerFrame);
    visualizerFrame = 0;
    planetLevels.bass =
      planetLevels.mid =
      planetLevels.high =
      planetLevels.beat =
        0;
    planetRmsAverage = 0;
    planetBars.fill(0);
    mobileBarPeaks.fill(0);
    mobileBarDisplay.fill(0);
    mobileLoudness = 0;
    desktopPlanetBars.fill(0);
    nowPlayingBands.fill(0);
    nowPlayingPeak = 0.18;
    desktopRms = 0;
    desktopBassMean = 0;
    desktopBeat = 0;
    for (const art of [
      document.querySelector("#home .release-hero__cover"),
      $("mobile-visualizer-dock"),
    ]) {
      if (art)
        for (const name of [
          "--planet-scale",
          "--planet-brightness",
          "--planet-atmosphere",
          "--planet-details",
          "--stars-high",
          "--stars-mid",
          "--planet-horizon",
          "--planet-rim",
        ])
          art.style.removeProperty(name);
    }
    const canvas = $("music-visualizer");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nowCanvas = $("now-playing-visualizer");
    nowCanvas
      .getContext("2d")
      .clearRect(0, 0, nowCanvas.width, nowCanvas.height);
    $("now-playing-visual-card").style.removeProperty("--cover-energy");
    for (const id of ["hero-mini-visualizer", "sidebar-mini-visualizer", "mobile-visualizer-canvas"]) {
      const mini = $(id);
      if (mini) mini.getContext("2d").clearRect(0, 0, mini.width, mini.height);
    }
  }
  function drawMiniBars(canvas, data, count) {
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio),
      height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const left = width * 0.03,
      span = width * 0.94;
    const gap = 2 * ratio,
      barWidth = Math.max(1.5 * ratio, (span - gap * (count - 1)) / count);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const horizonY = (t) =>
      height * (0.87 - 0.12 * (1 - Math.pow(2 * t - 1, 2)));
    for (let i = 0; i < count; i++) {
      const hz = 35 * Math.pow(9000 / 35, i / Math.max(1, count - 1));
      const bin = Math.min(
        data.length - 1,
        Math.max(1, Math.round(hz / binHz)),
      );
      const energy = Math.pow(
        (data[Math.max(1, bin - 1)] +
          data[bin] * 2 +
          data[Math.min(data.length - 1, bin + 1)]) /
          (4 * 255),
        0.9,
      );
      const t = (i + 0.5) / count,
        edge = Math.pow(Math.sin(Math.PI * t), 0.6);
      const base = horizonY(0.03 + t * 0.94);
      const barHeight =
        Math.min(base - height * 0.12, energy * height * 0.76) * edge;
      if (barHeight < ratio) continue;
      const x = left + i * (barWidth + gap) + barWidth / 2;
      const color =
        i < count * 0.3 ? "#55c4f7" : i < count * 0.75 ? "#e477ee" : "#ad86f5";
      const beam = ctx.createLinearGradient(
        0,
        base - barHeight,
        0,
        base + 2 * ratio,
      );
      beam.addColorStop(0, color + "80");
      beam.addColorStop(0.35, color + "e8");
      beam.addColorStop(1, color + "00");
      ctx.globalAlpha = edge * 0.95;
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(2 * ratio, barWidth * 0.72);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, base - barHeight);
      ctx.lineTo(x, base + 2 * ratio);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const horizon = ctx.createLinearGradient(0, 0, width, 0);
    horizon.addColorStop(0, "rgba(82,193,250,0)");
    horizon.addColorStop(0.3, "rgba(82,193,250,.55)");
    horizon.addColorStop(0.6, "rgba(228,119,238,.7)");
    horizon.addColorStop(1, "rgba(176,126,247,0)");
    ctx.beginPath();
    for (let point = 0; point <= 40; point++) {
      const t = point / 40;
      point ? ctx.lineTo(t * width, horizonY(t)) : ctx.moveTo(0, horizonY(0));
    }
    ctx.strokeStyle = horizon;
    ctx.lineWidth = 1.5 * ratio;
    ctx.stroke();
  }
  function drawDesktopPlanetVisualizer(
    ctx,
    data,
    width,
    height,
    ratio,
    motion,
    rms,
  ) {
    const count = desktopPlanetBars.length;
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const start = 0.35,
      span = 0.57;
    const curve = (t) =>
      height *
      (1.36 -
        2.305 * t +
        1.328 * t * t +
        planetLevels.mid * 0.003 * Math.sin(t * Math.PI * 4));
    const bars = [];
    let sum = 0,
      peak = 0;
    for (let i = 0; i < count; i++) {
      const hz = 45 * Math.pow(8000 / 45, i / (count - 1));
      const bin = Math.min(
        data.length - 2,
        Math.max(2, Math.round(hz / binHz)),
      );
      const energy =
        (data[bin - 1] + data[bin] * 2 + data[bin + 1]) / (4 * 255);
      const previous = desktopPlanetBars[i];
      desktopPlanetBars[i] +=
        (energy - previous) * (energy > previous ? 0.42 : 0.085);
      const level = desktopPlanetBars[i];
      sum += level;
      peak = Math.max(peak, level);
      bars.push({ t: (i + 0.5) / count, level });
    }
    const average = sum / count;
    const activity = Math.min(1, average * 1.5);
    const rawBass = bandAverage(data, 30, 150);
    if (!desktopBassMean) desktopBassMean = rawBass;
    const bassRise = Math.max(0, rawBass - desktopBassMean - 0.015);
    const rmsRise = Math.max(0, rms - desktopRms - 0.008);
    desktopBassMean +=
      (rawBass - desktopBassMean) *
      (rawBass > desktopBassMean ? 0.035 : 0.1);
    const impact =
      motion === 1 ? Math.min(1, Math.max(bassRise * 5.5, rmsRise * 5)) : 0;
    desktopBeat +=
      (impact - desktopBeat) * (impact > desktopBeat ? 0.72 : 0.12);
    desktopRms += (rms - desktopRms) * (rms > desktopRms ? 0.35 : 0.09);
    const audibility = Math.min(1, Math.max(0, (desktopRms - 0.012) / 0.22));
    const paintBar = (bar, i, distant) => {
      const t = bar.t,
        x = width * (start + t * span),
        base = curve(start + t * span);
      const edge = Math.pow(Math.sin(Math.PI * t), 0.9);
      const contrast = Math.max(
        0.55,
        Math.min(
          1.35,
          0.8 + ((bar.level - average) / Math.max(0.15, peak)) * 0.55,
        ),
      );
      const amount = Math.pow(bar.level, 1.15) * contrast;
      const barHeight = Math.min(
        height * 0.23,
        amount *
          height *
          (0.32 + planetLevels.mid * 0.04) *
          edge *
          motion *
          (0.42 + audibility * 0.58) *
          (1 + desktopBeat * 0.85),
      );
      if (barHeight < ratio) return;
      const color =
        i < count * 0.38
          ? "20,180,246"
          : i < count * 0.82
            ? "145,91,244"
            : "226,67,205";
      const beam = ctx.createLinearGradient(0, base - barHeight, 0, base);
      beam.addColorStop(0, `rgba(${color},.42)`);
      beam.addColorStop(0.5, `rgba(${color},.9)`);
      beam.addColorStop(1, `rgba(${color},1)`);
      ctx.globalAlpha = edge * (distant ? 0.72 : 1);
      ctx.strokeStyle = beam;
      ctx.lineWidth = (distant ? 3.6 : 4.8) * ratio;
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(${color},.6)`;
      ctx.shadowBlur = (distant ? 5 : 4) * ratio;
      ctx.beginPath();
      ctx.moveTo(x, base - barHeight);
      ctx.lineTo(x, base);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!distant && motion === 1 && i % 5 === 0 && planetLevels.high > 0.1) {
        ctx.globalAlpha = edge * planetLevels.high * 0.25;
        ctx.fillStyle = "#ca82e4";
        ctx.beginPath();
        ctx.arc(x, base - barHeight, 1.2 * ratio, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    ctx.save();
    bars.forEach((bar, i) => {
      if (i % 4 === 1) paintBar(bar, i, true);
    });
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = start + (i / 48) * span,
        x = t * width,
        y = curve(t);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const rim = ctx.createLinearGradient(
      start * width,
      0,
      (start + span) * width,
      0,
    );
    rim.addColorStop(0, "rgba(48,182,232,0)");
    rim.addColorStop(0.3, "rgba(48,182,232,.5)");
    rim.addColorStop(0.7, "rgba(150,107,228,.5)");
    rim.addColorStop(1, "rgba(196,87,183,0)");
    ctx.strokeStyle = rim;
    ctx.globalAlpha = 0.1 + activity * audibility * 0.16 + desktopBeat * 0.2;
    ctx.lineWidth = 8 * ratio;
    ctx.shadowColor = "#8f65db";
    ctx.shadowBlur = 5 * ratio;
    ctx.stroke();
    ctx.globalAlpha = 0.14 + activity * audibility * 0.14 + desktopBeat * 0.22;
    ctx.lineWidth = 1.1 * ratio;
    ctx.shadowBlur = 0;
    ctx.stroke();
    bars.forEach((bar, i) => {
      if (i % 4 !== 1) paintBar(bar, i, false);
    });
    ctx.restore();
  }
  function drawPlanetVisualizer(data, rms) {
    const mobile = innerWidth <= 768;
    if (
      mobile &&
      !mobileDockActive &&
      (mobileArtPast || (location.hash && location.hash !== "#home"))
    )
      return;
    const canvas = $(
      mobile && mobileDockActive
        ? "mobile-visualizer-canvas"
        : "hero-mini-visualizer",
    );
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const compact = canvas.id === "mobile-visualizer-canvas";
    const desktopHero = !compact && innerWidth >= 1000;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio),
      height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const motion = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0.5
      : 1;
    if (desktopHero) {
      drawDesktopPlanetVisualizer(ctx, data, width, height, ratio, motion, rms);
      return;
    }
    const barStart = desktopHero ? 0.19 : compact ? 0.25 : 0.31;
    const barSpan = desktopHero ? 0.76 : compact ? 0.7 : 0.58;
    const count = planetBars.length,
      left = width * barStart,
      span = width * barSpan;
    const gap = 2.5 * ratio,
      barWidth = (span - gap * (count - 1)) / count;
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const horizonY = (t) =>
      height *
      ((desktopHero ? 1.33 : 1.37) -
        2.305 * t +
        1.328 * t * t +
        planetLevels.mid * 0.005 * Math.sin(t * Math.PI * 4));
    const colors = desktopHero
      ? ["#12ade4", "#db37d1", "#9354ed"]
      : compact
        ? ["#12cdf4", "#398df5", "#a667f5", "#e34dd7"]
        : ["#13c4f4", "#df42d2", "#9874ff"];
    const accents = [
      ["67,188,255", 0.29],
      ["224,112,238", 0.53],
      ["172,130,241", 0.76],
    ];
    if (innerWidth <= 768) {
      const targetLoudness = Math.max(0, Math.min(1, (rms - 0.008) / 0.075));
      mobileLoudness +=
        (targetLoudness - mobileLoudness) *
        (targetLoudness > mobileLoudness ? 0.48 : 0.12);
    }
    // Diffuse light along the illuminated rim ties the spectrum to the planet.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const [color, center] of accents) {
      const base = horizonY(center);
      const haze = ctx.createRadialGradient(
        width * center,
        base,
        0,
        width * center,
        base,
        width * 0.25,
      );
      haze.addColorStop(
        0,
        `rgba(${color},${(desktopHero ? 0.035 + planetLevels.bass * 0.05 + planetLevels.mid * 0.025 : compact ? 0.035 + planetLevels.bass * 0.065 + planetLevels.mid * 0.035 + planetLevels.beat * (motion === 1 ? 0.055 : 0) : 0.11 + planetLevels.bass * 0.17 + planetLevels.mid * 0.08 + planetLevels.beat * (motion === 1 ? 0.18 : 0)).toFixed(3)})`,
      );
      haze.addColorStop(0.45, `rgba(${color},${desktopHero ? 0.012 : compact ? 0.014 : 0.045})`);
      haze.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, base - height * 0.55, width, height * 1.15);
    }
    ctx.restore();
    for (let i = 0; i < count; i++) {
      const hz = 35 * Math.pow(9000 / 35, i / (count - 1));
      const bin = Math.min(
        data.length - 1,
        Math.max(1, Math.round(hz / binHz)),
      );
      const energy = Math.pow(
        (data[Math.max(1, bin - 1)] +
          data[bin] * 2 +
          data[Math.min(data.length - 1, bin + 1)]) /
          (4 * 255),
        1.05,
      );
      const rate = energy > planetBars[i] ? 0.68 : 0.1;
      planetBars[i] += (energy - planetBars[i]) * rate;
      if (innerWidth <= 768) {
        mobileBarPeaks[i] = Math.max(0.12, energy, mobileBarPeaks[i] * 0.996);
        const normalized = Math.max(
          0,
          Math.min(1, (planetBars[i] - 0.028) / (mobileBarPeaks[i] - 0.028)),
        );
        mobileBarDisplay[i] = Math.pow(normalized, 0.82) * mobileLoudness;
      }
      const t = (i + 0.5) / count,
        edge = Math.pow(Math.sin(Math.PI * t), 1.2);
      const base = horizonY(barStart + t * barSpan);
      const response = compact
        ? mobileBarDisplay[i]
        : Math.min(1, planetBars[i]);
      const barScale = desktopHero
        ? 0.16 + planetLevels.mid * 0.02
        : compact
          ? 0.5 + planetLevels.mid * 0.13 + levels.bass * 0.08
          : 0.28 + planetLevels.mid * 0.04;
      const beatGain =
        motion === 1 ? planetLevels.beat * (compact ? 0.55 : 0.45) : 0;
      const barHeight =
        Math.min(
          base - height * 0.07,
          response *
            height *
            barScale *
            (1 + (compact ? levels.bass * 0.18 : planetLevels.bass * 0.06)) *
            (1 + beatGain),
        ) *
        edge *
        motion;
      if (barHeight < ratio) continue;
      const x = left + i * (barWidth + gap) + barWidth / 2;
      const color = compact
        ? colors[i < 12 ? 0 : i < 24 ? 1 : i < 37 ? 2 : 3]
        : colors[i < 16 ? 0 : i < 35 ? 1 : 2];
      const beam = ctx.createLinearGradient(
        0,
        base - barHeight,
        0,
        base + 4 * ratio,
      );
      beam.addColorStop(0, color + (desktopHero ? "c5" : "b8"));
      beam.addColorStop(0.28, color + "f2");
      beam.addColorStop(0.8, color + (desktopHero ? "dc" : "d0"));
      beam.addColorStop(1, color + "00");
      ctx.globalAlpha = edge * (compact ? 1 : desktopHero ? 0.97 : 0.94);
      ctx.strokeStyle = beam;
      ctx.lineWidth = desktopHero
        ? Math.min(4 * ratio, barWidth * 0.36)
        : Math.max(2 * ratio, barWidth * 0.8);
      ctx.lineCap = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.min(
        (compact ? 7 : desktopHero ? 7 : 9) * ratio,
        barHeight * 0.15,
      );
      ctx.beginPath();
      ctx.moveTo(x, base - barHeight);
      ctx.lineTo(x, base + 4 * ratio);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (motion === 1 && i > 28 && i % 3 === 0 && planetLevels.high > 0.08) {
        ctx.globalAlpha = edge * planetLevels.high * 0.5;
        ctx.fillStyle = "#e17af0";
        ctx.beginPath();
        ctx.arc(
          x,
          base - barHeight,
          (1 + planetLevels.high) * ratio,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // A second, audio-shaped ribbon moves with the smoothed spectrum at the horizon.
    const ribbonBars = compact ? mobileBarDisplay : planetBars;
    ctx.beginPath();
    for (let point = 0; point <= 64; point++) {
      const t = barStart + (point / 64) * barSpan;
      const index = Math.min(count - 2, Math.floor((point / 64) * (count - 1)));
      const energy =
        (ribbonBars[Math.max(0, index - 1)] +
          ribbonBars[index] +
          ribbonBars[index + 1]) /
        3;
      const edge = Math.sin((Math.PI * point) / 64);
      const y =
        horizonY(t) -
        energy * height * (compact ? 0.1 + planetLevels.beat * 0.04 : 0.05 + planetLevels.beat * 0.02) * edge * motion;
      point ? ctx.lineTo(t * width, y) : ctx.moveTo(t * width, y);
    }
    ctx.strokeStyle = "rgba(196,73,230,.62)";
    ctx.globalAlpha = compact
      ? Math.min(0.9, 0.3 + planetLevels.mid * 0.35 + levels.bass * 0.18)
      : 1;
    ctx.lineWidth = (1 + planetLevels.mid * 1.2) * ratio;
    ctx.shadowColor = desktopHero ? "#a442c4" : "#cd86ef";
    ctx.shadowBlur =
      (desktopHero ? 2 + planetLevels.mid * 3 : 3 + planetLevels.mid * 5) *
      ratio;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let point = 0; point <= 64; point++) {
      const t = point / 64,
        x = t * width,
        y = horizonY(t);
      point ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const waveColor = ctx.createLinearGradient(0, 0, width, 0);
    waveColor.addColorStop(0, "rgba(67,188,255,0)");
    waveColor.addColorStop(0.22, "rgba(40,166,241,.7)");
    waveColor.addColorStop(0.55, "rgba(205,67,229,.82)");
    waveColor.addColorStop(0.82, "rgba(135,82,231,.65)");
    waveColor.addColorStop(1, "rgba(211,105,250,0)");
    ctx.strokeStyle = waveColor;
    ctx.globalAlpha = compact
      ? Math.min(1, 0.35 + levels.bass * 0.5 + planetLevels.beat * 0.3)
      : 1;
    ctx.lineWidth = (1.4 + planetLevels.bass * 1.6) * ratio;
    ctx.shadowColor = "#b960df";
    ctx.shadowBlur =
      (desktopHero ? 4 + planetLevels.bass * 5 : 6 + planetLevels.bass * 10) *
      ratio;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  function drawNowPlayingVisualizer(data, timeData) {
    const canvas = $("now-playing-visualizer");
    if (!$("now-playing-dialog").open || !canvas.clientWidth) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = 56;
    const binHz = audioContext.sampleRate / analyser.fftSize;
    let framePeak = 0;
    for (let i = 0; i < count; i++) {
      const hz = 40 * Math.pow(9000 / 40, i / (count - 1));
      const bin = Math.min(data.length - 2, Math.max(1, Math.round(hz / binHz)));
      const raw = (data[bin - 1] + data[bin] * 2 + data[bin + 1]) / (4 * 255);
      nowPlayingRaw[i] = raw;
      framePeak = Math.max(framePeak, raw);
    }
    nowPlayingPeak = Math.max(0.16, framePeak, nowPlayingPeak * 0.995);
    const bass = Math.min(1, levels.bass);
    const mid = Math.min(1, levels.mid);
    const high = Math.min(1, levels.high);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.285;
    const pulse = reducedMotion ? 0 : bass * radius * 0.018;
    const inner = radius + pulse;
    const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    gradient.addColorStop(0, "#43d5ec");
    gradient.addColorStop(0.35, "#5c91f5");
    gradient.addColorStop(0.68, "#a66cf1");
    gradient.addColorStop(1, "#df65cc");

    const atmosphere = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.55);
    atmosphere.addColorStop(0, "rgba(72, 59, 135, 0)");
    atmosphere.addColorStop(0.65, `rgba(78, 72, 168, ${(0.05 + bass * 0.08).toFixed(3)})`);
    atmosphere.addColorStop(1, "rgba(39, 18, 84, 0)");
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.4 * ratio;
    ctx.globalAlpha = 0.32 + bass * 0.27;
    ctx.shadowColor = "#8364dc";
    ctx.shadowBlur = (4 + bass * 11) * ratio;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const hz = 40 * Math.pow(9000 / 40, i / (count - 1));
      const gain = hz < 160 ? 1.16 : hz < 2000 ? 1 : 0.86;
      const normalized = Math.min(1, Math.max(0,
        ((nowPlayingRaw[i] - 0.018) * gain) / (nowPlayingPeak * 0.9)));
      const target = reducedMotion ? normalized * 0.16 : Math.pow(normalized, 0.82);
      const current = nowPlayingBands[i];
      nowPlayingBands[i] += (target - current) * (target > current ? 0.4 : 0.1);
      const strength = nowPlayingBands[i];
      if (strength < 0.012) continue;
      const angle = -Math.PI / 2 + t * Math.PI * 2;
      const length = (6 + strength * radius * 0.25) * ratio;
      const start = inner + 4 * ratio;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start);
      ctx.lineTo(cx + Math.cos(angle) * (start + length),
        cy + Math.sin(angle) * (start + length));
      ctx.strokeStyle = `hsl(${Math.round(192 + t * 116)} 92% 66%)`;
      ctx.lineWidth = (1.8 + strength * 1.6) * ratio;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.32 + strength * 0.58;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = strength > 0.2 ? (2 + strength * 6) * ratio : 0;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // The inner line uses the same time-domain samples as the playing audio.
    const span = radius * 0.7;
    const waveAmplitude = radius * (reducedMotion ? 0.11 : 0.3);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const sample = timeData[Math.min(timeData.length - 1,
        Math.floor(i * (timeData.length - 1) / 96))];
      const x = cx - span + (i / 96) * span * 2;
      const y = cy + ((sample - 128) / 128) * waveAmplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = gradient;
    ctx.lineWidth = (1.8 + mid * 1.3) * ratio;
    ctx.lineJoin = "round";
    ctx.shadowColor = "#8c6be6";
    ctx.shadowBlur = reducedMotion ? 0 : (3 + mid * 8) * ratio;
    ctx.globalAlpha = 0.55 + Math.min(0.35, mid * 0.35);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    for (const angle of [-2.35, -0.62, 0.8, 2.55]) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * (inner + radius * 0.18),
        cy + Math.sin(angle) * (inner + radius * 0.18),
        (1.1 + high * 1.9) * ratio, 0, Math.PI * 2);
      ctx.fillStyle = angle > 0 ? "#e181e7" : "#6ad9f2";
      ctx.globalAlpha = high * (reducedMotion ? 0.2 : 0.62);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    $("now-playing-visual-card").style.setProperty(
      "--cover-energy",
      reducedMotion ? "0" : Math.min(0.42, bass * 0.32 + mid * 0.1).toFixed(3),
    );
  }
  function drawHeroVisualizer(spectrum, waveform) {
    const canvas = $("hero-audio-visualizer");
    if (!canvas || !canvas.clientWidth) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const size = Math.round(canvas.clientWidth * ratio);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2,
      cy = size / 2,
      base = size * 0.295;
    const bass = spectrum ? levels.bass : 0;
    const mid = spectrum ? levels.mid : 0;
    const high = spectrum ? levels.high : 0;
    const pulse = spectrum ? Math.min(1, beatPulse) : 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduced ? 0.3 : 1;
    const radius =
      base * (1 + Math.min(0.17, (bass * 0.1 + pulse * 0.12) * motion));
    const glow = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.65,
      cx,
      cy,
      radius * 1.42,
    );
    glow.addColorStop(0, `rgba(181, 83, 255, ${0.06 + bass * 0.12})`);
    glow.addColorStop(1, "rgba(181, 83, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "#e777ff";
    ctx.shadowBlur = spectrum
      ? (9 + bass * 25 + pulse * 18) * ratio
      : 4 * ratio;
    ctx.strokeStyle = `rgba(237, 143, 255, ${0.55 + bass * 0.4})`;
    ctx.lineWidth = 2.5 * ratio;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(117, 113, 255, ${0.22 + mid * 0.34})`;
    ctx.lineWidth = ratio;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    const count = 88,
      binHz = audioContext ? audioContext.sampleRate / analyser.fftSize : 22;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const hz = 45 * Math.pow(10000 / 45, i / (count - 1));
      const bin = Math.min(spectrum?.length - 1 || 0, Math.round(hz / binHz));
      const energy = spectrum ? spectrum[bin] / 255 : 0;
      const length = (3 + Math.pow(energy, 0.72) * 23 * motion) * ratio;
      const start = radius + 9 * ratio;
      ctx.strokeStyle =
        i < 22
          ? `rgba(244, 119, 239, ${0.3 + energy * 0.7})`
          : i < 62
            ? `rgba(177, 113, 255, ${0.28 + energy * 0.68})`
            : `rgba(85, 200, 255, ${0.27 + energy * 0.68})`;
      ctx.lineWidth = 2 * ratio;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start);
      ctx.lineTo(
        cx + Math.cos(angle) * (start + length),
        cy + Math.sin(angle) * (start + length),
      );
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.82, 0, Math.PI * 2);
    ctx.clip();
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      for (let x = -radius; x <= radius; x += 3 * ratio) {
        const fraction = (x + radius) / (2 * radius);
        const index = waveform
          ? Math.min(
              waveform.length - 1,
              Math.floor(fraction * waveform.length),
            )
          : 0;
        const sample = waveform ? (waveform[index] - 128) / 128 : 0;
        const y =
          cy +
          (layer - 1) * radius * 0.23 +
          sample * radius * (0.5 + mid * 0.22) * motion;
        x === -radius ? ctx.moveTo(cx + x, y) : ctx.lineTo(cx + x, y);
      }
      ctx.strokeStyle = ["#eb75ed", "#8d75ff", "#5dbfff"][layer];
      ctx.globalAlpha = spectrum ? 0.32 + mid * 0.32 : 0.2;
      ctx.lineWidth = (1.5 + high) * ratio;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawVisualizer() {
    if (document.hidden) {
      visualizerFrame = 0;
      return;
    }
    if (audio.paused || !analyser) {
      clearVisualizer();
      return;
    }
    const canvas = $("music-visualizer");
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(data);
    analyser.getByteTimeDomainData(timeData);
    drawHeroVisualizer(data, timeData);
    const motionSafe = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const smoothing = motionSafe ? 1 : 0.14;
    const rawBass = bandAverage(data, 30, 150),
      rawMid = bandAverage(data, 150, 2000),
      rawHigh = bandAverage(data, 2000, 10000);
    let sum = 0;
    for (const value of timeData) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / timeData.length);
    if (motionSafe) {
      levels.bass = rawBass;
      levels.mid = rawMid;
      levels.high = rawHigh;
    } else {
      adaptiveLevel("bass", rawBass);
      adaptiveLevel("mid", rawMid);
      adaptiveLevel("high", rawHigh);
    }
    drawNowPlayingVisualizer(data, timeData);
    updatePlanetLevels(rawBass, rawMid, rawHigh, rms);
    drawPlanetVisualizer(data, rms);
    drawMiniBars($("sidebar-mini-visualizer"), data, 24);
    const bassOnset = Math.max(0, levels.bass - previousBass);
    previousBass = levels.bass;
    beatPulse = Math.max(bassOnset * 5.5, beatPulse * 0.84);
    window.DTRX_PLAYER_AUDIO_STATE = {
      playing: true,
      bass: levels.bass,
      mid: levels.mid,
      high: levels.high,
      rms,
      peak: Math.max(...data) / 255,
      pulse: Math.min(1, beatPulse),
      raw: { bass: rawBass, mid: rawMid, high: rawHigh },
      spectrum: data,
      binHz: audioContext.sampleRate / analyser.fftSize,
      context: audioContext.state,
    };
    if (debugPanel) {
      debugFrames++;
      const now = performance.now();
      if (now - debugLast >= 250) {
        debugFps = Math.round(
          (debugFrames * 1000) / Math.max(1, now - debugLast),
        );
        debugFrames = 0;
        debugLast = now;
        debugPanel.textContent = `Áudio: ${audio.paused ? "pausado" : "reproduzindo"} | Contexto: ${audioContext.state}\nRMS: ${rms.toFixed(3)} | Pico: ${(Math.max(...data) / 255).toFixed(3)}\nGraves: ${levels.bass.toFixed(3)} (${rawBass.toFixed(3)})\nMédios: ${levels.mid.toFixed(3)} (${rawMid.toFixed(3)})\nAgudos: ${levels.high.toFixed(3)} (${rawHigh.toFixed(3)})\nFFT: ${analyser.fftSize} | bin: ${(audioContext.sampleRate / analyser.fftSize).toFixed(1)} Hz | FPS: ${debugFps}`;
      }
    }
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5,
      cy = height * 0.5,
      base = Math.min(height * 0.38, width * 0.11);
    const radius = base + levels.bass * base * 2.25;
    const gradient = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.3,
      cx,
      cy,
      radius * 2.4,
    );
    gradient.addColorStop(
      0,
      `rgba(181, 132, 255, ${0.16 + levels.bass * 0.23})`,
    );
    gradient.addColorStop(
      0.55,
      `rgba(231, 90, 217, ${0.04 + levels.mid * 0.09})`,
    );
    gradient.addColorStop(1, "rgba(231, 90, 217, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(221, 193, 255, ${0.34 + levels.high * 0.6})`;
    ctx.lineWidth = Math.max(1.5 * ratio, ratio * (2 + levels.high * 3));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(231, 90, 217, ${0.12 + levels.mid * 0.4})`;
    ctx.lineWidth = ratio;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const wave = levels.mid * base * 0.92 * Math.sin(i * 2.1);
      const r = radius * 1.48 + wave;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    const bars = 40;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, ratio * 1.5);
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const sample =
        data[Math.floor((i / bars) * Math.min(data.length, 96))] / 255;
      const length = (motionSafe ? sample * 0.35 : sample) * base * 0.72;
      const inner = radius * 1.72;
      const outer = inner + length;
      ctx.strokeStyle =
        i % 3 === 0
          ? `rgba(231, 90, 217, ${0.22 + sample * 0.65})`
          : `rgba(153, 107, 255, ${0.18 + sample * 0.58})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    visualizerFrame = requestAnimationFrame(drawVisualizer);
  }
  function openRoute() {
    const dialog = $("track-dialog");
    const match = location.hash.match(/^#track\/([\w-]+)$/);
    if (!match) {
      if (dialog.open) dialog.close();
      return;
    }
    const track = tracks.find((t) => t.id === match[1]);
    if (!track) return;
    const duration =
      selected?.id === track.id && Number.isFinite(audio.duration)
        ? audio.duration
        : track.duration;
    $("track-dialog-content").innerHTML = `
      <div class="track-dialog__layout">
        <div class="track-dialog__media">
          <div class="track-dialog__art">${cover(track)}</div>
          <p class="track-dialog__art-caption">DTRX AUDIO LAB <span aria-hidden="true">◆</span> ${escaped(track.title)}</p>
        </div>
        <div class="track-dialog__info">
          <p class="featured-kicker">Lançamento DTRX</p>
          <h2 id="track-dialog-title">${escaped(track.title)}</h2>
          <p class="track-dialog__artist">${escaped(artistLabel(track))}</p>
          <div class="track-dialog__facts" aria-label="Informações da faixa">
            ${track.genre?.trim() ? `<span>${escaped(track.genre)}</span>` : ""}
            ${Number.isFinite(duration) ? `<span>${format(duration)}</span>` : ""}
            ${track.lyricsUrl ? "<span>Letras disponíveis</span>" : ""}
          </div>
          <div class="track-dialog__footer">
            <p>${available(track) ? "Pronta para ouvir no DTRX Audio Lab" : "Áudio ainda não adicionado ao DTRX Audio Lab"}</p>
            <button class="btn btn-primary" type="button" data-action="play" data-id="${track.id}" ${available(track) ? "" : "disabled"}>${available(track) ? "Ouvir lançamento" : "Áudio indisponível"}</button>
          </div>
        </div>
      </div>`;
    if (!dialog.open) dialog.showModal();
    syncCardPlayback();
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) {
      const track = tracks.find((item) => item.id === button.dataset.id);
      if (!track) return;
      if (button.dataset.action === "play" && available(track)) {
        if (selected?.id === track.id) {
          if (audio.paused) {
            setupVisualizer();
            audio.play().catch(() => {});
          } else {
            audio.pause();
            syncCardPlayback();
          }
        } else {
          select(track, true);
          setupVisualizer();
        }
      }
      if (button.dataset.action === "favorite") {
        favorites.has(track.id)
          ? favorites.delete(track.id)
          : favorites.add(track.id);
        saveFavorites();
        updatePlayerFavorite();
        render();
      }
    }
    const genreButton = event.target.closest("[data-genre]");
    if (genreButton) {
      genre = genreButton.dataset.genre;
      libraryView = location.hash === "#favorites" ? "favorites" : "all";
      render();
    }
    const view = event.target.closest("[data-library-view]");
    if (view) {
      libraryView = view.dataset.libraryView;
      render();
    }
  });
  $("track-search").addEventListener("input", (event) => {
    filter = event.target.value.trim().toLowerCase();
    render();
  });
  $("dialog-close").addEventListener("click", () => {
    $("track-dialog").close();
    location.hash = "#library";
  });
  const togglePlayback = () => {
    if (!selected || !available(selected)) return;
    setupVisualizer();
    audio.paused ? audio.play() : audio.pause();
  };
  $("player-toggle").addEventListener("click", togglePlayback);
  $("player-favorite").addEventListener("click", () => {
    if (!selected) return;
    favorites.has(selected.id)
      ? favorites.delete(selected.id)
      : favorites.add(selected.id);
    saveFavorites();
    updatePlayerFavorite();
    render();
  });
  $("now-playing-favorite").addEventListener("click", () =>
    $("player-favorite").click(),
  );
  $("player-shuffle").addEventListener("click", () => {
    shuffleEnabled = !shuffleEnabled;
    for (const id of ["player-shuffle", "now-playing-shuffle"]) {
      $(id).setAttribute("aria-pressed", String(shuffleEnabled));
      $(id).setAttribute(
        "aria-label",
        `Aleatório ${shuffleEnabled ? "ativado" : "desativado"}`,
      );
    }
  });
  $("now-playing-shuffle").addEventListener("click", () =>
    $("player-shuffle").click(),
  );
  $("now-playing-toggle").addEventListener("click", togglePlayback);
  $("player-previous").addEventListener("click", () =>
    selectRelative(-1, !audio.paused),
  );
  $("player-next").addEventListener("click", () =>
    selectRelative(1, !audio.paused),
  );
  $("now-playing-previous").addEventListener("click", () =>
    selectRelative(-1, !audio.paused),
  );
  $("now-playing-next").addEventListener("click", () =>
    selectRelative(1, !audio.paused),
  );
  $("player-repeat").addEventListener("click", () => {
    repeatEnabled = !repeatEnabled;
    for (const id of ["player-repeat", "now-playing-repeat"]) {
      $(id).setAttribute("aria-pressed", String(repeatEnabled));
      $(id).setAttribute(
        "aria-label",
        `Repetição ${repeatEnabled ? "ativada" : "desativada"}`,
      );
    }
    $("player-repeat").classList.toggle("is-active", repeatEnabled);
  });
  $("now-playing-repeat").addEventListener("click", () =>
    $("player-repeat").click(),
  );
  const openNowPlaying = () => {
    if (!$("now-playing-dialog").open) $("now-playing-dialog").showModal();
    $("now-playing-visual-card").dataset.playing = String(!audio.paused);
    $("now-playing-visual-state").textContent = audio.paused ? "EM REPOUSO" : "ÁUDIO AO VIVO";
    activeLyricIndex = -1;
    syncLyrics();
  };
  $("player-expand").addEventListener("click", openNowPlaying);
  $("player-open").addEventListener("click", openNowPlaying);
  $("now-playing-close").addEventListener("click", () =>
    $("now-playing-dialog").close(),
  );
  $("now-playing-dialog").addEventListener("close", syncMobileDock);
  $("now-playing-dialog").addEventListener("toggle", syncMobileDock);
  $("now-playing-browse").addEventListener("click", () =>
    $("now-playing-dialog").close(),
  );
  $("now-playing-lyrics-toggle").addEventListener("click", () => {
    const panel = $("now-playing-lyrics");
    panel.hidden = !panel.hidden;
    $("now-playing-lyrics-toggle").setAttribute(
      "aria-expanded",
      String(!panel.hidden),
    );
    $("now-playing-lyrics-toggle").textContent = panel.hidden
      ? "Mostrar letras"
      : "Ocultar letras";
    if (!panel.hidden) {
      activeLyricIndex = -1;
      syncLyrics();
    }
  });
  const syncVolume = (event) => {
    audio.volume = event.target.value;
    $("player-volume").value = String(audio.volume);
    $("now-playing-volume").value = String(audio.volume);
  };
  $("player-volume").addEventListener("input", syncVolume);
  $("now-playing-volume").addEventListener("input", syncVolume);
  audio.addEventListener("play", () => {
    $("now-playing-visual-card").dataset.playing = "true";
    $("now-playing-visual-state").textContent = "ÁUDIO AO VIVO";
    setupVisualizer();
    syncMobileDock();
    syncCardPlayback();
    window.DTRX_PLAYER_AUDIO_STATE = {
      ...(window.DTRX_PLAYER_AUDIO_STATE || {}),
      playing: true,
    };
    window.dispatchEvent(new Event("dtrx-audio-state"));
    const hv = document.querySelector(".hero-visual");
    if (hv) hv.classList.add("playing");
    $("player-toggle").innerHTML = pauseGlyph;
    $("now-playing-toggle").innerHTML = pauseGlyph;
    $("player-toggle").setAttribute("aria-label", "Pausar faixa selecionada");
    $("now-playing-toggle").setAttribute(
      "aria-label",
      "Pausar faixa selecionada",
    );
    if (!visualizerFrame) drawVisualizer();
  });
  audio.addEventListener("pause", () => {
    $("now-playing-visual-card").dataset.playing = "false";
    $("now-playing-visual-state").textContent = "EM REPOUSO";
    previousBass = 0;
    beatPulse = 0;
    syncMobileDock();
    syncCardPlayback();
    window.DTRX_PLAYER_AUDIO_STATE = {
      ...(window.DTRX_PLAYER_AUDIO_STATE || {}),
      playing: false,
    };
    const hv = document.querySelector(".hero-visual");
    if (hv) hv.classList.remove("playing");
    if (debugPanel)
      debugPanel.textContent = `Áudio: pausado | Contexto: ${audioContext?.state || "não criado"}\nVisualizer em repouso`;
    $("player-toggle").innerHTML = playGlyph;
    $("now-playing-toggle").innerHTML = playGlyph;
    $("player-toggle").setAttribute(
      "aria-label",
      "Reproduzir faixa selecionada",
    );
    $("now-playing-toggle").setAttribute(
      "aria-label",
      "Reproduzir faixa selecionada",
    );
    clearVisualizer();
  });
  const seek = (event) => {
    if (audio.duration) {
      audio.currentTime = (audio.duration * event.target.value) / 100;
      syncTime();
    }
  };
  $("player-progress").addEventListener("input", seek);
  $("now-playing-progress").addEventListener("input", seek);
  document.addEventListener("visibilitychange", () => {
    syncMobileDock();
    if (!document.hidden && !audio.paused && !visualizerFrame) drawVisualizer();
  });
  const syncTime = () => {
    const progress =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? (audio.currentTime / audio.duration) * 100
        : 0;
    const elapsed = format(audio.currentTime),
      duration = format(
        Number.isFinite(audio.duration) ? audio.duration : selected?.duration,
      );
    $("player-progress").value = progress;
    $("player-progress").style.setProperty("--seek-progress", `${progress}%`);
    $("player-progress").setAttribute(
      "aria-valuetext",
      `${elapsed} de ${duration}`,
    );
    $("now-playing-progress").value = progress;
    $("now-playing-progress").style.setProperty("--seek-progress", `${progress}%`);
    $("now-playing-progress").setAttribute(
      "aria-valuetext",
      `${elapsed} de ${duration}`,
    );
    $("player-time").textContent = `${elapsed} / ${duration}`;
    $("player-mobile-time").textContent = `${elapsed} / ${duration}`;
    $("now-playing-elapsed").textContent = elapsed;
    $("now-playing-duration").textContent = duration;
    $("now-playing-mini-time").textContent = `${elapsed} / ${duration}`;
    syncLyrics();
  };
  audio.addEventListener("timeupdate", syncTime);
  audio.addEventListener("loadedmetadata", syncTime);
  audio.addEventListener("ended", () => {
    if (repeatEnabled) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    selectRelative(1, true);
  });
  audio.addEventListener("error", () => {
    if (!selected) return;
    $("player-toggle").disabled = true;
    $("now-playing-toggle").disabled = true;
    $("player-progress").disabled = true;
    $("now-playing-progress").disabled = true;
    $("player-time").textContent = "Áudio indisponível";
    $("player-mobile-time").textContent = "Áudio indisponível";
  });
  window.addEventListener("hashchange", () => {
    if (
      location.hash === "#favorites" ||
      location.hash === "#library" ||
      location.hash.startsWith("#track/")
    ) {
      libraryView = location.hash === "#favorites" ? "favorites" : "all";
      render();
    }
    openRoute();
  });
  window.addEventListener("scroll", requestHeroParallax, { passive: true });
  window.addEventListener("resize", requestHeroParallax);
  window.addEventListener("hashchange", () => {
    requestHeroParallax();
    requestAnimationFrame(syncMobileDock);
  });
  window.addEventListener("resize", observeMobileArt);
  if (location.hash === "#favorites") libraryView = "favorites";
  render();
  openRoute();
})();
