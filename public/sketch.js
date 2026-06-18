/* sketch.ts — the "drawn by hand" engine.
 *
 * Everything you see on the board is ink: geometry is generated true, then
 * roughened (points nudged off the ideal path and smoothed) so it reads as a
 * pen stroke. Strokes draw themselves on with a little ink nib leading the way,
 * and a slow turbulence "boil" keeps the lines quietly alive.
 *
 * No dependencies. Pure SVG + a touch of math.
 */
const SVGNS = "http://www.w3.org/2000/svg";
export const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* deterministic PRNG so a given shape always wobbles the same way */
function rng(seed) {
    let a = (seed * 1973 + 9277) | 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/* Catmull-Rom -> cubic bezier: turns a point list into one smooth stroke */
export function smooth(points, close = false) {
    const p = points;
    if (p.length < 2)
        return "";
    const pt = (i) => p[close ? (i + p.length) % p.length : Math.max(0, Math.min(p.length - 1, i))];
    let d = `M ${pt(0)[0].toFixed(2)} ${pt(0)[1].toFixed(2)}`;
    const last = close ? p.length : p.length - 1;
    for (let i = 0; i < last; i++) {
        const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d;
}
/* a hand-drawn ring: sampled around the circle, radius jittered, left a hair
 * open and overshooting — the way nobody ever closes a circle cleanly */
export function circlePath(cx, cy, r, seed = 1, roughness = 1) {
    const rand = rng(seed);
    const steps = Math.max(14, Math.round(r * 0.55));
    const start = rand() * 0.6;
    const end = Math.PI * 2 + 0.35 + rand() * 0.25; // overshoot past the start
    const jitter = (r * 0.05 + 1.1) * roughness;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const a = start + (end - start) * (i / steps);
        const rr = r + (rand() * 2 - 1) * jitter;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return smooth(pts, false);
}
/* a hand-drawn rounded square (commit) */
export function squarePath(cx, cy, size, seed = 1, roughness = 1) {
    const rand = rng(seed);
    const h = size / 2;
    const corners = [
        [cx - h, cy - h], [cx + h, cy - h],
        [cx + h, cy + h], [cx - h, cy + h],
    ];
    const jitter = 1.4 * roughness;
    const pts = [];
    corners.forEach((c, i) => {
        const next = corners[(i + 1) % 4];
        const segs = 4;
        for (let s = 0; s < segs; s++) {
            const t = s / segs;
            pts.push([
                c[0] + (next[0] - c[0]) * t + (rand() * 2 - 1) * jitter,
                c[1] + (next[1] - c[1]) * t + (rand() * 2 - 1) * jitter,
            ]);
        }
    });
    pts.push(pts[0]);
    return smooth(pts, true);
}
/* a hand-drawn rounded rectangle of arbitrary size (label boxes) */
export function rectPath(cx, cy, w, h, seed = 1, roughness = 1) {
    const rand = rng(seed);
    const hw = w / 2, hh = h / 2;
    const corners = [
        [cx - hw, cy - hh], [cx + hw, cy - hh],
        [cx + hw, cy + hh], [cx - hw, cy + hh],
    ];
    const jitter = 1.1 * roughness;
    const pts = [];
    corners.forEach((c, i) => {
        const next = corners[(i + 1) % 4];
        const segs = 5;
        for (let s = 0; s < segs; s++) {
            const t = s / segs;
            pts.push([
                c[0] + (next[0] - c[0]) * t + (rand() * 2 - 1) * jitter,
                c[1] + (next[1] - c[1]) * t + (rand() * 2 - 1) * jitter,
            ]);
        }
    });
    pts.push(pts[0]);
    return smooth(pts, true);
}
/* a hand-drawn line/curve between two points, bowed slightly off-true */
export function linePath(x1, y1, x2, y2, seed = 1, roughness = 1) {
    const rand = rng(seed);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // perpendicular
    const segs = Math.max(3, Math.round(len / 36));
    const amp = Math.min(len * 0.04, 6) * roughness;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        // bow toward the middle, no wander at the endpoints
        const env = Math.sin(t * Math.PI);
        const off = (rand() * 2 - 1) * amp * env + Math.sin(t * Math.PI) * amp * 0.4;
        pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    return smooth(pts, false);
}
export function el(name, attrs = {}) {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs)
        node.setAttribute(k, String(attrs[k]));
    return node;
}
/* draw a path element on, like a pen laying down ink, with a leading nib */
export function drawOn(pathEl, opts = {}) {
    const { duration = 650, nibGroup = null, color = "#2a2521" } = opts;
    return new Promise((resolve) => {
        const len = pathEl.getTotalLength();
        if (prefersReduced) {
            pathEl.style.strokeDasharray = "none";
            resolve();
            return;
        }
        pathEl.style.strokeDasharray = `${len}`;
        pathEl.style.strokeDashoffset = `${len}`;
        let nib = null;
        if (nibGroup) {
            nib = el("circle", { r: 3.4, fill: color, class: "nib" });
            nibGroup.appendChild(nib);
        }
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
            pathEl.style.strokeDashoffset = `${len * (1 - e)}`;
            if (nib) {
                const pt = pathEl.getPointAtLength(len * e);
                nib.setAttribute("cx", String(pt.x));
                nib.setAttribute("cy", String(pt.y));
            }
            if (t < 1) {
                requestAnimationFrame(tick);
            }
            else {
                pathEl.style.strokeDasharray = "none";
                if (nib) {
                    const fading = nib;
                    fading.style.transition = "opacity .25s ease";
                    fading.style.opacity = "0";
                    setTimeout(() => fading.remove(), 280);
                }
                resolve();
            }
        };
        requestAnimationFrame(tick);
    });
}
/* a 3-frame "boil": cycle the turbulence seed so ink shimmers like it's alive.
 * Hand-drawn animation has always done this with 2-3 redrawn frames. */
export function startBoil(turbulence, opts = {}) {
    const { fps = 6, seeds = [1, 7, 13] } = opts;
    if (prefersReduced || !turbulence)
        return () => { };
    let i = 0;
    const id = window.setInterval(() => {
        i = (i + 1) % seeds.length;
        turbulence.setAttribute("seed", String(seeds[i]));
    }, 1000 / fps);
    return () => window.clearInterval(id);
}
//# sourceMappingURL=sketch.js.map