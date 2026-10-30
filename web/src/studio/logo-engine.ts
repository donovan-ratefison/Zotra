// The animated Zotra logo engine, ported from the brand guide. Only the
// branches of LOGO_CONFIG stay: solid A, stepped pen, upper descriptor,
// nodes. Do not change the geometry or the timings. The module top
// level touches no DOM API, so node can import it.

export type LogoConfig = {
  dur: number;
  lock: number;
  spin: [number, number, number];
  unroll: [number, number];
  penLeave: number;
  line: [number, number];
  aT: [number, number];
  dotR: number;
};

type Pt = [number, number];
type Ease = (x: number) => number;
type Attrs = Record<string, string | number>;

const NS = "http://www.w3.org/2000/svg";
const D2R = Math.PI / 180;
const ANG = Math.atan2(38, 50) / D2R; // Z diagonal, clockwise from north

// Helpers
const set = (e: Element, attrs: Attrs) => { for (const k in attrs) e.setAttribute(k, String(attrs[k])); };
function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag); set(e, attrs); parent.appendChild(e); return e;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const lin: Ease = (x) => x, out: Ease = (x) => 1 - (1 - x) ** 3;
const inOut: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const back: Ease = (x) => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const snap: Ease = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2; // small overshoot
const seg = (t: number, a: number, b: number, f: Ease = lin) => f(clamp((t - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpPts = (A: Pt[], B: Pt[], k: number): Pt[] => A.map((p, i) => [lerp(p[0], B[i][0], k), lerp(p[1], B[i][1], k)]);
const P = (pts: Pt[]) => pts.map((p) => p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" ");
const circlePath = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}`;
const rot = (pts: Pt[], cx: number, cy: number, deg: number): Pt[] => {
  const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const halves = (L: number, w: number): { n: Pt[]; s: Pt[] } =>
  ({ n: [[0, -L], [w, 0], [0, 0], [-w, 0]], s: [[0, L], [w, 0], [0, 0], [-w, 0]] });
function spin(t: number, end: number, T: number, final: number): number {
  if (t <= 0) return 0;
  const w = final / (end - 2 * T / 3), t1 = end - T;
  if (t <= t1) return w * t;
  if (t >= end) return final;
  return w * t1 + (w * T / 3) * (1 - (1 - (t - t1) / T) ** 3);
}
const wob = (t: number, at: number, amp = 6) => t < at ? 0 : amp * Math.sin((t - at) / 35) * Math.exp(-(t - at) / 110);

// Geometry (viewBox 0 0 552 160, cap line 23, baseline 137, stroke 14)
const ZX = 62, OX = 172, OR = 50.75, OY = 80.75, T_X = 279, A_X = 484, OPEN = 55;
const NEEDLE_L = 43 / Math.cos(ANG * D2R);
const LEG = "A25 25 0 0 1 378 80L426.6 146";
const LEG_EXTRA = Math.hypot(6.6, 9);
const LINE_T = "M171 30H378" + LEG;
const LEG_DEG = Math.atan2(57, 42) / D2R + 90;
const STOP_T = 286 - 171, STOP_R = 349 - 171; // distances on the line to the T and R stem centers
const A_PATH = "M0 -57L42 57L-42 57Z"; // the solid A, relative to the A center
let clipCount = 0;

// Builds the logo in svg. The returned function draws the frame at
// time t (ms, engine time) and returns the needle angle.
export function buildLogo(svg: SVGSVGElement, c: LogoConfig): (t: number) => number {
  svg.replaceChildren(); // StrictMode runs the effect two times in development.
  const id = ++clipCount;
  set(svg, { viewBox: "0 0 552 196" });
  el(el(svg, "clipPath", { id: "zlogo-base" + id }), "rect", { x: 0, y: -40, width: 552, height: 177 });
  el(el(svg, "filter", { id: "zlogo-halo" + id, x: "-50%", y: "-50%", width: "200%", height: "200%" }), "feGaussianBlur", { stdDeviation: 7 });
  const word = el(svg, "g");
  const ring = el(word, "path", { class: "stroke" });
  const notch = el(word, "rect", { class: "hole", width: 5, height: 18 });
  const dot = el(word, "circle", { class: "ink" });
  const trN = el(word, "polyline", { class: "trail" }), trS = el(word, "polyline", { class: "trail" });
  const tStem = el(word, "rect", { class: "ink", x: T_X, width: 14 });
  const rStem = el(word, "rect", { class: "ink", x: 342, width: 14 });
  const line = el(word, "path", { class: "stroke", d: LINE_T, "stroke-width": 14, "stroke-linejoin": "miter",
    "stroke-miterlimit": 4, "clip-path": `url(#zlogo-base${id})` });
  const nodes = [286, 349].map((x) => el(word, "circle", { class: "hole", cx: x, cy: 30, r: 0 }));
  const LEN = line.getTotalLength(), FOOT = LEN - LEG_EXTRA;
  const aGlow = el(word, "path", { class: "glow", d: A_PATH, "fill-rule": "evenodd", opacity: 0, filter: `url(#zlogo-halo${id})` });
  const A = el(word, "path", { class: "red", d: A_PATH, "fill-rule": "evenodd" });
  const ghosts = [0.28, 0.16, 0.08].map((o) => ({ o, s: el(word, "polygon", { class: "silver" }), n: el(word, "polygon", { class: "red" }) }));
  const nGlow = el(word, "polygon", { class: "glow", opacity: 0, filter: `url(#zlogo-halo${id})` });
  const nS = el(word, "polygon", { class: "silver" }), nN = el(word, "polygon", { class: "red" });
  const piv = el(word, "circle", { class: "hole", r: 3.5, cx: ZX, cy: 80 });
  const desc = el(svg, "text", { class: "desc", x: 20, y: 186, textLength: 506, lengthAdjust: "spacing" });
  desc.textContent = "WORKFLOW STUDIO FOR BANKS";
  const H = halves(NEEDLE_L, 10), R = NEEDLE_L, n = 28;
  const arc = (from: number, to: number) => Array.from({ length: n }, (_, i): Pt => {
    const f = lerp(from, to, i / (n - 1)) * D2R;
    return [ZX + R * Math.sin(f), 80 - R * Math.cos(f)];
  });
  const flat = (x0: number, x1: number, y: number) => Array.from({ length: n }, (_, i): Pt => [lerp(x0, x1, i / (n - 1)), y]);
  const LN = flat(ZX - 40, ZX + 40, 30), LS = flat(ZX + 40, ZX - 40, 130);
  const at = (d: number) => line.getPointAtLength(Math.max(0, Math.min(FOOT, d)));
  const heading = (d: number) => { const p = at(d + 1), q = at(d - 1); return Math.atan2(p.y - q.y, p.x - q.x) / D2R + 90; };
  const [sEnd, sT, sFinal] = c.spin;
  const L = c.line[0];
  // Stepped pen: [time, distance, easing of the move that ends here]
  const KEYS: [number, number, Ease?][] = [[L, 0], [L + 400, STOP_T, (x) => x * (2 - x)], [L + 580, STOP_T],
    [L + 880, STOP_R, inOut], [L + 1060, STOP_R], [L + 1660, LEN, inOut]];
  const stepped = (t: number) => {
    if (t <= L) return 0;
    for (let i = 1; i < KEYS.length; i++) {
      const [ta, da] = KEYS[i - 1], [tb, db, f] = KEYS[i];
      if (t <= tb) return lerp(da, db, (f || lin)(clamp((t - ta) / (tb - ta))));
    }
    return LEN;
  };
  const arriveT = L + 400, arriveR = L + 880;

  return (t) => {
    // Needle, speed blur and trails.
    const a = spin(t, sEnd, sT, sFinal), vis = seg(t, 0, 250), aw = a + wob(t, sEnd);
    const v = (a - spin(t - 16, sEnd, sT, sFinal)) / 16;
    set(nN, { points: P(rot(H.n, ZX, 80, aw)), opacity: vis });
    set(nS, { points: P(rot(H.s, ZX, 80, aw)), opacity: vis });
    set(piv, { opacity: vis });
    ghosts.forEach((g, i) => {
      const ga = a - (i + 1) * v * 22, go = g.o * clamp((v - 0.15) / 0.3) * vis;
      set(g.n, { points: P(rot(H.n, ZX, 80, ga)), opacity: go });
      set(g.s, { points: P(rot(H.s, ZX, 80, ga)), opacity: go });
    });
    const len = 100 * seg(t, 150, 700, out), ku = seg(t, c.unroll[0], c.unroll[1], inOut);
    const ts = { "stroke-width": lerp(3, 14, ku), opacity: len > 0 ? lerp(0.4, 1, ku) : 0 };
    set(trN, { points: P(lerpPts(arc(a - len, a), LN, ku)), ...ts });
    set(trS, { points: P(lerpPts(arc(a + 180 - len, a + 180), LS, ku)), ...ts });

    // The line.
    const drawn = stepped(t);
    set(line, { "stroke-dasharray": LEN, "stroke-dashoffset": LEN - drawn, opacity: drawn > 0 ? 1 : 0 });

    // O: traced, rolls, rocks when the pen lands, then opens.
    const rock = 3 * Math.sin(Math.PI * seg(t, L, L + 420)) * (1 - seg(t, L, L + 420));
    const cx = lerp(ZX, OX, seg(t, 1000, 2400, inOut)) + rock;
    const ks = seg(t, 650, 1000, inOut), p = clamp(a / 360);
    const r = lerp(R, OR, ks), cy = lerp(80, OY, ks), C = 2 * Math.PI * r, turn = (cx - OX) / OR / D2R;
    const g = C * OPEN / 360 * seg(t, L, L + 800, inOut);
    set(ring, { d: circlePath(cx, cy, r), "stroke-width": lerp(2, 14, ks), opacity: p > 0 ? 1 : 0,
      "stroke-dasharray": g ? `0 ${g.toFixed(2)} ${C}` : C, "stroke-dashoffset": g ? 0 : C * (1 - p) });
    set(notch, { x: cx - 2.5, y: cy - r - 9, transform: `rotate(${turn.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})`,
      opacity: ks * (1 - seg(t, L + 60, L + 160)) });
    set(dot, { cx, cy, r: Math.max(0, c.dotR * seg(t, 2200, 2500, back)) });

    // Stems: they snap up at each stop of the stepped pen.
    const kT = seg(t, arriveT - 80, arriveT + 220, snap), kR = seg(t, arriveR - 80, arriveR + 220, snap);
    const yT = lerp(137, 37, kT), yR = lerp(137, 46, kR);
    set(tStem, { y: yT, height: Math.max(0, 137 - yT) });
    set(rStem, { y: yR, height: Math.max(0, 137 - yR) });
    nodes.forEach((nd, i) => set(nd, { r: Math.max(0, 3.5 * seg(t, [arriveT, arriveR][i], [arriveT, arriveR][i] + 250, back)) }));

    // Lock: pulse, halos, then the descriptor.
    const kp = Math.sin(Math.PI * seg(t, c.lock, c.lock + 320)), sc = 1 + 0.02 * kp;
    set(word, { transform: `translate(276 80) scale(${sc.toFixed(4)}) translate(-276 -80)` });
    const glow = 0.9 * Math.sin(Math.PI * seg(t, c.lock + 40, c.lock + 460));
    set(nGlow, { points: P(rot(H.n, ZX, 80, aw)), opacity: glow.toFixed(3) });
    set(desc, { opacity: (0.72 * seg(t, c.lock + 200, c.lock + 700, inOut)).toFixed(3) });

    // The pen: flies from the needle, draws the line, becomes the A.
    let x: number, y: number, deg: number, s = 0.28;
    if (t < c.penLeave) { set(A, { opacity: 0 }); set(aGlow, { opacity: 0 }); return a; }
    if (t < L) {
      const kf = seg(t, c.penLeave, L, (k) => k * k);
      const aL = spin(c.penLeave, sEnd, sT, sFinal);
      const tip = rot([[0, -R]], ZX, 80, aL)[0], from = aL % 360, start = at(0), to = heading(1);
      x = lerp(tip[0], start.x, kf); y = lerp(tip[1], start.y, kf);
      deg = from + (((to - from) % 360 + 540) % 360 - 180) * kf;
    } else if (t < c.aT[0]) {
      const pt = at(drawn); x = pt.x; y = pt.y; deg = heading(Math.max(1, drawn));
    } else {
      const kL = seg(t, c.aT[0], c.aT[1], inOut), foot = at(FOOT);
      x = lerp(foot.x, A_X, kL); y = lerp(foot.y, 80, kL); deg = lerp(LEG_DEG, 360, kL); s = lerp(0.28, 1, kL);
    }
    const tf = `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${s.toFixed(3)})`;
    set(A, { transform: tf, opacity: 1 });
    set(aGlow, { transform: tf, opacity: glow.toFixed(3) });
    return a;
  };
}

// The brand guide config: solid A, stepped pen, upper descriptor, nodes.
// The pen leaves when the red tip points at the top of the O (50 degrees, third turn).
const LOCK = 4460;
const SPIN: [number, number, number] = [LOCK, 1000, 2160 + ANG];
export const LOGO_CONFIG: LogoConfig = {
  dur: LOCK + 750, lock: LOCK, spin: SPIN, unroll: [LOCK - 800, LOCK],
  penLeave: (50 + 1080) / (SPIN[2] / (SPIN[0] - 2 * SPIN[1] / 3)),
  line: [2300, LOCK - 500], aT: [LOCK - 500, LOCK], dotR: 4.5,
};
