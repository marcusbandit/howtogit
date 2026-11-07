#!/usr/bin/env node
/* check-design.mjs: every font size, weight and family must come from design/tokens.json.
 *
 * Reads the CSS, the inline styles and <style> blocks in the HTML, and any font
 * styles set from TypeScript. Prints each value that is off the list with its
 * file:line and the step it should snap to, then exits 1. design/README.md has
 * the rules in words.
 *
 *   node scripts/check-design.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tokens = JSON.parse(fs.readFileSync(path.join(root, "design/tokens.json"), "utf8"));
const SIZES = tokens.fontSizes;
const FAMILIES = tokens.families;
const ALL_WEIGHTS = [...new Set(Object.values(FAMILIES).flatMap((f) => f.weights))].sort();
const problems = [];
const report = (file, line, msg) => problems.push({ file: path.relative(root, file), line, msg });

// nearest step on the scale; a tie goes to the larger step
const snap = (px) => SIZES.reduce((best, s) => (Math.abs(s - px) <= Math.abs(best - px) ? s : best), SIZES[0]);

function checkSize(value, file, line) {
  const v = value.trim();
  if (tokens.fontSizeKeywords.includes(v)) return;
  const px = v.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) {
    const n = Number(px[1]);
    if (!SIZES.includes(n)) report(file, line, `font-size ${v} is off the scale, use ${snap(n)}px`);
    return;
  }
  const clamp = v.match(/^clamp\(\s*([\d.]+)px\s*,[^,]+,\s*([\d.]+)px\s*\)$/);
  if (clamp) {
    const [lo, hi] = [Number(clamp[1]), Number(clamp[2])];
    if (!SIZES.includes(lo) || !SIZES.includes(hi)) report(file, line, snap(lo) === snap(hi)
      ? `font-size ${v}: both ends of a clamp must be on the scale; both snap to ${snap(lo)}px, so use ${snap(lo)}px`
      : `font-size ${v}: both ends of a clamp must be on the scale, try clamp(${snap(lo)}px, ..., ${snap(hi)}px)`);
    return;
  }
  report(file, line, `font-size ${v}: use a px step from the scale (${SIZES.join(", ")}), inherit, or a clamp between two steps`);
}

function checkWeight(value, file, line) {
  const v = value.trim();
  if (tokens.fontWeightKeywords.includes(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) { report(file, line, `font-weight ${v}: write it as a number (${ALL_WEIGHTS.join(", ")})`); return null; }
  if (!ALL_WEIGHTS.includes(n)) {
    const to = tokens.weightSnap?.[n] ?? ALL_WEIGHTS.reduce((b, w) => (Math.abs(w - n) < Math.abs(b - n) ? w : b), ALL_WEIGHTS[0]);
    report(file, line, `font-weight ${n} is not allowed, use ${to}`);
    return null;
  }
  return n;
}

function checkFamily(value, file, line) {
  const v = value.trim();
  if (tokens.fontFamilyKeywords.includes(v)) return null;
  const m = v.match(/^var\((--[\w-]+)\)$/);
  if (m && FAMILIES[m[1]]) return m[1];
  report(file, line, `font-family ${v}: use var(${Object.keys(FAMILIES).join("), var(")}) or inherit`);
  return null;
}

// font: [style] [weight] size[/line-height] family
function checkShorthand(value, file, line) {
  const v = value.trim();
  if (v === "inherit") return {};
  const m = v.match(/^(?:(?:italic|normal)\s+)?(?:(\S+)\s+)?(\S+?)(?:\/\S+)?\s+(.+)$/);
  if (!m) { report(file, line, `font: ${v} could not be read; give it a weight, a size and a family`); return {}; }
  const out = {};
  if (m[1]) out.weight = checkWeight(m[1], file, line);
  checkSize(m[2], file, line);
  out.family = checkFamily(m[3], file, line);
  return out;
}

// a weight the family does not ship gets faked by the browser, or falls back to another weight
function checkPair(family, weight, file, line) {
  if (!family) return;
  const f = FAMILIES[family];
  // a family with no 400 must say its weight, or it inherits 400 from the page
  if (weight == null) { if (!f.weights.includes(400)) report(file, line, `var(${family}) is set without a weight; ${f.name} needs ${f.weights.join(" or ")} written next to it`); return; }
  if (!f.weights.includes(weight)) report(file, line, `${f.name} (var(${family})) only comes in ${f.weights.join(", ")}, not ${weight}`);
}

function checkCss(text, file, lineOffset = 0) {
  // blank out comments but keep the newlines, so line numbers stay right
  const css = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const lineAt = (i) => lineOffset + css.slice(0, i).split("\n").length;
  const blockRe = /\{([^{}]*)\}/g;
  let b;
  while ((b = blockRe.exec(css))) {
    const body = b[1];
    const start = b.index + 1;
    let family = null, weight = null, famLine = 0;
    const declRe = /(^|[;\s])(font-size|font-weight|font-family|font)\s*:\s*([^;]+)/g;
    let d;
    while ((d = declRe.exec(body))) {
      const line = lineAt(start + d.index + d[1].length);
      const [prop, value] = [d[2], d[3].replace(/\s*!important\s*$/, "")];
      if (prop === "font-size") checkSize(value, file, line);
      else if (prop === "font-weight") weight = checkWeight(value, file, line) ?? weight;
      else if (prop === "font-family") { family = checkFamily(value, file, line) ?? family; famLine = line; }
      else { const s = checkShorthand(value, file, line); family = s.family ?? family; weight = s.weight ?? weight; famLine = line; }
    }
    checkPair(family, weight, file, famLine || lineAt(start));
  }
}

for (const f of tokens.files.css) checkCss(fs.readFileSync(path.join(root, f), "utf8"), path.join(root, f));

for (const f of tokens.files.html) {
  const file = path.join(root, f);
  const html = fs.readFileSync(file, "utf8");
  const lineAt = (i) => html.slice(0, i).split("\n").length;
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) checkCss(m[1], file, lineAt(m.index) - 1);
  for (const m of html.matchAll(/style="([^"]*)"/g)) checkCss(`{${m[1]}}`, file, lineAt(m.index) - 1);
  // the Google Fonts link must load exactly the weights the rules allow, no more
  for (const m of html.matchAll(/family=([^:&"]+):wght@([\d;]+)/g)) {
    const name = m[1].replace(/\+/g, " ");
    const fam = Object.values(FAMILIES).find((x) => x.name === name);
    if (!fam) { report(file, lineAt(m.index), `Google Fonts loads ${name}, which is not one of the three families`); continue; }
    const loaded = m[2].split(";").map(Number);
    if (loaded.join() !== fam.weights.join()) report(file, lineAt(m.index), `Google Fonts loads ${name} in ${loaded.join(", ")}; load exactly ${fam.weights.join(";")}`);
  }
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const d of tokens.files.ts) {
  for (const file of walk(path.join(root, d)).filter((p) => p.endsWith(".ts"))) {
    const src = fs.readFileSync(file, "utf8");
    const lineAt = (i) => src.slice(0, i).split("\n").length;
    // style strings and attributes: "font-size: 13px", fontSize = "13px", setAttribute("font-weight", "650")
    for (const m of src.matchAll(/(font-size|fontSize|font-weight|fontWeight|font-family|fontFamily)["']?\s*[:=,]\s*["'`]?([^;"'`,)}\n]+)/g)) {
      const prop = m[1].replace(/[A-Z]/, (c) => "-" + c.toLowerCase());
      if (/^\$\{|^[a-z_]\w*$/i.test(m[2].trim()) && prop !== "font-weight") continue; // a variable, not a literal
      const line = lineAt(m.index);
      if (prop === "font-size") checkSize(m[2], file, line);
      else if (prop === "font-weight") { if (/^\d+$/.test(m[2].trim())) checkWeight(m[2], file, line); }
      else checkFamily(m[2], file, line);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.log(`${p.file}:${p.line}  ${p.msg}`);
  console.log(`\n${problems.length} type value(s) break the rules in design/README.md. Scale: ${SIZES.join(", ")} px. Weights: ${ALL_WEIGHTS.join(", ")}.`);
  process.exit(1);
}
console.log(`ok    every font size, weight and family is on the scale (${SIZES.join(", ")} px; ${ALL_WEIGHTS.join(", ")})`);
