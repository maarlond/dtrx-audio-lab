/**
 * ═══════════════════════════════════════════════════════════
 *  DTRX AUDIO LAB — exit-popup.js
 *
 *  Exit-intent popup com CTA para o YouTube.
 *  Estratégias de trigger:
 *    1. Mouse leave (desktop) — cursor sai pelo topo da janela
 *    2. Scroll-up rápido (mobile) — comportamento de "vou embora"
 *    3. Tempo mínimo na página — só dispara após engajamento real
 *    4. Sessão única — não incomoda quem já viu ou clicou
 *
 *  Como adicionar ao projeto:
 *    1. Copie este arquivo para scripts/exit-popup.js
 *    2. Copie exit-popup.css para styles/exit-popup.css
 *    3. No index.html, antes de </head>:
 *         <link rel="stylesheet" href="styles/exit-popup.css">
 *    4. No index.html, antes de </body>:
 *         <script src="scripts/exit-popup.js"></script>
 *    5. Atualize YOUTUBE_URL abaixo com o link real do canal
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

const ExitPopup = (() => {

    /* ─────────────────────────────────────
       CONFIGURAÇÃO — edite aqui
    ───────────────────────────────────── */
    const CONFIG = {
        youtubeUrl: 'https://www.youtube.com/@dtrxbeats',
        // Mínimo de segundos na página antes de poder disparar
        minTimeOnPage: 15,
        // Quantos pixels o mouse precisa estar do topo para disparar
        topThreshold: 30,
        // Chave no sessionStorage — popup não repete na mesma sessão
        storageKey: 'dtrx_exit_seen',
        // Chave no localStorage — popup não repete se o usuário já clicou "Inscrever"
        subscribedKey: 'dtrx_subscribed',
        // Delay em ms após o trigger antes de abrir (evita abertura acidental)
        triggerDelay: 300,
    };

    /* ─────────────────────────────────────
       ESTADO INTERNO
    ───────────────────────────────────── */
    let _isOpen = false;
    let _canTrigger = false; // true após minTimeOnPage
    let _triggered = false; // garante disparo único por sessão
    let _overlay = null;
    let _triggerTimer = null;
    let _lastScrollY = 0;
    let _scrollVelocity = 0;

    /* ─────────────────────────────────────
       VERIFICAÇÕES DE SESSÃO/LOCAL STORAGE
    ───────────────────────────────────── */
    function _alreadySeen() {
        try {
            return (
                sessionStorage.getItem(CONFIG.storageKey) === '1' ||
                localStorage.getItem(CONFIG.subscribedKey) === '1'
            );
        } catch (_) { return false; }
    }

    function _markSeen() {
        try { sessionStorage.setItem(CONFIG.storageKey, '1'); } catch (_) { }
    }

    function _markSubscribed() {
        try { localStorage.setItem(CONFIG.subscribedKey, '1'); } catch (_) { }
    }

    /* ─────────────────────────────────────
       BUILD HTML DO POPUP
    ───────────────────────────────────── */
    function _buildDOM() {
        // Overlay
        const overlay = document.createElement('div');
        overlay.className = 'exit-overlay';
        overlay.id = 'exit-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'exit-headline');

        overlay.innerHTML = `
      <div class="exit-popup" id="exit-popup">

        <!-- Fechar -->
        <button class="exit-popup__close" id="exit-close" aria-label="Fechar">✕</button>

        <!-- Visual decorativo: mini waveform -->
        <div class="exit-popup__visual" id="exit-waveform" aria-hidden="true"></div>

        <!-- Corpo -->
        <div class="exit-popup__body">

          <!-- Tag de urgência -->
          <span class="exit-popup__tag">
            <span class="exit-tag-dot" aria-hidden="true"></span>
            Antes de ir embora
          </span>

          <!-- Headline -->
          <h2 class="exit-popup__headline" id="exit-headline">
            Você ainda não<br>ouviu o <em>drop.</em>
          </h2>

          <!-- Sub -->
          <p class="exit-popup__sub">
            O melhor está no canal. Produções EDM cinemáticas, drops exclusivos e novidades toda semana — tudo no DTRX Beats.
          </p>

          <!-- Benefícios -->
          <ul class="exit-popup__benefits" aria-label="Motivos para se inscrever">
            <li>
              <svg class="exit-benefit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
              Novos tracks toda semana
            </li>
            <li>
              <svg class="exit-benefit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              Drops exclusivos para inscritos
            </li>
            <li>
              <svg class="exit-benefit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              Ative o 🔔 e nunca perca um lançamento
            </li>
          </ul>

          <!-- Ações -->
          <div class="exit-popup__actions">
            <a
              href="${CONFIG.youtubeUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="exit-btn-subscribe"
              id="exit-btn-subscribe"
              aria-label="Inscrever-se no canal DTRX no YouTube"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.75 15.5v-7l6.25 3.5-6.25 3.5z"/>
              </svg>
              Inscrever-se no YouTube — é grátis
            </a>

            <button class="exit-btn-dismiss" id="exit-btn-dismiss">
              Não, prefiro perder os drops
            </button>
          </div>

          <!-- Social proof -->
          <p class="exit-popup__note">🎧 Feito para quem ouve de verdade</p>

        </div>
      </div>
    `;

        document.body.appendChild(overlay);
        _overlay = overlay;

        // Gera waveform decorativa
        _buildWaveform();

        return overlay;
    }

    /* ─────────────────────────────────────
       WAVEFORM DECORATIVA (mini)
    ───────────────────────────────────── */
    function _buildWaveform() {
        const container = document.getElementById('exit-waveform');
        if (!container) return;
        const BAR_COUNT = 36;
        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = document.createElement('div');
            bar.className = 'exit-wave-bar';
            // Perfil de onda: mais alto no centro
            const pos = i / BAR_COUNT;
            const bell = Math.sin(pos * Math.PI);
            const h = (bell * 0.7 + 0.2 + Math.random() * 0.1) * 100;
            bar.style.height = `${h}%`;
            // Alterna cyan / magenta
            bar.style.setProperty('--ep-color', i % 5 === 0 ? '#ff0080' : '#00c8ff');
            bar.style.setProperty('--ep-dur', `${0.4 + Math.random() * 0.9}s`);
            bar.style.setProperty('--ep-delay', `${Math.random() * 0.7}s`);
            container.appendChild(bar);
        }
    }

    /* ─────────────────────────────────────
       ABRIR POPUP
    ───────────────────────────────────── */
    function open() {
        if (_isOpen || _alreadySeen()) return;
        if (!_overlay) _buildDOM();

        _isOpen = true;
        _markSeen();

        // Foco no popup para acessibilidade
        requestAnimationFrame(() => {
            _overlay.classList.add('is-open');
            const closeBtn = document.getElementById('exit-close');
            if (closeBtn) closeBtn.focus();
        });

        // Trava scroll do body
        document.body.style.overflow = 'hidden';

        _bindEvents();

        // Analytics hook (descomente e substitua pela sua implementação)
        _trackEvent('exit_popup_shown');
    }

    /* ─────────────────────────────────────
       FECHAR POPUP
    ───────────────────────────────────── */
    function close() {
        if (!_isOpen) return;
        _isOpen = false;
        _overlay.classList.remove('is-open');
        document.body.style.overflow = '';

        // Animação de saída — remove após transição
        setTimeout(() => {
            if (_overlay && _overlay.parentNode) {
                _overlay.parentNode.removeChild(_overlay);
                _overlay = null;
            }
        }, 400);

        _trackEvent('exit_popup_dismissed');
    }

    /* ─────────────────────────────────────
       BIND EVENTS DO POPUP
    ───────────────────────────────────── */
    function _bindEvents() {
        // Fechar pelo X
        const closeBtn = document.getElementById('exit-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // Fechar pelo "Não, obrigado"
        const dismissBtn = document.getElementById('exit-btn-dismiss');
        if (dismissBtn) dismissBtn.addEventListener('click', close);

        // Fechar clicando fora do card (no overlay)
        _overlay.addEventListener('click', e => {
            if (e.target === _overlay) close();
        });

        // Fechar com Escape
        document.addEventListener('keydown', _onKeydown);

        // Botão principal: marcar como inscrito
        const subBtn = document.getElementById('exit-btn-subscribe');
        if (subBtn) {
            subBtn.addEventListener('click', () => {
                _markSubscribed();
                // _trackEvent('exit_popup_subscribe_click');
                // Fecha com um pequeno delay para o usuário ver o clique
                setTimeout(close, 300);
            });
        }
    }

    function _onKeydown(e) {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', _onKeydown);
        }
    }

    /* ─────────────────────────────────────
       TRIGGER — DESKTOP: mouseleave pelo topo
    ───────────────────────────────────── */
    function _onMouseLeave(e) {
        // Só dispara se o mouse sair pela borda superior
        if (e.clientY > CONFIG.topThreshold) return;
        _scheduleOpen();
    }

    /* ─────────────────────────────────────
       TRIGGER — MOBILE: scroll para cima rápido
    ───────────────────────────────────── */
    function _onScroll() {
        const currentY = window.scrollY;
        const delta = _lastScrollY - currentY; // positivo = scrollando pra cima
        _scrollVelocity = delta;
        _lastScrollY = currentY;

        // Só dispara se:
        // 1. Scrollou para cima (delta > 0)
        // 2. Com velocidade suficiente (> 60px em um frame)
        // 3. Não está no topo da página
        if (delta > 60 && currentY > 300) {
            _scheduleOpen();
        }
    }

    /* ─────────────────────────────────────
       AGENDAMENTO COM DELAY ANTI-ACIDENTAL
    ───────────────────────────────────── */
    function _scheduleOpen() {
        if (_triggered || _alreadySeen() || !_canTrigger) return;
        _triggered = true;

        clearTimeout(_triggerTimer);
        _triggerTimer = setTimeout(open, CONFIG.triggerDelay);
    }

    /* ─────────────────────────────────────
       ANALYTICS HELPER (stub)
    ───────────────────────────────────── */
    function _trackEvent(eventName) {
        //   // Google Analytics 4:
        if (window.gtag) gtag('event', eventName, { event_category: 'exit_popup' });
        //   //
        //   // Meta Pixel:
        if (window.fbq) fbq('trackCustom', eventName);
        console.log('[DTRX ExitPopup]', eventName);
    }

    /* ─────────────────────────────────────
       INIT
    ───────────────────────────────────── */
    function init() {
        // Não inicializa se já viu ou já se inscreveu
        if (_alreadySeen()) return;

        // Libera o trigger após minTimeOnPage segundos
        setTimeout(() => { _canTrigger = true; }, CONFIG.minTimeOnPage * 1000);

        // Desktop: detecta saída do mouse pelo topo
        document.addEventListener('mouseleave', _onMouseLeave);

        // Mobile: detecta scroll rápido para cima
        let scrollThrottle = false;
        window.addEventListener('scroll', () => {
            if (!scrollThrottle) {
                scrollThrottle = true;
                requestAnimationFrame(() => {
                    _onScroll();
                    scrollThrottle = false;
                });
            }
        }, { passive: true });

        // Fallback: dispara ao clicar no botão Voltar do browser (pagehide)
        window.addEventListener('pagehide', () => {
            if (!_triggered && _canTrigger) open();
        });
    }

    /* ─────────────────────────────────────
       AUTO-INIT ao carregar o script
    ───────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // API pública (para testes manuais no console: ExitPopup.open())
    return { open, close, init };

})();