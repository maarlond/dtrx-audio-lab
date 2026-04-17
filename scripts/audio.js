/**
 * ═══════════════════════════════════════════════════════════
 *  DTRX AUDIO LAB — audio.js
 *  Web Audio API — Headphone Test, Drop Engine, Depth Field,
 *  Visual Feedback, Particles, Scroll Reveals
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// AUDIO LAB NAMESPACE — single global object, no pollution
// ─────────────────────────────────────────────────────────────
const AudioLab = (() => {

    /* ────────────────────────────────────
       SHARED: AudioContext (lazy init)
    ──────────────────────────────────── */
    let ctx = null;

    /**
     * Returns (or creates) the shared AudioContext.
     * Must be called from a user gesture to satisfy browser policy.
     */
    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }


    /* ════════════════════════════════════
       MODULE 1 — HEADPHONE TEST
       Smooth L → R sweep using panner automation
    ════════════════════════════════════ */
    const headphone = (() => {

        let osc = null; // oscillator
        let panner = null; // StereoPannerNode
        let gain = null; // master gain for fade in/out
        let rafId = null; // requestAnimationFrame id
        let startT = 0;    // audio context time when sweep started

        // DOM refs (resolved on first use)
        let elCursor = null;
        let elStatus = null;
        let elBtnStart = null;
        let elBtnStop = null;
        let elMeterL = null;
        let elMeterR = null;

        // Config
        const SWEEP_DURATION = 4;    // seconds for one full L→R sweep
        const FREQ = 440;  // Hz
        const FADE_TIME = 0.05; // seconds for gain fade

        /** Resolve DOM elements once */
        function _initDOM() {
            elCursor = document.getElementById('channel-cursor');
            elStatus = document.getElementById('channel-status');
            elBtnStart = document.getElementById('btn-start-test');
            elBtnStop = document.getElementById('btn-stop-test');
            elMeterL = document.querySelector('.meter--left  .meter-fill');
            elMeterR = document.querySelector('.meter--right .meter-fill');
        }

        /**
         * Update the visual cursor + meters every animation frame.
         * pan: -1 (left) → +1 (right)
         */
        function _tick() {
            const ac = getCtx();
            const elapsed = ac.currentTime - startT;
            const progress = (elapsed % SWEEP_DURATION) / SWEEP_DURATION; // 0–1 cyclic

            // Smooth sine-based panning (not linear — feels more natural)
            const pan = Math.sin(progress * Math.PI * 2) * 0.5; // -0.5 to +0.5
            // Convert pan to cursor position (0–100%)
            const pct = ((pan + 1) / 2) * 100;

            // Move cursor
            if (elCursor) {
                elCursor.style.left = `${pct}%`;
                elCursor.classList.add('is-moving');
            }

            // Volume meters: left is loudest at pan=-1, right at pan=+1
            const volL = Math.max(0, (1 - pan) / 2);
            const volR = Math.max(0, (1 + pan) / 2);
            if (elMeterL) elMeterL.style.height = `${(volL * 0.8 + 0.1) * 100}%`;
            if (elMeterR) elMeterR.style.height = `${(volR * 0.8 + 0.1) * 100}%`;

            // Status text
            if (elStatus) {
                if (pan < -0.15) elStatus.textContent = '← LEFT CHANNEL';
                else if (pan > 0.15) elStatus.textContent = 'RIGHT CHANNEL →';
                else elStatus.textContent = '— CENTER —';
            }

            rafId = requestAnimationFrame(_tick);
        }

        /** Start the headphone sweep test */
        function start() {
            _initDOM();
            const ac = getCtx();
            if (osc) stop(); // stop any existing

            // Oscillator (filtered to sound smoother)
            osc = ac.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = FREQ;

            // Gentle bandpass for warmth
            const bp = ac.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = FREQ;
            bp.Q.value = 1;

            // Panner node
            panner = ac.createStereoPanner();

            // Gain node (fade in)
            gain = ac.createGain();
            gain.gain.setValueAtTime(0, ac.currentTime);
            gain.gain.linearRampToValueAtTime(0.35, ac.currentTime + FADE_TIME);

            // Automated panner: one full sweep every SWEEP_DURATION seconds
            // Uses setValueCurveAtTime for a smooth sine sweep
            const steps = 512;
            const curve = new Float32Array(steps);
            for (let i = 0; i < steps; i++) {
                curve[i] = Math.sin((i / steps) * Math.PI * 2); // sine: left→center→right→center→left
            }
            panner.pan.setValueCurveAtTime(curve, ac.currentTime, SWEEP_DURATION);

            // Repeat the curve by scheduling it every SWEEP_DURATION
            // (handled by the recursive RAF re-scheduling via automation)
            // We use setInterval to re-schedule after each cycle
            gain._sweepInterval = setInterval(() => {
                if (!panner) return;
                try {
                    panner.pan.setValueCurveAtTime(curve, ac.currentTime, SWEEP_DURATION);
                } catch (e) { /* ignore overlap edge cases */ }
            }, SWEEP_DURATION * 1000);

            // Connect graph
            osc.connect(bp);
            bp.connect(panner);
            panner.connect(gain);
            gain.connect(ac.destination);
            osc.start();

            startT = ac.currentTime;
            rafId = requestAnimationFrame(_tick);

            // Update UI state
            if (elStatus) { elStatus.textContent = 'Testing…'; elStatus.classList.add('is-active'); }
            if (elBtnStart) elBtnStart.disabled = true;
            if (elBtnStop) elBtnStop.disabled = false;
        }

        /** Stop and clean up */
        function stop() {
            _initDOM();
            const ac = getCtx();

            if (gain) {
                gain.gain.linearRampToValueAtTime(0, ac.currentTime + FADE_TIME);
                if (gain._sweepInterval) clearInterval(gain._sweepInterval);
            }
            setTimeout(() => {
                try { if (osc) osc.stop(); } catch (_) { }
                osc = panner = gain = null;
            }, (FADE_TIME + 0.01) * 1000);

            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

            // Reset visuals
            if (elCursor) { elCursor.style.left = '0%'; elCursor.classList.remove('is-moving'); }
            if (elMeterL) elMeterL.style.height = '0%';
            if (elMeterR) elMeterR.style.height = '0%';
            if (elStatus) { elStatus.textContent = 'Stopped'; elStatus.classList.remove('is-active'); }
            if (elBtnStart) elBtnStart.disabled = false;
            if (elBtnStop) elBtnStop.disabled = true;
        }

        return { start, stop };
    })();


    /* ════════════════════════════════════
       MODULE 2 — PSEUDO 3D DEPTH FIELD
       Binaural-ish figure-8 using panner +
       convolution reverb (impulse response from noise)
    ════════════════════════════════════ */
    const depth = (() => {

        let active = false;
        let osc = null;
        let panner3D = null;
        let gainNode = null;
        let convolver = null;
        let rafId = null;
        let startT = 0;

        const DURATION = 6; // seconds for one full orbit

        /** Build a simple reverb impulse response from white noise */
        function _buildImpulse(ac, duration = 1.5, decay = 3) {
            const sr = ac.sampleRate;
            const length = sr * duration;
            const buf = ac.createBuffer(2, length, sr);
            for (let c = 0; c < 2; c++) {
                const data = buf.getChannelData(c);
                for (let i = 0; i < length; i++) {
                    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
                }
            }
            return buf;
        }

        /** Animate 3D panner position in a figure-8 around the listener */
        function _tick() {
            const ac = getCtx();
            const elapsed = (ac.currentTime - startT) % DURATION;
            const t = (elapsed / DURATION) * Math.PI * 2;

            // Figure-8 (lemniscate): x = sin(t), z = sin(t)cos(t), y = 0
            const x = Math.sin(t);
            const z = Math.sin(t) * Math.cos(t);

            if (panner3D) {
                panner3D.positionX.value = x * 3;
                panner3D.positionY.value = 0;
                panner3D.positionZ.value = z * 3;
            }

            rafId = requestAnimationFrame(_tick);
        }

        function toggle() {
            const btn = document.getElementById('btn-depth-test');
            if (active) {
                _stop();
                if (btn) btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
          Activate Depth Field`;
                document.body.classList.remove('depth-active');
            } else {
                _start();
                if (btn) btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
          Deactivate Depth Field`;
                document.body.classList.add('depth-active');
            }
            active = !active;
        }

        function _start() {
            const ac = getCtx();

            osc = ac.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 200;

            const detuned = ac.createOscillator();
            detuned.type = 'sine';
            detuned.frequency.value = 200.5; // slight detune for thickness

            // 3D panner
            panner3D = ac.createPanner();
            panner3D.panningModel = 'HRTF';  // use head-related transfer function
            panner3D.distanceModel = 'inverse';
            panner3D.refDistance = 1;
            panner3D.maxDistance = 10000;
            panner3D.rolloffFactor = 1;
            panner3D.coneInnerAngle = 360;

            // Reverb
            convolver = ac.createConvolver();
            convolver.buffer = _buildImpulse(ac);

            // Gain
            gainNode = ac.createGain();
            gainNode.gain.setValueAtTime(0, ac.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.2, ac.currentTime + 0.1);

            const merger = ac.createChannelMerger(2);

            osc.connect(panner3D);
            detuned.connect(panner3D);
            panner3D.connect(convolver);
            panner3D.connect(gainNode);
            convolver.connect(gainNode);
            gainNode.connect(ac.destination);

            osc.start();
            detuned.start();

            startT = ac.currentTime;
            rafId = requestAnimationFrame(_tick);
        }

        function _stop() {
            const ac = getCtx();
            if (gainNode) gainNode.gain.linearRampToValueAtTime(0, ac.currentTime + 0.1);
            setTimeout(() => {
                try { if (osc) osc.stop(); } catch (_) { }
                osc = panner3D = gainNode = convolver = null;
            }, 150);
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        }

        return { toggle };
    })();


    /* ════════════════════════════════════
       MODULE 3 — DROP ENGINE
       Layered: sub bass + white noise burst +
       detuned saws + pitch drop
    ════════════════════════════════════ */
    const drop = (() => {

        let meterRafId = null;
        let analyser = null;
        let meterBars = [];

        /** Build the visual impact meter bars (one-time) */
        function _initMeter() {
            const container = document.querySelector('.drop-meter-bars');
            if (!container || container.children.length > 0) return;
            const BAR_COUNT = 32;
            for (let i = 0; i < BAR_COUNT; i++) {
                const bar = document.createElement('div');
                bar.className = 'drop-meter-bar';
                // Color gradient L→R: cyan→magenta
                const ratio = i / BAR_COUNT;
                const r = Math.round(ratio * 255);
                const g = Math.round((1 - ratio) * 200);
                const b = Math.round(255 - ratio * 127);
                bar.style.background = `rgb(${r},${g},${b})`;
                container.appendChild(bar);
                meterBars.push(bar);
            }
        }

        /** Animate meter from analyser data */
        function _tickMeter() {
            if (!analyser) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const step = Math.floor(data.length / meterBars.length);
            meterBars.forEach((bar, i) => {
                const val = data[i * step] / 255;
                bar.style.height = `${Math.max(4, val * 60)}px`;
            });
            meterRafId = requestAnimationFrame(_tickMeter);
        }

        /** Create a detuned oscillator bank for the "saw" hit */
        function _createSawHit(ac, dest) {
            const freqs = [55, 55.3, 54.7, 110, 165];
            const gainAmt = 0.08;
            freqs.forEach((f, i) => {
                const o = ac.createOscillator();
                const g = ac.createGain();
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(f, ac.currentTime);
                o.frequency.exponentialRampToValueAtTime(f * 0.5, ac.currentTime + 0.5);

                g.gain.setValueAtTime(gainAmt, ac.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);

                o.connect(g);
                g.connect(dest);
                o.start(ac.currentTime);
                o.stop(ac.currentTime + 0.65);
            });
        }

        /** White noise burst */
        function _createNoiseBurst(ac, dest) {
            const bufSize = ac.sampleRate * 0.25;
            const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

            const src = ac.createBufferSource();
            src.buffer = buf;

            // High-pass so it sounds like a snare transient
            const hp = ac.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 2000;

            const g = ac.createGain();
            g.gain.setValueAtTime(0.4, ac.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);

            src.connect(hp);
            hp.connect(g);
            g.connect(dest);
            src.start(ac.currentTime);
        }

        /** Pitch-drop sub bass: deep rumble that falls in pitch */
        function _createSubDrop(ac, dest) {
            const osc = ac.createOscillator();
            const g = ac.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(90, ac.currentTime);
            osc.frequency.exponentialRampToValueAtTime(28, ac.currentTime + 0.9);

            g.gain.setValueAtTime(0.9, ac.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.0);

            const compressor = ac.createDynamicsCompressor();
            compressor.threshold.value = -12;
            compressor.knee.value = 6;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.1;

            osc.connect(g);
            g.connect(compressor);
            compressor.connect(dest);
            osc.start(ac.currentTime);
            osc.stop(ac.currentTime + 1.05);
        }

        /** Visual: flash + rings + button animation */
        function _triggerVisuals() {
            // Screen flash
            const flash = document.getElementById('drop-flash');
            if (flash) {
                flash.classList.remove('flash');
                void flash.offsetWidth; // reflow
                flash.classList.add('flash');
            }

            // Button animation
            const btn = document.getElementById('btn-drop');
            if (btn) {
                btn.classList.remove('fired');
                void btn.offsetWidth;
                btn.classList.add('fired');
            }

            // Rings burst
            const rings = document.querySelectorAll('.drop-ring');
            rings.forEach(ring => {
                ring.classList.remove('burst');
                void ring.offsetWidth;
                ring.classList.add('burst');
            });

            // Shake body briefly
            document.body.style.transform = 'translateX(2px)';
            setTimeout(() => { document.body.style.transform = 'translateX(-2px)'; }, 50);
            setTimeout(() => { document.body.style.transform = 'translateX(1px)'; }, 100);
            setTimeout(() => { document.body.style.transform = ''; }, 150);
        }

        /** Main fire function — called from HTML onclick */
        function fire() {
            _initMeter();
            const ac = getCtx();

            // Build a shared analyser for the meter
            if (!analyser) {
                analyser = ac.createAnalyser();
                analyser.fftSize = 256;
                analyser.connect(ac.destination);
            }
            if (meterRafId) cancelAnimationFrame(meterRafId);
            _tickMeter();
            setTimeout(() => {
                cancelAnimationFrame(meterRafId);
                meterBars.forEach(b => b.style.height = '4px');
            }, 1200);

            _createSubDrop(ac, analyser);
            _createSawHit(ac, analyser);
            _createNoiseBurst(ac, analyser);
            _triggerVisuals();
        }

        return { fire };
    })();


    /* ════════════════════════════════════
       MODULE 4 — PARTICLE CANVAS
       Floating audio particles in the background
    ════════════════════════════════════ */
    const particles = (() => {
        let canvas, ctx2d, W, H;
        let particles = [];
        const COUNT = 60;

        function _createParticle() {
            return {
                x: Math.random() * W,
                y: Math.random() * H,
                r: Math.random() * 1.5 + 0.3,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -(Math.random() * 0.4 + 0.1),
                a: Math.random(),
                hue: Math.random() > 0.7 ? 310 : 190, // cyan or magenta
            };
        }

        function _resize() {
            W = canvas.width = window.innerWidth;
            H = canvas.height = window.innerHeight;
        }

        function _tick() {
            ctx2d.clearRect(0, 0, W, H);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.a -= 0.002;
                if (p.a <= 0 || p.y < -10) Object.assign(p, _createParticle(), { y: H + 10, a: Math.random() * 0.5 + 0.1 });

                ctx2d.beginPath();
                ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx2d.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.a})`;
                ctx2d.fill();
            });
            requestAnimationFrame(_tick);
        }

        function init() {
            canvas = document.getElementById('particle-canvas');
            if (!canvas) return;
            ctx2d = canvas.getContext('2d');
            _resize();
            window.addEventListener('resize', _resize);
            for (let i = 0; i < COUNT; i++) particles.push(_createParticle());
            _tick();
        }

        return { init };
    })();


    /* ════════════════════════════════════
       MODULE 5 — HERO WAVEFORM BARS
       Animated decorative bars in hero visual
    ════════════════════════════════════ */
    const heroWaveform = (() => {
        function init() {
            const container = document.getElementById('hero-waveform');
            if (!container) return;
            const BAR_COUNT = 28;
            for (let i = 0; i < BAR_COUNT; i++) {
                const bar = document.createElement('div');
                bar.className = 'waveform-bar';
                // Vary height using a bell curve shape
                const pos = i / BAR_COUNT;
                const bell = Math.sin(pos * Math.PI);
                const h = (bell * 0.6 + 0.2 + Math.random() * 0.2) * 100;
                bar.style.maxHeight = `${h}%`;
                bar.style.setProperty('--dur', `${0.5 + Math.random() * 1}s`);
                bar.style.setProperty('--delay', `${Math.random() * 0.8}s`);
                // Alternate colors
                if (i % 4 === 0) bar.style.background = 'var(--neon-magenta)';
                container.appendChild(bar);
            }
        }
        return { init };
    })();


    /* ════════════════════════════════════
       MODULE 6 — SCROLL REVEAL
       Intersection Observer for .reveal elements
    ════════════════════════════════════ */
    const scrollReveal = (() => {
        function init() {
            const targets = document.querySelectorAll('.section-inner, .hp-card, .player-card, .cta-card, .drop-arena, .drop-meter');
            if (!('IntersectionObserver' in window)) {
                targets.forEach(el => el.classList.add('is-visible'));
                return;
            }
            targets.forEach(el => el.classList.add('reveal'));
            const observer = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        e.target.classList.add('is-visible');
                        observer.unobserve(e.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
            targets.forEach(el => observer.observe(el));
        }
        return { init };
    })();


    /* ════════════════════════════════════
       MODULE 7 — BUTTON RIPPLE EFFECT
       Adds a click ripple to all .btn elements
    ════════════════════════════════════ */
    const ripple = (() => {
        function _addRipple(e) {
            const btn = e.currentTarget;
            const rect = btn.getBoundingClientRect();
            const size = Math.max(btn.offsetWidth, btn.offsetHeight);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            const span = document.createElement('span');
            span.className = 'ripple';
            span.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
            btn.appendChild(span);
            span.addEventListener('animationend', () => span.remove());
        }

        function init() {
            document.querySelectorAll('.btn').forEach(btn => {
                btn.addEventListener('click', _addRipple);
            });
        }
        return { init };
    })();


    /* ════════════════════════════════════
       INIT — run on DOMContentLoaded
    ════════════════════════════════════ */
    function _init() {
        particles.init();
        heroWaveform.init();
        scrollReveal.init();
        ripple.init();

        // Smooth active state for nav links
        const navLinks = document.querySelectorAll('.nav-link');
        const sections = document.querySelectorAll('.section');
        const observer = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    const id = e.target.id;
                    navLinks.forEach(a => {
                        a.style.color = a.getAttribute('href') === `#${id}`
                            ? 'var(--neon-cyan)' : '';
                    });
                }
            });
        }, { threshold: 0.4 });
        sections.forEach(s => observer.observe(s));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }


    // ─── Public API ───────────────────────────────
    return { headphone, depth, drop };

})();