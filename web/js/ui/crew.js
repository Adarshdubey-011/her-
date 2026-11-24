// The hero: a giant dry-brush wordmark with a hand-drawn crew living on the letters, doodles drifting down,
// eyes that follow the pointer, and a short "storyboard" entrance. Ported from the Doodle Crew footer.
import { ART, ACCENT, doodle } from "./art.js";

// ---------- pure helpers (unit-tested in tests/js/crew.test.mjs) ----------
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Left edge and width of each letter from per-letter advances (a bad advance counts as zero). */
export const layoutWord = (advances, tracking, fontSize) => {
  const x = [], w = [];
  let at = 0;
  const gap = (Number.isFinite(tracking) ? tracking : 0) * fontSize;
  for (let i = 0; i < advances.length; i++) {
    const a = Number.isFinite(advances[i]) && advances[i] > 0 ? advances[i] : 0;
    x.push(at); w.push(a);
    at += a + (i < advances.length - 1 ? gap : 0);
  }
  return { x, w, width: Math.max(0, at) };
};

/** Where a crew member stands (baseline y = 0, up is negative). */
export const seatPoint = (seat, letterX, letterW, cap, offset, scale) => {
  const x = letterX + letterW * (0.5 + (Number.isFinite(offset) ? offset : 0));
  if (seat === "top") return { x, y: -cap };
  if (seat === "behind") return { x, y: -cap + 30 * scale };
  return { x, y: 0 };
};

/** Where a pupil sits inside its eye: toward the target, never beyond `max`, easing off when close. */
export const lookAt = (ex, ey, tx, ty, max, reach) => {
  const dx = tx - ex, dy = ty - ey, d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d < 1e-6 || max <= 0) return { x: 0, y: 0 };
  const k = (max * Math.min(1, d / Math.max(1e-6, reach))) / d;
  return { x: dx * k, y: dy * k };
};

/** One step of a doodle's drift: falls, sways, is pushed by the pointer, wraps round the box; a popped one waits then re-enters. */
export const stepFloater = (f, dt, t, w, h, px, py, radius, rand) => {
  const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05), m = 40;
  if (f.pop > 0) {
    f.pop -= step;
    if (f.pop <= 0) { f.pop = 0; f.x = rand() * w; f.y = -m; f.vx = 0; f.vy = f.fall; }
    return f;
  }
  const sway = Math.sin(t * 0.7 + f.phase) * 14;
  if (Number.isFinite(px) && Number.isFinite(py) && radius > 0) {
    const dx = f.x - px, dy = f.y - py, d = Math.hypot(dx, dy);
    if (d < radius && d > 0.01) {
      const k = (1 - d / radius) * (1 - d / radius) * 2400;
      f.vx += (dx / d) * k * step; f.vy += (dy / d) * k * step; f.vr += (dx > 0 ? 1 : -1) * k * 0.004 * step;
    }
  }
  const ease = Math.min(1, step * 2.4);
  f.vx += (sway - f.vx) * ease;
  f.vy += (f.fall - f.vy) * ease;
  f.vr += (Math.sin(f.phase * 3) * 18 - f.vr) * Math.min(1, step * 0.8);
  f.x += f.vx * step; f.y += f.vy * step; f.rot = (f.rot + f.vr * step) % 360;
  if (f.y > h + m) { f.y = -m; f.x = rand() * w; } else if (f.y < -m * 3) { f.y = h + m; }
  if (f.x < -m) f.x = w + m; else if (f.x > w + m) f.x = -m;
  return f;
};

/** Storyboard timings in ms: ground line, letters stamp, crew arrives, doodles, tagline words, buttons. */
export const timeline = (letters, crew, words, actions) => {
  const n = (v) => Math.max(0, Math.floor(v) || 0);
  const L = n(letters), C = n(crew), W = n(words), A = n(actions);
  const letter = (i) => 160 + i * 80;
  const crewStart = letter(Math.max(0, L - 1)) + 420;
  const member = (j) => crewStart + j * 130;
  const doodles = crewStart + Math.max(0, C - 1) * 130 * 0.5;
  const copy = crewStart + 260;
  const word = (k) => copy + k * 45;
  const actionsStart = word(W) + 120;
  const action = (k) => actionsStart + k * 110;
  const total = Math.max(member(Math.max(0, C - 1)) + 720, action(Math.max(0, A - 1)) + 600, letter(Math.max(0, L - 1)) + 560);
  return { ground: 60, letter, crewStart, member, doodles, word, action, total };
};

