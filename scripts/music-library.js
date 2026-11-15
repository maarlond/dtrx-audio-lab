'use strict';

(() => {
  const tracks = window.DTRX_CATALOG || [];
  const favoritesKey = 'dtrx-library-favorites';
  const favorites = new Set(JSON.parse(localStorage.getItem(favoritesKey) || '[]'));
  let selected = null;
  let filter = '';
  let genre = 'all';
  let libraryView = 'all';
  let audioContext, analyser, source, visualizerFrame = 0, repeatEnabled = false, heroParallaxFrame = 0;
  let mobileArtObserver, mobileArtPast = false, mobileDockActive = false;
  const levels = { bass: 0, mid: 0, high: 0 };
  const planetLevels = { bass: 0, mid: 0, high: 0, beat: 0 };
  let planetRmsAverage = 0;
  const planetBars = new Float32Array(48);
  const adaptive = { bass: { peak: 0.14, floor: 0 }, mid: { peak: 0.14, floor: 0 }, high: { peak: 0.14, floor: 0 } };
  let previousBass = 0, beatPulse = 0;
  let shuffleEnabled = false;
  const $ = id => document.getElementById(id);
  const audio = $('library-audio');
  let lyricLines = [], lyricRequest = 0;
  const debugAudio = new URLSearchParams(location.search).get('debugAudio') === '1';
  const debugPanel = debugAudio ? document.body.appendChild(Object.assign(document.createElement('output'), { className: 'audio-debug', role: 'status' })) : null;
  if (debugPanel) debugPanel.textContent = 'Audio: paused | Context: not created\nPlay a track to inspect real frequency data';
  let debugLast = 0, debugFrames = 0, debugFps = 0;
  const escaped = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  const available = track => Boolean(track.audioUrl);
  const cover = track => track.coverUrl ? `<img src="${escaped(track.coverUrl)}" alt="Cover for ${escaped(track.title)}">` : `<span aria-hidden="true">DTRX</span>`;
  const status = track => available(track) ? 'Ready to play' : 'Audio coming soon';
  const playGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
  const pauseGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14"/></svg>';
  function syncCardPlayback() { document.querySelectorAll('.track-card[data-track-id]').forEach(card => { const playing = !audio.paused && selected?.id === card.dataset.trackId; card.classList.toggle('is-playing', playing); const play = card.querySelector('[data-action="play"]'); if (play && !play.disabled) play.textContent = playing ? 'Playing' : 'Play'; }); }
  function saveFavorites() { localStorage.setItem(favoritesKey, JSON.stringify([...favorites])); }
  function updatePlayerFavorite() { if (!selected) return; const active = favorites.has(selected.id); $('player-favorite').setAttribute('aria-pressed', String(active)); $('player-favorite').setAttribute('aria-label', `${active ? 'Remove' : 'Add'} ${selected.title} ${active ? 'from' : 'to'} favorites`); }
  function card(track, featured = false) {
    const isFavorite = favorites.has(track.id);
    return `<article class="track-card ${featured ? 'track-card--featured' : ''} ${available(track) ? '' : 'is-unavailable'} ${selected?.id === track.id && !audio.paused ? 'is-playing' : ''}" data-track-id="${track.id}"><div class="track-cover">${cover(track)}</div><div class="track-card__body"><span class="track-state">${status(track)}</span><h3>${escaped(track.title)}</h3><p>${escaped(track.artist)}${track.genre ? ` · ${escaped(track.genre)}` : ''}</p><div class="track-card__actions"><button type="button" data-action="play" data-id="${track.id}" ${available(track) ? '' : 'disabled'}>${available(track) ? 'Play' : 'Coming soon'}</button><button type="button" class="icon-button" data-action="favorite" data-id="${track.id}" aria-label="${isFavorite ? 'Remove' : 'Add'} ${escaped(track.title)} ${isFavorite ? 'from' : 'to'} favorites" aria-pressed="${isFavorite}">${isFavorite ? '♥' : '♡'}</button><a href="#track/${track.id}" data-action="details" data-id="${track.id}">Details</a></div></div></article>`;
  }
  function render() {
    const shown = tracks.filter(t => (libraryView !== 'favorites' || favorites.has(t.id)) && (genre === 'all' || t.genre === genre) && `${t.title} ${t.artist} ${t.genre}`.toLowerCase().includes(filter));
    $('track-grid').innerHTML = shown.map(track => card(track)).join('');
    $('recent-grid').innerHTML = tracks.filter(track => track.id !== (tracks.find(item => item.featured) || tracks[0])?.id).slice(0, 3).map(track => card(track)).join('');
    $('track-count').textContent = `${shown.length} track${shown.length === 1 ? '' : 's'}`;
    $('library-empty').hidden = shown.length > 0;
    $('library-empty').textContent = libraryView === 'favorites' ? 'No favorites yet. Save a track from the library.' : 'No tracks match this search.';
    const featured = tracks.find(t => t.featured) || tracks[0];
    const home = $('home-feature');
    const titleParts = featured ? escaped(featured.title).split(' ') : [];
    const heroTitle = titleParts.length > 1 ? `${titleParts.slice(0, -1).join(' ')}<br>${titleParts.at(-1)}` : titleParts[0];
    if (home && featured) home.innerHTML = `<p class="hero-eyebrow">FEATURED RELEASE</p><div class="release-hero__layout"><div class="release-hero__title"><p class="release-hero__artist">${escaped(featured.artist)}</p><h1 class="hero-title">${heroTitle}</h1><p class="hero-subtitle">${featured.genre ? escaped(featured.genre) : 'Original DTRX release'}</p><div class="hero-ctas"><button class="btn btn-primary" type="button" data-action="play" data-id="${featured.id}" ${available(featured) ? '' : 'disabled'}>${available(featured) ? 'Play release' : 'Audio coming soon'}</button><a class="btn btn-ghost" href="#track/${featured.id}">View release</a></div></div><div class="release-hero__cover" aria-hidden="true"><div class="release-hero__planet"></div><div class="release-hero__atmosphere"></div><canvas id="hero-mini-visualizer"></canvas></div></div>`;
    $('featured-track').innerHTML = featured ? `<p class="featured-kicker">Featured release</p>${card(featured, true)}` : '';
    const genres = [...new Set(tracks.map(t => t.genre).filter(Boolean))];
    $('genre-filters').innerHTML = ['all', ...genres].map(g => `<button class="genre-filter ${genre === g ? 'is-active' : ''}" data-genre="${escaped(g)}">${g === 'all' ? 'All releases' : escaped(g)}</button>`).join('');
    syncCardPlayback();
    requestHeroParallax();
    observeMobileArt();
  }
  function syncMobileDock() {
    const dock = $('mobile-visualizer-dock');
    const mobile = innerWidth <= 768;
    dock.classList.toggle('is-paused', audio.paused);
    dock.hidden = !mobile || !selected || !available(selected);
    if (dock.hidden) { mobileDockActive = false; document.body.classList.remove('has-mobile-visualizer-dock'); return; }
    const headerHeight = document.querySelector('.site-header').getBoundingClientRect().height;
    dock.style.setProperty('--mobile-header-height', `${headerHeight}px`);
    const onHome = !location.hash || location.hash === '#home';
    mobileDockActive = !document.hidden && !$('now-playing-dialog').open && !$('track-dialog').open && (!onHome || mobileArtPast);
    dock.classList.toggle('is-active', mobileDockActive);
    document.body.classList.toggle('has-mobile-visualizer-dock', mobileDockActive);
  }
  function observeMobileArt() {
    mobileArtObserver?.disconnect();
    const art = document.querySelector('#home .release-hero__cover');
    if (!art || innerWidth > 768 || !('IntersectionObserver' in window)) { syncMobileDock(); return; }
    const headerHeight = document.querySelector('.site-header').getBoundingClientRect().height;
    mobileArtPast = art.getBoundingClientRect().bottom <= headerHeight;
    mobileArtObserver = new IntersectionObserver(([entry]) => {
      mobileArtPast = !entry.isIntersecting && entry.boundingClientRect.bottom <= headerHeight + 1;
      syncMobileDock();
    }, { rootMargin: `-${Math.ceil(headerHeight)}px 0px 0px 0px`, threshold: 0 });
    mobileArtObserver.observe(art);
    syncMobileDock();
  }
  function updateHeroParallax() {
    heroParallaxFrame = 0;
    const art = document.querySelector('.release-hero__cover');
    if (!art) return;
    const active = document.body.dataset.view === 'home' && innerWidth <= 760 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offset = active ? Math.min(42, Math.max(0, (document.querySelector('.site-header').offsetHeight - $('home').getBoundingClientRect().top) * .2)) : 0;
    art.style.setProperty('--hero-parallax', `${offset.toFixed(1)}px`);
    if (innerWidth <= 768) syncMobileDock();
  }
  function requestHeroParallax() {
    if (!heroParallaxFrame) heroParallaxFrame = requestAnimationFrame(updateHeroParallax);
  }
  function select(track, autoplay = false) {
    selected = track; $('persistent-player').hidden = false; $('player-title').textContent = track.title;
    syncMobileDock();
    document.body.classList.add('has-music-player');
    $('now-playing-empty').hidden = true;
    $('now-playing-content').hidden = false;
    updatePlayerFavorite();
    $('player-artist').textContent = track.artist;
    syncCardPlayback();
    $('now-playing-title').textContent = track.title;
    $('now-playing-artist').textContent = track.artist;
    $('now-playing-genre').textContent = track.genre || 'DTRX RELEASE';
    $('player-expand').innerHTML = cover(track);
    $('now-playing-art').innerHTML = cover(track);
    $('now-playing-elapsed').textContent = '0:00';
    $('now-playing-duration').textContent = format(track.duration);
    $('now-playing-progress').value = 0;
    loadLyrics(track);
    $('player-toggle').disabled = !available(track); $('player-progress').disabled = !available(track);
    $('player-progress').value = 0; $('player-progress').style.setProperty('--seek-progress', '0%'); $('player-progress').setAttribute('aria-valuetext', `0:00 of ${format(track.duration)}`);
    $('now-playing-toggle').disabled = !available(track); $('now-playing-progress').disabled = !available(track);
    $('player-time').textContent = `0:00 / ${format(track.duration)}`;
    $('player-mobile-time').textContent = `0:00 / ${format(track.duration)}`;
    if (!available(track)) return;
    if (audio.src !== new URL(track.audioUrl, location.href).href) { audio.src = track.audioUrl; audio.load(); }
    if (autoplay) audio.play().catch(() => {});
  }
  function format(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
  async function loadLyrics(track) {
    const request = ++lyricRequest;
    const toggle = $('now-playing-lyrics-toggle');
    const panel = $('now-playing-lyrics');
    const lines = $('now-playing-lyrics-lines');
    lyricLines = [];
    lines.replaceChildren();
    panel.hidden = true;
    toggle.hidden = !track.lyricsUrl;
    toggle.setAttribute('aria-expanded', 'false');
    if (!track.lyricsUrl) return;
    $('now-playing-lyrics-status').textContent = 'Loading lyrics…';
    try {
      const response = await fetch(track.lyricsUrl);
      if (!response.ok) throw new Error('Lyrics unavailable');
      const lrc = await response.text();
      if (request !== lyricRequest) return;
      lyricLines = lrc.split(/\r?\n/).flatMap(line => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        if (match) return match[3] ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }] : [];
        if (/^\[[^\]]+\]/.test(line) || !line.trim()) return [];
        return [{ time: null, text: line.trim() }];
      });
      for (const item of lyricLines) {
        const paragraph = document.createElement('p');
        paragraph.textContent = item.text;
        lines.appendChild(paragraph);
      }
      $('now-playing-lyrics-status').textContent = lyricLines.length ? (lyricLines.some(line => line.time !== null) ? '' : 'Untimed lyrics') : 'Lyrics unavailable.';
    } catch {
      if (request !== lyricRequest) return;
      $('now-playing-lyrics-status').textContent = 'Lyrics unavailable.';
    }
  }
  function syncLyrics() {
    if (!lyricLines.length) return;
    const index = lyricLines.findLastIndex(line => line.time !== null && line.time <= audio.currentTime);
    [...$('now-playing-lyrics-lines').children].forEach((line, position) => line.classList.toggle('is-active', position === index));
  }
  function selectRelative(direction, autoplay = false) {
    if (!selected || tracks.length < 2) return;
    const index = tracks.findIndex(track => track.id === selected.id);
    if (shuffleEnabled && direction > 0) {
      const options = tracks.filter(track => available(track) && track.id !== selected.id);
      if (options.length) { select(options[Math.floor(Math.random() * options.length)], autoplay); return; }
    }
    for (let step = 1; step < tracks.length; step++) {
      const candidate = tracks[(index + direction * step + tracks.length) % tracks.length];
      if (available(candidate)) { select(candidate, autoplay); return; }
    }
  }
  function setupVisualizer() {
    if (audioContext) { if (audioContext.state === 'suspended') audioContext.resume(); return; }
    audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.55;
    source = audioContext.createMediaElementSource(audio); source.connect(analyser); analyser.connect(audioContext.destination);
  }
  function bandAverage(data, fromHz, toHz) {
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.ceil(fromHz / binHz));
    const end = Math.min(data.length - 1, Math.floor(toHz / binHz));
    let total = 0; for (let i = start; i <= end; i++) total += data[i];
    return total / Math.max(1, end - start + 1) / 255;
  }
  function adaptiveLevel(name, raw) {
    const state = adaptive[name];
    state.peak = Math.max(raw, state.peak * 0.997);
    state.floor = Math.min(raw, state.floor * 0.995 + raw * 0.005);
    const normalized = Math.max(0, Math.min(1, (raw - state.floor) / Math.max(0.06, state.peak - state.floor)));
    const target = raw < 0.018 ? 0 : Math.min(1, normalized * 0.82 + raw * 0.6);
    const rate = target > levels[name] ? 0.58 : 0.09;
    levels[name] += (target - levels[name]) * rate;
    return levels[name];
  }
  function updatePlanetLevels(rawBass, rawMid, rawHigh, rms) {
    const gate = rms < .005 ? 0 : 1;
    const beatTarget = gate && rawBass > .12 ? Math.min(1, Math.max(0, (rms - planetRmsAverage - .025) * 4)) : 0;
    planetRmsAverage += (rms - planetRmsAverage) * (rms > planetRmsAverage ? .025 : .09);
    planetLevels.beat += (beatTarget - planetLevels.beat) * (beatTarget > planetLevels.beat ? .7 : .16);
    const targets = { bass: Math.min(1, Math.max(0, (rawBass - .035) / .58)) * gate, mid: Math.min(1, Math.max(0, (rawMid - .045) / .42)) * gate, high: Math.min(1, Math.max(0, (rawHigh - .04) / .35)) * gate };
    for (const band of ['bass', 'mid', 'high']) {
      const rate = targets[band] > planetLevels[band] ? .46 : .085;
      planetLevels[band] += (targets[band] - planetLevels[band]) * rate;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = innerWidth <= 768;
    const homeVisible = !location.hash || location.hash === '#home';
    const art = mobileDockActive ? $('mobile-visualizer-dock') : (!mobile || (homeVisible && !mobileArtPast && !$('now-playing-dialog').open) ? document.querySelector('#home .release-hero__cover') : null);
    if (!art) return;
    art.style.setProperty('--planet-scale', (1 + planetLevels.bass * (reduced ? .003 : .014) + (reduced ? 0 : planetLevels.beat * .004)).toFixed(4));
    art.style.setProperty('--planet-brightness', (1 + planetLevels.bass * .15).toFixed(3));
    art.style.setProperty('--planet-atmosphere', (.12 + planetLevels.bass * .42 + planetLevels.beat * .1).toFixed(3));
    art.style.setProperty('--planet-details', (.04 + planetLevels.high * .22).toFixed(3));
    art.style.setProperty('--planet-horizon', (.18 + planetLevels.bass * .45 + planetLevels.beat * .12).toFixed(3));
    art.style.setProperty('--planet-rim', (.03 + planetLevels.bass * .1 + planetLevels.beat * .14 + planetLevels.high * .03).toFixed(3));
  }
  function clearVisualizer() {
    cancelAnimationFrame(visualizerFrame); visualizerFrame = 0;
    planetLevels.bass = planetLevels.mid = planetLevels.high = planetLevels.beat = 0;
    planetRmsAverage = 0;
    planetBars.fill(0);
    for (const art of [document.querySelector('#home .release-hero__cover'), $('mobile-visualizer-dock')]) {
      if (art) for (const name of ['--planet-scale', '--planet-brightness', '--planet-atmosphere', '--planet-details', '--planet-horizon', '--planet-rim']) art.style.removeProperty(name);
    }
    const canvas = $('music-visualizer'); const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nowCanvas = $('now-playing-visualizer');
    nowCanvas.getContext('2d').clearRect(0, 0, nowCanvas.width, nowCanvas.height);
    for (const id of ['hero-mini-visualizer', 'sidebar-mini-visualizer']) {
      const mini = $(id);
      if (mini) mini.getContext('2d').clearRect(0, 0, mini.width, mini.height);
    }
  }
  function drawMiniBars(canvas, data, count) {
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const left = width * .03, span = width * .94;
    const gap = 2 * ratio, barWidth = Math.max(1.5 * ratio, (span - gap * (count - 1)) / count);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const horizonY = t => height * (.87 - .12 * (1 - Math.pow(2 * t - 1, 2)));
    for (let i = 0; i < count; i++) {
      const hz = 35 * Math.pow(9000 / 35, i / Math.max(1, count - 1));
      const bin = Math.min(data.length - 1, Math.max(1, Math.round(hz / binHz)));
      const energy = Math.pow((data[Math.max(1, bin - 1)] + data[bin] * 2 + data[Math.min(data.length - 1, bin + 1)]) / (4 * 255), .9);
      const t = (i + .5) / count, edge = Math.pow(Math.sin(Math.PI * t), .6);
      const base = horizonY(.03 + t * .94);
      const barHeight = Math.min(base - height * .12, energy * height * .76) * edge;
      if (barHeight < ratio) continue;
      const x = left + i * (barWidth + gap) + barWidth / 2;
      const color = i < count * .3 ? '#55c4f7' : i < count * .75 ? '#e477ee' : '#ad86f5';
      const beam = ctx.createLinearGradient(0, base - barHeight, 0, base + 2 * ratio);
      beam.addColorStop(0, color + '80'); beam.addColorStop(.35, color + 'e8'); beam.addColorStop(1, color + '00');
      ctx.globalAlpha = edge * .95;
      ctx.strokeStyle = beam; ctx.lineWidth = Math.max(2 * ratio, barWidth * .72); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, base - barHeight); ctx.lineTo(x, base + 2 * ratio); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const horizon = ctx.createLinearGradient(0, 0, width, 0);
    horizon.addColorStop(0, 'rgba(82,193,250,0)');
    horizon.addColorStop(.3, 'rgba(82,193,250,.55)');
    horizon.addColorStop(.6, 'rgba(228,119,238,.7)');
    horizon.addColorStop(1, 'rgba(176,126,247,0)');
    ctx.beginPath();
    for (let point = 0; point <= 40; point++) {
      const t = point / 40;
      point ? ctx.lineTo(t * width, horizonY(t)) : ctx.moveTo(0, horizonY(0));
    }
    ctx.strokeStyle = horizon; ctx.lineWidth = 1.5 * ratio; ctx.stroke();
  }
  function drawPlanetVisualizer(data) {
    const mobile = innerWidth <= 768;
    if (mobile && !mobileDockActive && (mobileArtPast || (location.hash && location.hash !== '#home'))) return;
    const canvas = $(mobile && mobileDockActive ? 'mobile-visualizer-canvas' : 'hero-mini-visualizer');
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const compact = canvas.id === 'mobile-visualizer-canvas';
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? .5 : 1;
    const count = planetBars.length, left = width * .11, span = width * .78;
    const gap = 2.5 * ratio, barWidth = (span - gap * (count - 1)) / count;
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const horizonY = t => height * (.83 - .2 * (1 - Math.pow(2 * t - 1, 2)) + planetLevels.mid * .014 * Math.sin(t * Math.PI * 4));
    const colors = ['#23adf0', '#cd49e6', '#9361ec'];
    const accents = [['67,188,255', .29], ['224,112,238', .53], ['172,130,241', .76]];
    // Diffuse light below the curved horizon ties the spectrum to the image's clouds.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const [color, center] of accents) {
      const base = horizonY(center);
      const haze = ctx.createRadialGradient(width * center, base, 0, width * center, base, width * .25);
      haze.addColorStop(0, `rgba(${color},${(.11 + planetLevels.bass * .17 + planetLevels.mid * .08).toFixed(3)})`);
      haze.addColorStop(.45, `rgba(${color},.045)`);
      haze.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, base - height * .55, width, height * 1.15);
    }
    ctx.restore();
    for (let i = 0; i < count; i++) {
      const hz = 35 * Math.pow(9000 / 35, i / (count - 1));
      const bin = Math.min(data.length - 1, Math.max(1, Math.round(hz / binHz)));
      const energy = Math.pow((data[Math.max(1, bin - 1)] + data[bin] * 2 + data[Math.min(data.length - 1, bin + 1)]) / (4 * 255), 1.05);
      const rate = energy > planetBars[i] ? .68 : .1;
      planetBars[i] += (energy - planetBars[i]) * rate;
      const t = (i + .5) / count, edge = Math.pow(Math.sin(Math.PI * t), 1.2);
      const base = horizonY(.11 + t * .78);
      const response = Math.min(1, planetBars[i] * (compact ? 1.14 : 1));
      const barHeight = Math.min(base - height * .07, response * height * ((compact ? .72 : .52) + planetLevels.mid * .04) * (1 + planetLevels.bass * .06) * (1 + planetLevels.beat * .16)) * edge * motion;
      if (barHeight < ratio) continue;
      const x = left + i * (barWidth + gap) + barWidth / 2;
      const color = colors[i < 16 ? 0 : i < 35 ? 1 : 2];
      const beam = ctx.createLinearGradient(0, base - barHeight, 0, base + 4 * ratio);
      beam.addColorStop(0, color + '9a');
      beam.addColorStop(.28, color + 'f2');
      beam.addColorStop(.8, color + 'd0');
      beam.addColorStop(1, color + '00');
      ctx.globalAlpha = edge * (compact ? 1 : .85);
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(2 * ratio, barWidth * .8);
      ctx.lineCap = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = Math.min((compact ? 5 : 9) * ratio, barHeight * .15);
      ctx.beginPath(); ctx.moveTo(x, base - barHeight); ctx.lineTo(x, base + 4 * ratio); ctx.stroke();
      ctx.shadowBlur = 0;
      if (motion === 1 && i > 28 && i % 3 === 0 && planetLevels.high > .08) {
        ctx.globalAlpha = edge * planetLevels.high * .5;
        ctx.fillStyle = '#e17af0';
        ctx.beginPath(); ctx.arc(x, base - barHeight, (1 + planetLevels.high) * ratio, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // A second, audio-shaped ribbon moves with the smoothed spectrum at the horizon.
    ctx.beginPath();
    for (let point = 0; point <= 64; point++) {
      const t = .11 + point / 64 * .78;
      const index = Math.min(count - 2, Math.floor(point / 64 * (count - 1)));
      const energy = (planetBars[Math.max(0, index - 1)] + planetBars[index] + planetBars[index + 1]) / 3;
      const edge = Math.sin(Math.PI * point / 64);
      const y = horizonY(t) - energy * height * (.05 + planetLevels.beat * .02) * edge * motion;
      point ? ctx.lineTo(t * width, y) : ctx.moveTo(t * width, y);
    }
    ctx.strokeStyle = 'rgba(196,73,230,.62)';
    ctx.lineWidth = (1 + planetLevels.mid * 1.2) * ratio;
    ctx.shadowColor = '#cd86ef'; ctx.shadowBlur = (3 + planetLevels.mid * 5) * ratio;
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.beginPath();
    for (let point = 0; point <= 64; point++) {
      const t = point / 64, x = t * width, y = horizonY(t);
      point ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const waveColor = ctx.createLinearGradient(0, 0, width, 0);
    waveColor.addColorStop(0, 'rgba(67,188,255,0)');
    waveColor.addColorStop(.22, 'rgba(40,166,241,.7)');
    waveColor.addColorStop(.55, 'rgba(205,67,229,.82)');
    waveColor.addColorStop(.82, 'rgba(135,82,231,.65)');
    waveColor.addColorStop(1, 'rgba(211,105,250,0)');
    ctx.strokeStyle = waveColor; ctx.lineWidth = (1.4 + planetLevels.bass * 1.6) * ratio;
    ctx.shadowColor = '#b960df'; ctx.shadowBlur = (6 + planetLevels.bass * 10) * ratio;
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  function drawNowPlayingVisualizer(data) {
    const canvas = $('now-playing-visualizer');
    if (!$('now-playing-dialog').open || !canvas.clientWidth) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const bars = 48, gap = 3 * ratio, barWidth = (width - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const hz = 35 * Math.pow(10000 / 35, i / (bars - 1));
      const bin = Math.min(data.length - 1, Math.round(hz / (audioContext.sampleRate / analyser.fftSize)));
      const energy = data[bin] / 255;
      const barHeight = Math.max(2 * ratio, Math.pow(energy, .75) * height * .94);
      ctx.fillStyle = i < 16 ? '#e77be8' : i < 34 ? '#ad82fa' : '#77b9f8';
      ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
  }
  function drawHeroVisualizer(spectrum, waveform) {
    const canvas = $('hero-audio-visualizer');
    if (!canvas || !canvas.clientWidth) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const size = Math.round(canvas.clientWidth * ratio);
    if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2, base = size * .295;
    const bass = spectrum ? levels.bass : 0;
    const mid = spectrum ? levels.mid : 0;
    const high = spectrum ? levels.high : 0;
    const pulse = spectrum ? Math.min(1, beatPulse) : 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = reduced ? .3 : 1;
    const radius = base * (1 + Math.min(.17, (bass * .1 + pulse * .12) * motion));
    const glow = ctx.createRadialGradient(cx, cy, radius * .65, cx, cy, radius * 1.42);
    glow.addColorStop(0, `rgba(181, 83, 255, ${.06 + bass * .12})`);
    glow.addColorStop(1, 'rgba(181, 83, 255, 0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, radius * 1.42, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = '#e777ff'; ctx.shadowBlur = spectrum ? (9 + bass * 25 + pulse * 18) * ratio : 4 * ratio;
    ctx.strokeStyle = `rgba(237, 143, 255, ${.55 + bass * .4})`; ctx.lineWidth = 2.5 * ratio;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(117, 113, 255, ${.22 + mid * .34})`; ctx.lineWidth = ratio;
    ctx.beginPath(); ctx.arc(cx, cy, radius * .86, 0, Math.PI * 2); ctx.stroke();
    const count = 88, binHz = audioContext ? audioContext.sampleRate / analyser.fftSize : 22;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 - Math.PI / 2;
      const hz = 45 * Math.pow(10000 / 45, i / (count - 1));
      const bin = Math.min(spectrum?.length - 1 || 0, Math.round(hz / binHz));
      const energy = spectrum ? spectrum[bin] / 255 : 0;
      const length = (3 + Math.pow(energy, .72) * 23 * motion) * ratio;
      const start = radius + 9 * ratio;
      ctx.strokeStyle = i < 22 ? `rgba(244, 119, 239, ${.3 + energy * .7})` : i < 62 ? `rgba(177, 113, 255, ${.28 + energy * .68})` : `rgba(85, 200, 255, ${.27 + energy * .68})`;
      ctx.lineWidth = 2 * ratio; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start);
      ctx.lineTo(cx + Math.cos(angle) * (start + length), cy + Math.sin(angle) * (start + length)); ctx.stroke();
    }
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius * .82, 0, Math.PI * 2); ctx.clip();
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      for (let x = -radius; x <= radius; x += 3 * ratio) {
        const fraction = (x + radius) / (2 * radius);
        const index = waveform ? Math.min(waveform.length - 1, Math.floor(fraction * waveform.length)) : 0;
        const sample = waveform ? (waveform[index] - 128) / 128 : 0;
        const y = cy + (layer - 1) * radius * .23 + sample * radius * (.5 + mid * .22) * motion;
        x === -radius ? ctx.moveTo(cx + x, y) : ctx.lineTo(cx + x, y);
      }
      ctx.strokeStyle = ['#eb75ed', '#8d75ff', '#5dbfff'][layer]; ctx.globalAlpha = spectrum ? .32 + mid * .32 : .2;
      ctx.lineWidth = (1.5 + high) * ratio; ctx.stroke();
    }
    ctx.restore();
  }
  function drawVisualizer() {
    if (document.hidden) { visualizerFrame = 0; return; }
    if (audio.paused || !analyser) { clearVisualizer(); return; }
    const canvas = $('music-visualizer'); const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio)); const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); const data = new Uint8Array(analyser.frequencyBinCount); const timeData = new Uint8Array(analyser.fftSize); analyser.getByteFrequencyData(data); analyser.getByteTimeDomainData(timeData);
    drawNowPlayingVisualizer(data);
    drawHeroVisualizer(data, timeData);
    const motionSafe = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smoothing = motionSafe ? 1 : 0.14;
    const rawBass = bandAverage(data, 30, 150), rawMid = bandAverage(data, 150, 2000), rawHigh = bandAverage(data, 2000, 10000);
    let sum = 0; for (const value of timeData) { const sample = (value - 128) / 128; sum += sample * sample; }
    const rms = Math.sqrt(sum / timeData.length);
    if (motionSafe) { levels.bass = rawBass; levels.mid = rawMid; levels.high = rawHigh; }
    else { adaptiveLevel('bass', rawBass); adaptiveLevel('mid', rawMid); adaptiveLevel('high', rawHigh); }
    updatePlanetLevels(rawBass, rawMid, rawHigh, rms);
    drawPlanetVisualizer(data);
    drawMiniBars($('sidebar-mini-visualizer'), data, 24);
    const bassOnset = Math.max(0, levels.bass - previousBass); previousBass = levels.bass;
    beatPulse = Math.max(bassOnset * 5.5, beatPulse * 0.84);
    window.DTRX_PLAYER_AUDIO_STATE = { playing: true, bass: levels.bass, mid: levels.mid, high: levels.high, rms, peak: Math.max(...data) / 255, pulse: Math.min(1, beatPulse), raw: { bass: rawBass, mid: rawMid, high: rawHigh }, spectrum: data, binHz: audioContext.sampleRate / analyser.fftSize, context: audioContext.state };
    if (debugPanel) {
      debugFrames++;
      const now = performance.now();
      if (now - debugLast >= 250) {
        debugFps = Math.round(debugFrames * 1000 / Math.max(1, now - debugLast)); debugFrames = 0; debugLast = now;
        debugPanel.textContent = `Audio: ${audio.paused ? 'paused' : 'playing'} | Context: ${audioContext.state}\nRMS: ${rms.toFixed(3)} | Peak: ${(Math.max(...data) / 255).toFixed(3)}\nBass: ${levels.bass.toFixed(3)} (${rawBass.toFixed(3)})\nMid: ${levels.mid.toFixed(3)} (${rawMid.toFixed(3)})\nTreble: ${levels.high.toFixed(3)} (${rawHigh.toFixed(3)})\nFFT: ${analyser.fftSize} | bin: ${(audioContext.sampleRate / analyser.fftSize).toFixed(1)} Hz | FPS: ${debugFps}`;
      }
    }
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5, cy = height * 0.5, base = Math.min(height * 0.38, width * 0.11);
    const radius = base + levels.bass * base * 2.25;
    const gradient = ctx.createRadialGradient(cx, cy, radius * .3, cx, cy, radius * 2.4);
    gradient.addColorStop(0, `rgba(181, 132, 255, ${.16 + levels.bass * .23})`); gradient.addColorStop(.55, `rgba(231, 90, 217, ${.04 + levels.mid * .09})`); gradient.addColorStop(1, 'rgba(231, 90, 217, 0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(cx, cy, radius * 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(221, 193, 255, ${.34 + levels.high * .6})`; ctx.lineWidth = Math.max(1.5 * ratio, ratio * (2 + levels.high * 3)); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(231, 90, 217, ${.12 + levels.mid * .4})`; ctx.lineWidth = ratio; ctx.beginPath();
    for (let i = 0; i <= 32; i++) { const angle = (i / 32) * Math.PI * 2; const wave = levels.mid * base * .92 * Math.sin(i * 2.1); const r = radius * 1.48 + wave; const x = cx + Math.cos(angle) * r; const y = cy + Math.sin(angle) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke();
    const bars = 40; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, ratio * 1.5);
    for (let i = 0; i < bars; i++) { const angle = (i / bars) * Math.PI * 2 - Math.PI / 2; const sample = data[Math.floor((i / bars) * Math.min(data.length, 96))] / 255; const length = (motionSafe ? sample * .35 : sample) * base * .72; const inner = radius * 1.72; const outer = inner + length; ctx.strokeStyle = i % 3 === 0 ? `rgba(231, 90, 217, ${.22 + sample * .65})` : `rgba(153, 107, 255, ${.18 + sample * .58})`; ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); ctx.stroke(); }
    visualizerFrame = requestAnimationFrame(drawVisualizer);
  }
  function openRoute() {
    const dialog = $('track-dialog');
    const match = location.hash.match(/^#track\/([\w-]+)$/);
    if (!match) { if (dialog.open) dialog.close(); return; }
    const track = tracks.find(t => t.id === match[1]);
    if (!track) return;
    $('track-dialog-content').innerHTML = `<p class="featured-kicker">DTRX release</p><h2>${escaped(track.title)}</h2><p>${escaped(track.artist)}</p><p>Genre: ${track.genre ? escaped(track.genre) : 'To be added'}<br>Audio: ${available(track) ? 'Available' : 'Not added yet'}<br>Artwork: ${track.coverUrl ? 'Available' : 'Not added yet'}<br>Lyrics: ${track.lyricsUrl ? 'Available' : 'Not added yet'}</p><button class="btn btn-primary" type="button" data-action="play" data-id="${track.id}" ${available(track) ? '' : 'disabled'}>${available(track) ? 'Play release' : 'Audio coming soon'}</button>`;
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) { const track = tracks.find(t => t.id === button.dataset.id); if (!track) return; if (button.dataset.action === 'play') { select(track, true); setupVisualizer(); } if (button.dataset.action === 'favorite') { favorites.has(track.id) ? favorites.delete(track.id) : favorites.add(track.id); saveFavorites(); updatePlayerFavorite(); render(); } } const genreButton = event.target.closest('[data-genre]'); if (genreButton) { genre = genreButton.dataset.genre; libraryView = 'all'; render(); } const view = event.target.closest('[data-library-view]'); if (view) { libraryView = view.dataset.libraryView; render(); } });
  $('track-search').addEventListener('input', event => { filter = event.target.value.trim().toLowerCase(); render(); });
  $('dialog-close').addEventListener('click', () => { $('track-dialog').close(); location.hash = '#library'; });
  const togglePlayback = () => { if (!selected || !available(selected)) return; setupVisualizer(); audio.paused ? audio.play() : audio.pause(); };
  $('player-toggle').addEventListener('click', togglePlayback);
  $('player-favorite').addEventListener('click', () => { if (!selected) return; favorites.has(selected.id) ? favorites.delete(selected.id) : favorites.add(selected.id); saveFavorites(); updatePlayerFavorite(); render(); });
  $('player-shuffle').addEventListener('click', () => { shuffleEnabled = !shuffleEnabled; $('player-shuffle').setAttribute('aria-pressed', String(shuffleEnabled)); $('player-shuffle').setAttribute('aria-label', `Shuffle ${shuffleEnabled ? 'on' : 'off'}`); });
  $('now-playing-toggle').addEventListener('click', togglePlayback);
  $('player-previous').addEventListener('click', () => selectRelative(-1, !audio.paused));
  $('player-next').addEventListener('click', () => selectRelative(1, !audio.paused));
  $('now-playing-previous').addEventListener('click', () => selectRelative(-1, !audio.paused));
  $('now-playing-next').addEventListener('click', () => selectRelative(1, !audio.paused));
  $('player-repeat').addEventListener('click', () => { repeatEnabled = !repeatEnabled; $('player-repeat').setAttribute('aria-pressed', String(repeatEnabled)); $('player-repeat').setAttribute('aria-label', `Repeat ${repeatEnabled ? 'on' : 'off'}`); $('player-repeat').classList.toggle('is-active', repeatEnabled); });
  $('player-expand').addEventListener('click', () => { if (!$('now-playing-dialog').open) $('now-playing-dialog').showModal(); });
  $('player-open').addEventListener('click', () => { if (!$('now-playing-dialog').open) $('now-playing-dialog').showModal(); });
  $('now-playing-close').addEventListener('click', () => $('now-playing-dialog').close());
  $('now-playing-dialog').addEventListener('close', syncMobileDock);
  $('now-playing-dialog').addEventListener('toggle', syncMobileDock);
  $('now-playing-browse').addEventListener('click', () => $('now-playing-dialog').close());
  $('now-playing-lyrics-toggle').addEventListener('click', () => {
    const panel = $('now-playing-lyrics');
    panel.hidden = !panel.hidden;
    $('now-playing-lyrics-toggle').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) syncLyrics();
  });
  $('player-volume').addEventListener('input', event => { audio.volume = event.target.value; });
  audio.addEventListener('play', () => { setupVisualizer(); syncMobileDock(); syncCardPlayback(); window.DTRX_PLAYER_AUDIO_STATE = { ...(window.DTRX_PLAYER_AUDIO_STATE || {}), playing: true }; window.dispatchEvent(new Event('dtrx-audio-state')); const hv = document.querySelector('.hero-visual'); if (hv) hv.classList.add('playing'); $('player-toggle').innerHTML = pauseGlyph; $('now-playing-toggle').textContent = 'Pause'; $('player-toggle').setAttribute('aria-label', 'Pause selected track'); if (!visualizerFrame) drawVisualizer(); });
  audio.addEventListener('pause', () => { previousBass = 0; beatPulse = 0; syncMobileDock(); syncCardPlayback(); window.DTRX_PLAYER_AUDIO_STATE = { ...(window.DTRX_PLAYER_AUDIO_STATE || {}), playing: false }; const hv = document.querySelector('.hero-visual'); if (hv) hv.classList.remove('playing'); if (debugPanel) debugPanel.textContent = `Audio: paused | Context: ${audioContext?.state || 'not created'}\nVisualizer at rest`; $('player-toggle').innerHTML = playGlyph; $('now-playing-toggle').textContent = 'Play'; $('player-toggle').setAttribute('aria-label', 'Play selected track'); clearVisualizer(); });
  const seek = event => { if (audio.duration) { audio.currentTime = audio.duration * event.target.value / 100; syncTime(); } };
  $('player-progress').addEventListener('input', seek);
  $('now-playing-progress').addEventListener('input', seek);
  document.addEventListener('visibilitychange', () => { syncMobileDock(); if (!document.hidden && !audio.paused && !visualizerFrame) drawVisualizer(); });
  const syncTime = () => { const progress = audio.duration ? audio.currentTime / audio.duration * 100 : 0; $('player-progress').value = progress; $('player-progress').style.setProperty('--seek-progress', `${progress}%`); $('player-progress').setAttribute('aria-valuetext', `${format(audio.currentTime)} of ${format(audio.duration)}`); $('now-playing-progress').value = progress; $('player-time').textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`; $('player-mobile-time').textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`; $('now-playing-elapsed').textContent = format(audio.currentTime); $('now-playing-duration').textContent = format(audio.duration || selected?.duration); syncLyrics(); };
  audio.addEventListener('timeupdate', syncTime);
  audio.addEventListener('loadedmetadata', syncTime);
  audio.addEventListener('ended', () => { if (repeatEnabled) { audio.currentTime = 0; audio.play().catch(() => {}); return; } selectRelative(1, true); });
  audio.addEventListener('error', () => { if (!selected) return; $('player-toggle').disabled = true; $('now-playing-toggle').disabled = true; $('player-time').textContent = 'Audio unavailable'; });
  window.addEventListener('hashchange', () => { if (location.hash === '#favorites' || location.hash === '#library' || location.hash.startsWith('#track/')) { libraryView = location.hash === '#favorites' ? 'favorites' : 'all'; render(); } openRoute(); });
  window.addEventListener('scroll', requestHeroParallax, { passive: true });
  window.addEventListener('resize', requestHeroParallax);
  window.addEventListener('hashchange', () => { requestHeroParallax(); requestAnimationFrame(syncMobileDock); });
  window.addEventListener('resize', observeMobileArt);
  if (location.hash === '#favorites') libraryView = 'favorites';
  render(); openRoute();
})();
