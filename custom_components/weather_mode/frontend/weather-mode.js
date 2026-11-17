/*
 * Weather Mode for Home Assistant
 * A full-screen overlay that mirrors the weather outside: rain, snow, sleet,
 * hail, sun rays, drifting clouds, fog, frost round the edges, lightning,
 * wind and stars. It follows the "Weather mode" toggle in Settings > System > Labs.
 *
 * https://github.com/AdminsApples/ha-weather-mode
 */
(() => {
  const TAG = "weather-mode-overlay";
  const VERSION = "0.1.0";
  if (customElements.get(TAG)) return;

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const NARROW_PX = 870;

  const EMPTY = {
    rain: 0, snow: 0, hail: 0, clouds: 0, sun: 0, stars: 0,
    fog: 0, frost: 0, wind: 0, lightning: false, dark_clouds: false,
  };

  const STYLE = `
    :host {
      position: fixed; inset: 0; pointer-events: none; z-index: 9999;
      overflow: hidden; contain: strict;
    }
    .layer { position: absolute; inset: 0; pointer-events: none; transition: opacity 3s ease; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

    /* ---------- Sun ---------- */
    .sun { opacity: 0; }
    .sun .glow {
      position: absolute; top: -35vmax; right: -35vmax; width: 80vmax; height: 80vmax;
      border-radius: 50%;
      background: radial-gradient(circle, var(--sun-core) 0%, var(--sun-mid) 18%, transparent 62%);
      animation: pulse 9s ease-in-out infinite;
    }
    .sun .rays {
      position: absolute; top: -90vmax; right: -90vmax; width: 180vmax; height: 180vmax;
      background: repeating-conic-gradient(from 0deg,
        var(--ray) 0deg 3deg, transparent 3deg 11deg, var(--ray-soft) 11deg 13deg, transparent 13deg 22deg);
      -webkit-mask-image: radial-gradient(circle, #000 4%, rgba(0,0,0,0.55) 22%, transparent 48%);
              mask-image: radial-gradient(circle, #000 4%, rgba(0,0,0,0.55) 22%, transparent 48%);
      animation: spin 140s linear infinite;
    }
    .sun .rays.two { animation-duration: 210s; animation-direction: reverse; opacity: 0.6; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }

    /* ---------- Clouds ---------- */
    .clouds { opacity: 0; }
    .cloud {
      position: absolute; left: 0; will-change: transform;
      filter: blur(var(--blur, 10px));
      animation: drift linear infinite;
    }
    @keyframes drift {
      from { transform: translateX(-60vw); }
      to { transform: translateX(120vw); }
    }

    /* ---------- Fog ---------- */
    .fog { opacity: 0; }
    .fog .bank {
      position: absolute; left: 0; width: 300vw; will-change: transform;
      animation: fogdrift linear infinite;
    }
    .fog .wash { position: absolute; inset: 0; background: var(--fog-wash); }
    @keyframes fogdrift { from { transform: translateX(0); } to { transform: translateX(-150vw); } }

    /* ---------- Frost ---------- */
    .frost { opacity: 0; transition: opacity 6s ease; }

    /* ---------- Lightning ---------- */
    .flash { opacity: 0; background: var(--flash); transition: none; }

    @media (prefers-reduced-motion: reduce) {
      :host { display: none !important; }
    }
  `;

  class WeatherModeOverlay extends HTMLElement {
    constructor() {
      super();
      this.overlay = { ...EMPTY };
      this.enabled = false;
      this.dark = false;
      this.narrow = window.innerWidth < NARROW_PX;
      this.showOnMobile = true;
      this.particles = { rain: [], snow: [], hail: [], wind: [], stars: [], sparkles: [] };
      this.bolt = null;
      this.shootingStar = null;
      this._raf = null;
      this._last = 0;
      this._lightningTimer = null;
      this._frostKey = "";

      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>${STYLE}</style>
        <div class="layer sun"><div class="glow"></div><div class="rays"></div><div class="rays two"></div></div>
        <div class="layer clouds"></div>
        <div class="layer fog"><div class="wash"></div></div>
        <canvas class="layer frost"></canvas>
        <canvas class="layer particles"></canvas>
        <div class="layer flash"></div>
      `;
      this.$ = (s) => root.querySelector(s);
      this.canvas = this.$("canvas.particles");
      this.ctx = this.canvas.getContext("2d");
      this.frostCanvas = this.$("canvas.frost");
      this._onResize = () => this._resize();
      this._onVisibility = () => this._loop();
    }

    connectedCallback() {
      this.setAttribute("aria-hidden", "true");
      window.addEventListener("resize", this._onResize);
      document.addEventListener("visibilitychange", this._onVisibility);
      this._resize();
    }

    disconnectedCallback() {
      window.removeEventListener("resize", this._onResize);
      document.removeEventListener("visibilitychange", this._onVisibility);
      cancelAnimationFrame(this._raf);
      clearTimeout(this._lightningTimer);
    }

    /* ------------------------------------------------------------------ */
    /* State                                                              */
    /* ------------------------------------------------------------------ */
    setPayload(payload) {
      this.enabled = !!(payload && payload.enabled);
      this.showOnMobile = payload?.show_on_mobile !== false;
      this.overlay = { ...EMPTY, ...(this.enabled ? payload.overlay || {} : {}) };
      this._apply();
    }

    setDark(dark) {
      if (dark === this.dark) return;
      this.dark = dark;
      this._applyColours();
      this._frostKey = "";
      this._drawFrost();
    }

    get visible() {
      return this.enabled && (this.showOnMobile || !this.narrow);
    }

    _level(name) {
      return this.visible ? clamp(Number(this.overlay[name]) || 0, 0, 1) : 0;
    }

    _apply() {
      this.style.display = this.visible ? "" : "none";
      this._applyColours();
      this.$(".sun").style.opacity = String(this._level("sun") * (this.dark ? 0.55 : 0.75));
      this._buildClouds();
      this._buildFog();
      this._drawFrost();
      this._syncParticles();
      this._scheduleLightning();
      this._loop();
    }

    _applyColours() {
      const d = this.dark;
      const o = this.overlay;
      const s = this.style;
      s.setProperty("--sun-core", d ? "rgba(255,228,160,0.30)" : "rgba(255,214,102,0.55)");
      s.setProperty("--sun-mid", d ? "rgba(255,210,130,0.10)" : "rgba(255,196,64,0.20)");
      s.setProperty("--ray", d ? "rgba(255,226,160,0.14)" : "rgba(255,190,60,0.22)");
      s.setProperty("--ray-soft", d ? "rgba(255,226,160,0.07)" : "rgba(255,190,60,0.12)");
      s.setProperty("--fog-wash", d ? "rgba(190,196,206,0.10)" : "rgba(214,218,224,0.28)");
      s.setProperty("--flash", d ? "rgba(235,240,255,0.9)" : "rgba(255,255,255,0.95)");
      this.cloudColour = o.dark_clouds
        ? (d ? "120,128,142" : "92,102,118")
        : (d ? "215,222,232" : "150,160,176");
      this.cloudAlpha = o.dark_clouds ? (d ? 0.2 : 0.24) : (d ? 0.1 : 0.15);
    }

    /* ------------------------------------------------------------------ */
    /* Clouds                                                             */
    /* ------------------------------------------------------------------ */
    _buildClouds() {
      const layer = this.$(".clouds");
      const level = this._level("clouds");
      const count = Math.round(level * (this.narrow ? 6 : 11));
      const key = `${count}|${this.cloudColour}|${this.cloudAlpha}`;
      layer.style.opacity = level > 0 ? "1" : "0";
      if (key === this._cloudKey) return;
      this._cloudKey = key;
      layer.textContent = "";
      const c = this.cloudColour;
      for (let i = 0; i < count; i++) {
        const el = document.createElement("div");
        el.className = "cloud";
        const w = rand(420, 900) * (this.narrow ? 0.7 : 1);
        const h = w * rand(0.14, 0.24);
        const a = this.cloudAlpha * rand(0.6, 1.15);
        const puffs = [];
        const n = 5 + Math.floor(Math.random() * 4);
        for (let p = 0; p < n; p++) {
          const x = 12 + (76 * p) / (n - 1) + rand(-6, 6);
          const y = rand(42, 66);
          const r = rand(18, 34);
          puffs.push(`radial-gradient(ellipse ${r}% ${r * 1.9}% at ${x}% ${y}%, rgba(${c},${a}) 0%, rgba(${c},${a * 0.6}) 45%, transparent 72%)`);
        }
        el.style.cssText = `
          top:${rand(-4, 38)}vh; width:${w}px; height:${h}px;
          background:${puffs.join(",")};
          --blur:${rand(14, 26)}px;
          animation-duration:${rand(70, 150)}s;
          animation-delay:-${rand(0, 150)}s;
        `;
        layer.appendChild(el);
      }
    }

    /* ------------------------------------------------------------------ */
    /* Fog                                                                */
    /* ------------------------------------------------------------------ */
    _buildFog() {
      const layer = this.$(".fog");
      const level = this._level("fog");
      layer.style.opacity = String(level);
      const key = `${level > 0}|${this.dark}`;
      if (key === this._fogKey) return;
      this._fogKey = key;
      layer.querySelectorAll(".bank").forEach((b) => b.remove());
      if (level <= 0) return;
      const c = this.dark ? "200,206,216" : "206,211,218";
      const banks = [
        { top: 10, h: 55, a: this.dark ? 0.10 : 0.30, dur: 110 },
        { top: 35, h: 55, a: this.dark ? 0.13 : 0.36, dur: 75 },
        { top: 55, h: 50, a: this.dark ? 0.16 : 0.42, dur: 52 },
      ];
      for (const b of banks) {
        const el = document.createElement("div");
        el.className = "bank";
        const blobs = [];
        for (let i = 0; i < 9; i++) {
          const x = (i / 8) * 100 + rand(-4, 4);
          blobs.push(`radial-gradient(ellipse ${rand(9, 16)}% ${rand(45, 70)}% at ${x}% ${rand(40, 60)}%, rgba(${c},${b.a}) 0%, rgba(${c},${b.a * 0.5}) 45%, transparent 75%)`);
        }
        el.style.cssText = `top:${b.top}vh; height:${b.h}vh; background:${blobs.join(",")}; filter:blur(18px); animation-duration:${b.dur}s; animation-delay:-${rand(0, b.dur)}s;`;
        layer.appendChild(el);
      }
    }

    /* ------------------------------------------------------------------ */
    /* Frost                                                              */
    /* ------------------------------------------------------------------ */
    _drawFrost() {
      const level = this._level("frost");
      this.frostCanvas.style.opacity = level > 0 ? "1" : "0";
      if (level <= 0) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const key = `${Math.round(level * 10)}|${w}|${h}|${this.dark}`;
      if (key === this._frostKey) return;
      this._frostKey = key;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = this.frostCanvas;
      cv.width = w * dpr;
      cv.height = h * dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const depth = Math.min(w, h) * (0.07 + level * 0.11);
      const tint = this.dark ? "225,240,255" : "150,195,230";
      const white = this.dark ? "235,244,255" : "235,246,255";
      // Frost reads much brighter on a dark background, so tone it down there.
      const k = this.dark ? 0.4 : 1;

      // Icy vignette, strongest in the corners.
      const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(${white},${0.55 * level * k})`);
        g.addColorStop(0.35, `rgba(${tint},${0.22 * level * k})`);
        g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
      };
      edge(0, 0, 0, depth, 0, 0, w, depth);
      edge(0, h, 0, h - depth, 0, h - depth, w, depth);
      edge(0, 0, depth, 0, 0, 0, depth, h);
      edge(w, 0, w - depth, 0, w - depth, 0, depth, h);
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, depth * 2.6);
        g.addColorStop(0, `rgba(${white},${0.6 * level * k})`);
        g.addColorStop(0.5, `rgba(${tint},${0.18 * level * k})`);
        g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Ice crystals: branching fern-like strokes growing in from the edges.
      ctx.lineCap = "round";
      const branch = (x, y, angle, len, width, gen) => {
        if (gen > 3 || len < 3) return;
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;
        ctx.strokeStyle = `rgba(${white},${(0.75 - gen * 0.12) * level * (this.dark ? 0.55 : 1)})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const spurs = Math.random() < 0.4 ? 3 : 2;
        for (let i = 1; i <= spurs; i++) {
          const t = i / (spurs + 1);
          const bx = x + (x2 - x) * t;
          const by = y + (y2 - y) * t;
          const l = len * rand(0.25, 0.5) * (1 - t * 0.5);
          branch(bx, by, angle + rand(0.7, 1.1), l, width * 0.65, gen + 1);
          branch(bx, by, angle - rand(0.7, 1.1), l, width * 0.65, gen + 1);
        }
        if (Math.random() < 0.6) branch(x2, y2, angle + rand(-0.3, 0.3), len * 0.6, width * 0.8, gen + 1);
      };
      const perEdge = Math.round((this.narrow ? 7 : 12) * (0.5 + level));
      const seeds = [];
      for (let i = 0; i < perEdge; i++) {
        seeds.push([rand(0, w), 0, Math.PI / 2]);
        seeds.push([rand(0, w), h, -Math.PI / 2]);
        seeds.push([0, rand(0, h), 0]);
        seeds.push([w, rand(0, h), Math.PI]);
      }
      for (const [cx, cy, base] of [[0, 0, Math.PI / 4], [w, 0, (3 * Math.PI) / 4], [0, h, -Math.PI / 4], [w, h, (-3 * Math.PI) / 4]]) {
        for (let i = 0; i < 4; i++) seeds.push([cx, cy, base + rand(-0.6, 0.6)]);
      }
      for (const [x, y, a] of seeds) {
        branch(x, y, a + rand(-0.5, 0.5), depth * rand(0.35, 0.8), rand(1, 1.8), 0);
      }

      // Sparkles that twinkle on the frost (drawn by the particle loop).
      this.particles.sparkles = [];
      const sparkleCount = Math.round(level * (this.narrow ? 25 : 50));
      for (let i = 0; i < sparkleCount; i++) {
        const side = Math.floor(Math.random() * 4);
        const d = rand(0, depth * 0.9);
        const p = side === 0 ? [rand(0, w), d] : side === 1 ? [rand(0, w), h - d] : side === 2 ? [d, rand(0, h)] : [w - d, rand(0, h)];
        this.particles.sparkles.push({ x: p[0], y: p[1], phase: rand(0, Math.PI * 2), speed: rand(1.5, 3.5), r: rand(0.8, 1.8) });
      }
    }

    /* ------------------------------------------------------------------ */
    /* Particles (rain, snow, hail, wind, stars)                          */
    /* ------------------------------------------------------------------ */
    _resize() {
      this.narrow = window.innerWidth < NARROW_PX;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = this.w * dpr;
      this.canvas.height = this.h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.particles.stars = [];
      this._apply();
    }

    _target(name, max) {
      return Math.round(this._level(name) * max * (this.narrow ? 0.5 : 1));
    }

    _syncParticles() {
      const P = this.particles;
      const wind = this._level("wind");
      this.windPush = wind;
      const resize = (arr, n, make) => {
        while (arr.length < n) arr.push(make(true));
        arr.length = n;
      };
      resize(P.rain, this._target("rain", 260), (initial) => this._makeRain(initial));
      resize(P.snow, this._target("snow", 170), (initial) => this._makeSnow(initial));
      resize(P.hail, this._target("hail", 140), (initial) => this._makeHail(initial));
      resize(P.wind, this._target("wind", 22), (initial) => this._makeWind(initial));
      resize(P.stars, this._target("stars", 110), () => this._makeStar());
    }

    _makeRain(initial) {
      return {
        x: rand(-this.w * 0.2, this.w * 1.1),
        y: initial ? rand(-this.h, this.h) : rand(-120, -20),
        len: rand(12, 26),
        speed: rand(950, 1350),
        width: rand(0.8, 1.6),
        a: rand(0.25, 0.55),
      };
    }

    _makeSnow(initial) {
      return {
        x: rand(0, this.w),
        y: initial ? rand(-this.h, this.h) : rand(-40, -10),
        r: rand(1.2, 4.2),
        speed: rand(35, 95),
        sway: rand(12, 40),
        phase: rand(0, Math.PI * 2),
        freq: rand(0.4, 1.2),
        rot: rand(0, Math.PI),
        a: rand(0.55, 0.95),
      };
    }

    _makeHail(initial) {
      return {
        x: rand(0, this.w),
        y: initial ? rand(-this.h, this.h) : rand(-60, -10),
        r: rand(1.4, 3.2),
        speed: rand(650, 950),
        bounce: 0,
        vy: 0,
        vx: 0,
      };
    }

    _makeWind(initial) {
      return {
        x: initial ? rand(-this.w, this.w) : rand(-this.w * 0.6, -100),
        y: rand(this.h * 0.05, this.h * 0.95),
        len: rand(90, 240),
        speed: rand(700, 1100),
        amp: rand(6, 22),
        freq: rand(0.004, 0.01),
        a: rand(0.3, 0.6),
      };
    }

    _makeStar() {
      return {
        x: rand(0, this.w),
        y: rand(0, this.h * 0.65),
        r: rand(0.5, 1.6),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.6, 2),
      };
    }

    _hasParticles() {
      const P = this.particles;
      return this.visible && (P.rain.length || P.snow.length || P.hail.length || P.wind.length ||
        P.stars.length || (P.sparkles.length && this._level("frost") > 0) || this.bolt);
    }

    _loop() {
      cancelAnimationFrame(this._raf);
      this._raf = null;
      if (document.hidden || !this._hasParticles()) {
        this.ctx.clearRect(0, 0, this.w || 0, this.h || 0);
        return;
      }
      this._last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - this._last) / 1000, 0.05);
        this._last = now;
        this._draw(dt, now / 1000);
        if (document.hidden || !this._hasParticles()) {
          this.ctx.clearRect(0, 0, this.w, this.h);
          this._raf = null;
          return;
        }
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    _draw(dt, t) {
      const ctx = this.ctx;
      const { w, h } = this;
      const P = this.particles;
      const d = this.dark;
      const push = this.windPush || 0;
      ctx.clearRect(0, 0, w, h);

      // Stars
      if (P.stars.length) {
        const c = d ? "255,255,255" : "120,140,190";
        for (const s of P.stars) {
          const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase))) * (d ? 0.9 : 0.55);
          ctx.fillStyle = `rgba(${c},${a})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        this._shootingStar(dt, c);
      }

      // Frost sparkles
      if (P.sparkles.length && this._level("frost") > 0) {
        const c = d ? "255,255,255" : "190,225,250";
        for (const s of P.sparkles) {
          const a = Math.max(0, Math.sin(t * s.speed + s.phase)) ** 6;
          if (a < 0.02) continue;
          ctx.strokeStyle = `rgba(${c},${a})`;
          ctx.lineWidth = 1;
          const r = s.r * 3 * a + 1;
          ctx.beginPath();
          ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y);
          ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x, s.y + r);
          ctx.stroke();
        }
      }

      // Wind streaks
      if (P.wind.length) {
        const c = d ? "230,236,245" : "105,120,140";
        ctx.lineWidth = 1.6;
        for (let i = 0; i < P.wind.length; i++) {
          const s = P.wind[i];
          s.x += s.speed * dt;
          if (s.x - s.len > w) P.wind[i] = this._makeWind(false);
          const g = ctx.createLinearGradient(s.x - s.len, 0, s.x, 0);
          g.addColorStop(0, `rgba(${c},0)`);
          g.addColorStop(0.7, `rgba(${c},${s.a})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.strokeStyle = g;
          ctx.beginPath();
          for (let k = 0; k <= 12; k++) {
            const x = s.x - s.len + (s.len * k) / 12;
            const y = s.y + Math.sin(x * s.freq + t) * s.amp;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Rain
      if (P.rain.length) {
        const c = d ? "190,210,240" : "70,105,150";
        const slant = 0.12 + push * 0.45;
        ctx.lineCap = "round";
        for (let i = 0; i < P.rain.length; i++) {
          const r = P.rain[i];
          r.y += r.speed * dt;
          r.x += r.speed * slant * dt;
          if (r.y - r.len > h || r.x > w + 50) {
            P.rain[i] = this._makeRain(false);
            continue;
          }
          ctx.strokeStyle = `rgba(${c},${r.a})`;
          ctx.lineWidth = r.width;
          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x - r.len * slant, r.y - r.len);
          ctx.stroke();
        }
      }

      // Snow
      if (P.snow.length) {
        const c = d ? "255,255,255" : "0,160,200";
        for (let i = 0; i < P.snow.length; i++) {
          const s = P.snow[i];
          s.y += s.speed * dt;
          s.phase += s.freq * dt;
          s.rot += dt * 0.4;
          const x = s.x + Math.sin(s.phase) * s.sway + push * 160 * (s.y / h);
          if (s.y - 10 > h) {
            P.snow[i] = this._makeSnow(false);
            continue;
          }
          ctx.fillStyle = ctx.strokeStyle = `rgba(${c},${s.a * (d ? 0.9 : 0.6)})`;
          if (s.r > 3.2) {
            // Bigger flakes get six arms.
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
              const a = s.rot + (k * Math.PI) / 3;
              ctx.moveTo(x, s.y);
              ctx.lineTo(x + Math.cos(a) * s.r * 1.6, s.y + Math.sin(a) * s.r * 1.6);
            }
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Hail: fast pellets that bounce off the bottom of the screen
      if (P.hail.length) {
        const c = d ? "235,240,248" : "120,140,165";
        ctx.fillStyle = `rgba(${c},0.85)`;
        for (let i = 0; i < P.hail.length; i++) {
          const s = P.hail[i];
          if (!s.bounce) {
            s.y += s.speed * dt;
            s.x += push * 200 * dt;
            if (s.y >= h - s.r) {
              s.bounce = 1;
              s.vy = -s.speed * rand(0.12, 0.22);
              s.vx = rand(-60, 60);
              s.y = h - s.r;
            }
          } else {
            s.vy += 1800 * dt;
            s.y += s.vy * dt;
            s.x += s.vx * dt;
            if (s.y > h + 10) {
              P.hail[i] = this._makeHail(false);
              continue;
            }
          }
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Lightning bolt
      if (this.bolt) {
        this.bolt.life -= dt;
        if (this.bolt.life <= 0) {
          this.bolt = null;
        } else {
          ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, this.bolt.life * 6)})`;
          ctx.shadowColor = "rgba(180,200,255,0.9)";
          ctx.shadowBlur = 18;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          this.bolt.points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }

    _shootingStar(dt, c) {
      const ctx = this.ctx;
      if (!this.shootingStar) {
        if (Math.random() < dt / 25) {
          this.shootingStar = { x: rand(this.w * 0.2, this.w), y: rand(0, this.h * 0.3), life: 1 };
        }
        return;
      }
      const s = this.shootingStar;
      s.life -= dt * 1.4;
      s.x -= 700 * dt;
      s.y += 260 * dt;
      if (s.life <= 0) {
        this.shootingStar = null;
        return;
      }
      const g = ctx.createLinearGradient(s.x, s.y, s.x + 120, s.y - 45);
      g.addColorStop(0, `rgba(${c},${s.life})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + 120, s.y - 45);
      ctx.stroke();
    }

    /* ------------------------------------------------------------------ */
    /* Lightning                                                          */
    /* ------------------------------------------------------------------ */
    _scheduleLightning() {
      const on = this.visible && !!this.overlay.lightning;
      if (!on) {
        clearTimeout(this._lightningTimer);
        this._lightningTimer = null;
        return;
      }
      if (this._lightningTimer) return;
      const next = () => {
        this._lightningTimer = setTimeout(() => {
          this._lightningTimer = null;
          if (!this.visible || !this.overlay.lightning) return;
          if (!document.hidden) this._strike();
          next();
        }, rand(5000, 16000));
      };
      next();
    }

    _strike() {
      const flash = this.$(".flash");
      const peak = this.dark ? 0.35 : 0.5;
      flash.animate(
        [
          { opacity: 0 },
          { opacity: peak, offset: 0.08 },
          { opacity: 0.05, offset: 0.2 },
          { opacity: peak * 0.8, offset: 0.3 },
          { opacity: 0 },
        ],
        { duration: 700, easing: "ease-out" }
      );
      // A jagged bolt from the top of the screen.
      const points = [];
      let x = rand(this.w * 0.15, this.w * 0.85);
      let y = 0;
      const bottom = rand(this.h * 0.35, this.h * 0.7);
      while (y < bottom) {
        points.push([x, y]);
        x += rand(-40, 40);
        y += rand(20, 55);
      }
      points.push([x, y]);
      this.bolt = { points, life: 0.25 };
      this._loop();
    }
  }

  customElements.define(TAG, WeatherModeOverlay);

  /* -------------------------------------------------------------------- */
  /* Wiring it into Home Assistant                                        */
  /* -------------------------------------------------------------------- */
  const overlay = document.createElement(TAG);
  let payload = { enabled: false };
  let subscribed = null;
  let retryAt = 0;

  const mount = () => {
    if (!overlay.isConnected && document.body) document.body.appendChild(overlay);
  };

  const haRoot = () => document.querySelector("home-assistant");

  // Hide the built-in Winter mode snowflakes while Weather mode is showing.
  const syncWinterMode = () => {
    const main = haRoot()?.shadowRoot?.querySelector("home-assistant-main");
    const flakes = main?.shadowRoot?.querySelector("ha-snowflakes");
    if (!flakes) return;
    const hide = payload.enabled && payload.hide_winter_mode !== false;
    const want = hide ? "none" : "";
    if (flakes.style.display !== want) flakes.style.display = want;
  };

  const syncTheme = () => {
    const hass = haRoot()?.hass;
    if (hass?.themes) overlay.setDark(!!hass.themes.darkMode);
  };

  const subscribe = async () => {
    const hass = haRoot()?.hass;
    const conn = hass?.connection;
    if (!conn || subscribed === conn || Date.now() < retryAt) return;
    subscribed = conn;
    try {
      await conn.subscribeMessage(
        (msg) => {
          payload = msg || { enabled: false };
          syncTheme();
          overlay.setPayload(payload);
          syncWinterMode();
        },
        { type: "weather_mode/subscribe" },
        { resubscribe: true }
      );
    } catch (err) {
      // Integration not loaded (e.g. removed): stay quiet and try again later.
      subscribed = null;
      retryAt = Date.now() + 60000;
      console.debug("Weather Mode: not available yet", err);
    }
  };

  const tick = () => {
    mount();
    subscribe();
    syncTheme();
    syncWinterMode();
  };

  tick();
  setInterval(tick, 3000);
  console.info(`%c WEATHER-MODE %c ${VERSION} `, "background:#2980d6;color:#fff;border-radius:3px 0 0 3px", "background:#555;color:#fff;border-radius:0 3px 3px 0");
})();