// ---------- measuring the wordmark ----------
const FONT_SIZE = 200;
const FONT = '"Anton", "Bebas Neue", Impact, "Arial Narrow Bold", sans-serif';
const estimate = (word) => ({
  advances: Array.from(word).map((c) => (c === " " ? 0.3 : /[IJ1]/.test(c) ? 0.42 : /[MW]/.test(c) ? 0.98 : 0.76) * FONT_SIZE),
  cap: 0.73 * FONT_SIZE,
});
const measure = (word, family) => {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.font = "400 " + FONT_SIZE + "px " + family;
    const chars = Array.from(word), advances = [];
    let prev = 0;
    for (let i = 0; i < chars.length; i++) {
      const now = ctx.measureText(chars.slice(0, i + 1).join("")).width;
      advances.push(now - prev); prev = now;
    }
    const m = ctx.measureText(word.replace(/\s/g, "") || "H");
    return { advances, cap: m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : 0.73 * FONT_SIZE };
  } catch { return null; }
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let UID = 0;

export const DEFAULT_CREW = [
  { kind: "yeti", letter: 0, seat: "front", offset: -0.3, name: "Bruno" },
  { kind: "kid", letter: 0, seat: "top", offset: 0.12, name: "Juno" },
  { kind: "bird", letter: 1, seat: "top", offset: 0.02, name: "Pip" },
  { kind: "mushroom", letter: 1, seat: "front", offset: 0.18, scale: 0.95, name: "Morel" },
  { kind: "ghost", letter: 2, seat: "behind", offset: -0.1, name: "Boo" },
  { kind: "cat", letter: 2, seat: "front", offset: 0.42, flip: true, name: "Patch" },
];
export const DEFAULT_DOODLES = ["heart", "star", "sparkle", "flame", "bolt", "heart", "star", "plane"];

/**
 * Mounts the hero into `root`.
 * opts: { word, tagline, actions:[{id,label,icon,variant}], crew, doodles, doodleCount, onAction(id), compact, interactive }
 * crew[i].says is the line it speaks when poked. Returns { destroy() }.
 */
export function mountHero(root, opts = {}) {
  const uid = "h" + ++UID;
  const word = (opts.word || "HER").toUpperCase();
  const chars = Array.from(word);
  const crewIn = opts.crew || DEFAULT_CREW;
  const interactive = opts.interactive !== false;
  const tagline = opts.tagline || "";
  const actions = opts.actions || [];
  const doodleKinds = opts.doodles || DEFAULT_DOODLES;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let metrics = measure(word, FONT) || estimate(word);
  const layout = layoutWord(metrics.advances, -0.02, FONT_SIZE);
  const cap = metrics.cap;

  const placed = crewIn.map((m, i) => {
    const art = ART[m.kind];
    if (!art || !chars.length) return null;
    const li = clamp(Math.floor(m.letter) || 0, 0, chars.length - 1);
    const scale = (cap / 144) * art.k * (m.scale ?? 1);
    const seat = m.seat || art.seat;
    return { i, m, art, seat, scale, ...seatPoint(seat, layout.x[li], layout.w[li], cap, m.offset ?? 0, scale), flip: m.flip ? -1 : 1 };
  }).filter(Boolean);

  // viewBox hugs the word, the crew and the ground
  let l = 0, r = layout.width, t = -cap, b = 30;
  for (const p of placed) {
    const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l];
    l = Math.min(l, p.x + bx[0] * p.scale); r = Math.max(r, p.x + bx[1] * p.scale);
    t = Math.min(t, p.y + p.art.box.t * p.scale); b = Math.max(b, p.y + p.art.box.b * p.scale);
  }
  const view = { x: l - 24, y: t - 24, w: r - l + 48, h: b - t + 48 };

  const words = tagline.split(/\s+/).filter(Boolean);
  const tl = timeline(chars.length, placed.length, words.length, actions.length);

  // ground line, grass tufts, pebbles
  const x0 = view.x + 6, x1 = view.x + view.w - 6;
  let gd = "M" + x0.toFixed(1) + " 6";
  for (let k = 1; k <= 14; k++) {
    const x = x0 + ((x1 - x0) * k) / 14;
    gd += " Q" + (x - (x1 - x0) / 28).toFixed(1) + " " + (6 + (hash(k * 3.1) - 0.5) * 5).toFixed(1) + " " + x.toFixed(1) + " " + (6 + (hash(k * 7.7) - 0.5) * 2).toFixed(1);
  }
  let tufts = "";
  for (let k = 0; k < 22; k++) {
    const x = x0 + 20 + hash(k * 11.3) * (x1 - x0 - 40), s = 0.7 + hash(k * 5.9) * 0.6;
    tufts += `M${x.toFixed(1)} 6 l${(2 * s).toFixed(1)} ${(-9 * s).toFixed(1)} M${(x + 3 * s).toFixed(1)} 6 l${s.toFixed(1)} ${(-12 * s).toFixed(1)} M${(x + 6 * s).toFixed(1)} 6 l${(-s).toFixed(1)} ${(-7 * s).toFixed(1)} `;
  }
  const pebbles = Array.from({ length: 9 }, (_, k) => ({ x: x0 + 40 + hash(k * 17.1) * (x1 - x0 - 80), y: 14 + hash(k * 2.3) * 8, r: 2 + hash(k * 9.4) * 2.6 }));

  const nDoodles = doodleKinds.length ? clamp(Math.floor(opts.doodleCount ?? 10), 0, 40) : 0;
  const doodleList = Array.from({ length: nDoodles }, (_, k) => ({ kind: doodleKinds[k % doodleKinds.length], size: 22 + hash(k * 4.7) * 14 }));

  const hatch = `url(#${uid}-hatch)`;
  const pct = (v, base, span) => (((v - base) / span) * 100).toFixed(3) + "%";

  const crewMarkup = (p, part) => {
    const eyes = p.art.eyes.map((eye, e) =>
      `<g data-blink="${p.i}:${e}">${eye.r > 0 ? `<circle cx="${eye.x}" cy="${eye.y}" r="${eye.r}"/>` : ""}<g data-pupil="${p.i}:${e}"><circle class="k" cx="${eye.x}" cy="${eye.y}" r="${eye.pupil}"/><circle class="dcf-glint" cx="${eye.x + eye.pupil * 0.35}" cy="${eye.y - eye.pupil * 0.4}" r="${eye.pupil * 0.32}"/></g></g>`).join("");
    return `<g transform="translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${(p.scale * p.flip).toFixed(4)} ${p.scale.toFixed(4)})"><g class="dcf-arrive dcf-arrive-${p.seat}" style="--d:${tl.member(p.i)}ms"><g class="dcf-hopper" data-hop="${p.i}"><g class="dcf-art${p.art.idle ? " " + p.art.idle : ""}">${part === "body" ? p.art.body(hatch) + eyes : (p.art.front ? p.art.front() : "")}</g></g></g></g>`;
  };

  const letterMarkup = chars.map((c, i) => c === " " ? "" :
    `<g class="dcf-letter" style="--d:${tl.letter(i)}ms;--r:${((hash(i * 2.3) - 0.5) * 9).toFixed(2)}deg"><g class="dcf-glyph"><text x="${layout.x[i]}" y="0" font-size="${FONT_SIZE}" font-weight="400" style="font-family:${FONT}" filter="url(#${uid}-ink)">${esc(c)}</text></g><path class="dcf-dust" d="M${layout.x[i] - 6} -6 l-16 -6 M${layout.x[i] - 4} -16 l-12 -12 M${layout.x[i] + layout.w[i] + 6} -6 l16 -6 M${layout.x[i] + layout.w[i] + 4} -16 l12 -12"/></g>`).join("");

  const hits = interactive ? placed.map((p) => {
    const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l];
    const top = p.art.box.t, bottom = p.seat === "behind" ? -30 : p.art.box.b;
    return `<rect class="dcf-hit" data-poke="${p.i}" x="${p.x + bx[0] * p.scale}" y="${p.y + top * p.scale}" width="${(bx[1] - bx[0]) * p.scale}" height="${(bottom - top) * p.scale}" rx="12" role="button" tabindex="0" aria-label="${esc((p.m.name || p.m.kind) + (p.m.says ? ": " + p.m.says : ""))}"/>`;
  }).join("") : "";

  const svg = `<svg class="dcf-svg" viewBox="${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}" role="group" aria-label="${esc(word)}">
    <defs>
      <pattern id="${uid}-hatch" width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" y1="0" x2="0" y2="4.6" style="stroke:var(--dcf-ink)" stroke-width="1.25"/></pattern>
      ${[0, 1, 2].map((k) => `<filter id="${uid}-boil${k}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${k * 7 + 3}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>`).join("")}
      <filter id="${uid}-ink" x="-4%" y="-6%" width="108%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="edge"/><feDisplacementMap in="SourceGraphic" in2="edge" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.018 0.32" numOctaves="2" seed="4" result="streak"/><feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 5.6" result="streakA"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="9" result="speck"/><feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -24 7.0" result="speckA"/>
        <feComposite in="streakA" in2="speckA" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="holes"/><feComposite in="rough" in2="holes" operator="out"/>
      </filter>
    </defs>
    <g data-layer="0"><g class="dcf-ground"><path class="dcf-draw" pathLength="1" d="${gd}" style="--d:${tl.ground}ms"/><path class="dcf-tufts dcf-fade" d="${tufts}" style="--d:${tl.ground + 500}ms"/>${pebbles.map((pb) => `<ellipse class="dcf-pebble dcf-fade" cx="${pb.x}" cy="${pb.y}" rx="${pb.r * 1.5}" ry="${pb.r}" style="--d:${tl.ground + 600}ms"/>`).join("")}</g>${placed.filter((p) => p.seat === "behind").map((p) => crewMarkup(p, "body")).join("")}</g>
    ${letterMarkup}
    <g data-layer="1">${placed.filter((p) => p.seat === "behind").map((p) => crewMarkup(p, "front")).join("")}${placed.filter((p) => p.seat !== "behind").map((p) => crewMarkup(p, "body")).join("")}</g>
    ${hits}
  </svg>`;

  const actionsHtml = actions.map((a, k) =>
    `<button type="button" class="dcf-btn dcf-pop ${a.variant === "outline" ? "is-outline" : "is-solid"}" data-action="${esc(a.id)}" style="--d:${tl.action(k)}ms">${a.icon ? `<svg class="dcf-icon" viewBox="-16 -16 32 32" width="18" height="18" aria-hidden="true">${doodle(a.icon)}</svg>` : ""}<span>${esc(a.label)}</span></button>`).join("");

  root.innerHTML = `<section class="dcf${opts.compact ? " dcf-compact" : ""}" data-play="0" data-interactive="${interactive ? 1 : 0}">
    <div class="dcf-world"><div class="dcf-stage"><h2 class="dcf-sr">${esc(word)}</h2>${svg}<div class="dcf-bubbles" aria-live="polite"></div></div>
    <div class="dcf-doodles" aria-hidden="true">${doodleList.map((d, k) => `<div class="dcf-doodle" data-doodle="${k}" style="width:${d.size}px;height:${d.size}px;margin-left:${-d.size / 2}px;margin-top:${-d.size / 2}px"><span class="dcf-doodle-in" style="--d:${tl.doodles + k * 70}ms"><svg viewBox="-16 -16 32 32" width="${d.size}" height="${d.size}">${doodle(d.kind)}</svg></span></div>`).join("")}</div>
    ${tagline || actions.length ? `<div class="dcf-cta">${tagline ? `<p class="dcf-tagline">${words.map((w, k) => `<span class="dcf-word" style="--d:${tl.word(k)}ms">${esc(w)} </span>`).join("")}</p>` : ""}${actions.length ? `<div class="dcf-actions">${actionsHtml}</div>` : ""}</div>` : ""}
    </div></section>`;

  // ---------- life ----------
  const el = root.querySelector(".dcf"), world = root.querySelector(".dcf-world"), svgEl = root.querySelector(".dcf-svg");
  const bubbles = root.querySelector(".dcf-bubbles");
  const doodleEls = [...root.querySelectorAll(".dcf-doodle")];
  const layers = [...root.querySelectorAll("[data-layer]")];
  const sim = { floaters: [], w: 0, h: 0, px: NaN, py: NaN, inside: false, visible: true, gaze: [], seed: 1, start: 0 };
  let raf = 0, alive = true, talkTimer = 0, boilAt = 0, boil = 0;
  const rand = () => { sim.seed = (sim.seed * 16807) % 2147483647; return sim.seed / 2147483647; };

  const paintDoodles = () => {
    const k = clamp(sim.w / 1100, 0.5, 1);
    sim.floaters.forEach((f, i) => {
      const d = doodleEls[i]; if (!d) return;
      let sc = k, op = 1;
      if (f.pop > 0) { const age = 1.4 - f.pop; sc = k * (1 + Math.min(1, age / 0.3) * 0.7); op = Math.max(0, 1 - age / 0.3); }
      d.style.transform = `translate3d(${f.x.toFixed(1)}px,${f.y.toFixed(1)}px,0) rotate(${f.rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
      d.style.opacity = String(op);
    });
  };
  const sizeWorld = () => {
    const rc = world.getBoundingClientRect(), ow = sim.w, oh = sim.h;
    sim.w = rc.width; sim.h = rc.height;
    if (sim.floaters.length !== doodleList.length || !ow) {
      sim.floaters = doodleList.map((_, k) => ({ x: (0.04 + 0.92 * ((k + hash(k * 9.1) * 0.8) / Math.max(1, doodleList.length))) * rc.width, y: (0.02 + hash(k * 3.3) * 0.56) * rc.height, vx: 0, vy: 0, rot: (hash(k * 1.7) - 0.5) * 50, vr: (hash(k * 6.1) - 0.5) * 30, fall: 9 + hash(k * 2.9) * 16, phase: hash(k * 8.3) * Math.PI * 2, pop: 0 }));
    } else if (ow && oh) { for (const f of sim.floaters) { f.x *= rc.width / ow; f.y *= rc.height / oh; } }
    paintDoodles();
  };
  sizeWorld();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(sizeWorld) : null;
  ro?.observe(world);

  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { for (const e of es) sim.visible = e.isIntersecting; }, { threshold: [0, 0.1] }) : null;
  io?.observe(el);

  const startPlay = () => { if (!alive) return; el.dataset.play = "1"; sim.start = performance.now(); };
  const startTimer = setTimeout(startPlay, 30);

  const svgPoint = (cx, cy) => { const m = svgEl.getScreenCTM(); if (!m) return null; const inv = m.inverse(); return { x: inv.a * cx + inv.c * cy + inv.e, y: inv.b * cx + inv.d * cy + inv.f }; };
  const q = (sel) => root.querySelector(sel);

  let last = performance.now();
  const frame = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!sim.visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const tt = now / 1000;
    const target = sim.inside && interactive ? svgPoint(sim.px, sim.py) : null;
    placed.forEach((p, c) => {
      const g = (sim.gaze[c] ||= { tx: 0, ty: 0, next: 0, blinkAt: tt + 1 + hash(c * 3.7) * 3, blink: 0, o: [] });
      if (!target && tt > g.next) {
        const other = placed[(c + 1 + Math.floor(rand() * Math.max(1, placed.length - 1))) % placed.length];
        if (other && rand() < 0.45) { g.tx = other.x; g.ty = other.y - 60 * other.scale; }
        else { g.tx = p.x + (rand() - 0.5) * 900; g.ty = p.y - 80 * p.scale + (rand() - 0.5) * 500; }
        g.next = tt + 1.4 + rand() * 2.6;
      }
      if (tt > g.blinkAt) { g.blink = 0.16; g.blinkAt = tt + 2.2 + rand() * 4; }
      g.blink = Math.max(0, g.blink - dt);
      const lid = g.blink > 0 ? 0.12 + (Math.abs(g.blink - 0.08) / 0.08) * 0.88 : 1;
      p.art.eyes.forEach((eye, e) => {
        const o = lookAt(p.x + eye.x * p.scale * p.flip, p.y + eye.y * p.scale, target ? target.x : g.tx, target ? target.y : g.ty, eye.max, 220);
        const prev = g.o[e] || { x: 0, y: 0 }, ease = Math.min(1, dt * (target ? 14 : 6));
        const nx = prev.x + (o.x * p.flip - prev.x) * ease, ny = prev.y + (o.y - prev.y) * ease;
        g.o[e] = { x: nx, y: ny };
        const pu = q(`[data-pupil="${p.i}:${e}"]`), bl = q(`[data-blink="${p.i}:${e}"]`);
        pu?.setAttribute("transform", `translate(${nx.toFixed(2)} ${ny.toFixed(2)})`);
        bl?.setAttribute("transform", `translate(0 ${(eye.y * (1 - lid)).toFixed(2)}) scale(1 ${lid.toFixed(3)})`);
      });
    });
    if (sim.floaters.length && (sim.start && now - sim.start > tl.doodles || reduced)) {
      const rc = world.getBoundingClientRect();
      const px = sim.inside && interactive ? sim.px - rc.left : NaN, py = sim.inside && interactive ? sim.py - rc.top : NaN;
      if (!reduced) for (const f of sim.floaters) stepFloater(f, dt, tt, sim.w, sim.h, px, py, 110, rand);
      paintDoodles();
    }
    if (!reduced && now - boilAt > 125) {
      boilAt = now; boil = (boil + 1) % 3;
      for (const L of layers) L.setAttribute("filter", `url(#${uid}-boil${boil})`);
    }
  };
  raf = requestAnimationFrame(frame);

  // ---------- interaction ----------
  const onMove = (e) => { sim.px = e.clientX; sim.py = e.clientY; sim.inside = true; };
  const onLeave = () => { sim.inside = false; };
  el.addEventListener("pointermove", onMove); el.addEventListener("pointerdown", onMove); el.addEventListener("pointerleave", onLeave);

  const poke = (i) => {
    if (!interactive) return;
    const p = placed.find((x) => x.i === i); if (!p) return;
    bubbles.innerHTML = p.m.says ? `<div class="dcf-bubble${p.x > view.x + view.w * 0.72 ? " is-left" : ""}" style="left:${pct(p.x, view.x, view.w)};top:${pct(p.y + p.art.box.t * p.scale - 6, view.y, view.h)}">${esc(p.m.says)}</div>` : "";
    const hop = q(`[data-hop="${i}"]`);
    if (hop) { hop.classList.remove("is-hop"); void hop.getBoundingClientRect(); hop.classList.add("is-hop"); }
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => { bubbles.innerHTML = ""; hop?.classList.remove("is-hop"); }, 2600);
  };
  const onClick = (e) => {
    const hit = e.target.closest?.("[data-poke]"); if (hit) return poke(Number(hit.dataset.poke));
    const d = e.target.closest?.("[data-doodle]");
    if (d && interactive) { const f = sim.floaters[Number(d.dataset.doodle)]; if (f && f.pop <= 0) { f.pop = 1.4; paintDoodles(); } return; }
    const a = e.target.closest?.("[data-action]"); if (a && opts.onAction) opts.onAction(a.dataset.action);
  };
  const onKey = (e) => { const hit = e.target.closest?.("[data-poke]"); if (hit && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); poke(Number(hit.dataset.poke)); } };
  el.addEventListener("click", onClick); el.addEventListener("keydown", onKey);
  // doodles sit above the stage; let a press pop them
  el.addEventListener("pointerdown", (e) => { const d = e.target.closest?.("[data-doodle]"); if (d && interactive) { const f = sim.floaters[Number(d.dataset.doodle)]; if (f && f.pop <= 0) { f.pop = 1.4; paintDoodles(); } } });

  return {
    destroy() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(startTimer); clearTimeout(talkTimer);
      ro?.disconnect(); io?.disconnect();
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerdown", onMove); el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick); el.removeEventListener("keydown", onKey);
      root.innerHTML = "";
    },
  };
}

export { ACCENT };
