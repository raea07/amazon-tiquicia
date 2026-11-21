// Draws the placeholder product pictures for the demo catalogue.
//
// These are original, deliberately simple geometric drawings: a flat shape on a
// soft colour field, so the store has consistent pictures without using
// anyone's photographs. Real listings carry the seller's own photos.
//
//   node apps/web/scripts/gen-demo-art.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/demo/products/", import.meta.url));

// Background / ink pairs, taken from the brand palette.
const TONES = {
  celeste: ["#d0f4f7", "#0c6775"],
  guaria: ["#f8e1f3", "#812266"],
  maiz: ["#fdf0c4", "#a05c0f"],
  selva: ["#d6f5e1", "#146842"],
  achiote: ["#fee4e2", "#b6231c"],
  anil: ["#e4e8f2", "#313d5e"],
  arena: ["#f5f2ec", "#6c3c14"],
};

const S = (d, extra = "") =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const F = (d) => `<path d="${d}" fill="currentColor"/>`;
const C = (cx, cy, r, fill = false) =>
  fill
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="18"/>`;
const R = (x, y, w, h, r = 24, fill = false) =>
  fill
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="currentColor"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="currentColor" stroke-width="18"/>`;

// Each drawing lives on an 800×800 canvas, roughly centred on (400, 400).
const ART = {
  "cafe-molido-tarrazu-340g": [
    "arena",
    R(270, 220, 260, 400, 28) +
      S("M270 300h260") +
      // A coffee bean: a tilted oval with its crease.
      `<ellipse cx="400" cy="440" rx="44" ry="62" transform="rotate(30 400 440)" fill="none" stroke="currentColor" stroke-width="16"/>` +
      `<path d="M427 394c-38 28 16 64-54 92" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>`,
  ],
  "cafe-grano-tarrazu-1kg": [
    "maiz",
    R(250, 190, 300, 440, 28) +
      S("M250 270h300") +
      C(350, 430, 34) +
      C(450, 430, 34) +
      C(400, 520, 34),
  ],
  "chorreador-madera-artesanal": [
    "arena",
    S("M280 220h240") +
      S("M300 220l100 220 100-220") +
      S("M400 440v60") +
      S("M260 620h280") +
      S("M300 620V250M500 620V250") +
      R(350, 520, 100, 90, 16),
  ],
  "carreta-decorativa-pintada-20cm": [
    "achiote",
    R(230, 280, 340, 150, 20) +
      C(400, 500, 110) +
      C(400, 500, 26, true) +
      S("M400 390v220M290 500h220M322 422l156 156M478 422 322 578") +
      S("M570 340h80"),
  ],
  "tabla-picar-teca": [
    "arena",
    R(230, 250, 340, 380, 40) + C(400, 320, 22) + S("M300 430h200M300 500h200"),
  ],
  "jabon-artesanal-avena-miel-3u": [
    "maiz",
    R(250, 430, 300, 150, 30) + R(290, 300, 220, 130, 30) + R(330, 190, 140, 110, 30),
  ],
  "audifonos-inalambricos-nimbo-aire": [
    "celeste",
    S("M250 440v-40a150 150 0 0 1 300 0v40") +
      R(210, 430, 90, 170, 40, true) +
      R(500, 430, 90, 170, 40, true),
  ],
  "parlante-bluetooth-nimbo-ola": [
    "anil",
    R(250, 200, 300, 420, 60) + C(400, 470, 80) + C(400, 300, 34, true),
  ],
  "cargador-usb-c-30w-nimbo": [
    "celeste",
    R(290, 300, 220, 260, 36) + S("M350 300v-90M450 300v-90") + R(360, 400, 80, 30, 12, true),
  ],
  "laptop-14-nimbo-libro": [
    "anil",
    R(230, 220, 340, 250, 20) + S("M180 540h440") + S("M210 540l20-70M590 540l-20-70"),
  ],
  "teclado-mecanico-compacto-nimbo": [
    "anil",
    R(170, 300, 460, 210, 28) +
      [0, 1, 2, 3, 4].map((i) => R(215 + i * 78, 340, 46, 46, 10, true)).join("") +
      R(250, 430, 300, 40, 12, true),
  ],
  "olla-arrocera-volcan-1-8l": [
    "selva",
    S("M250 380h300v150a70 70 0 0 1-70 70H320a70 70 0 0 1-70-70z") +
      S("M230 380h340") +
      S("M360 320a40 40 0 0 1 80 0") +
      S("M250 440h-50M550 440h50"),
  ],
  "licuadora-volcan-600w": [
    "selva",
    S("M310 200h180l-30 280H340z") +
      R(310, 480, 180, 130, 24) +
      C(400, 545, 22, true) +
      S("M490 260h50v120h-58"),
  ],
  "abanico-pie-volcan-18": [
    "celeste",
    C(400, 320, 150) +
      C(400, 320, 26, true) +
      S("M400 320v-120M400 320l104 60M400 320l-104 60") +
      S("M400 470v150M310 630h180"),
  ],
  "cafetera-electrica-volcan-12-tazas": [
    "arena",
    R(250, 190, 300, 120, 24) +
      S("M290 310v300h220V310") +
      S("M330 400h140v110a40 40 0 0 1-40 40h-60a40 40 0 0 1-40-40z") +
      S("M470 430h40v60h-40"),
  ],
  "taladro-inalambrico-roble-20v": [
    "maiz",
    R(210, 270, 280, 120, 30) +
      S("M490 330h110") +
      S("M330 390l-20 170h110l10-170") +
      R(280, 560, 190, 70, 18, true),
  ],
  "juego-desatornilladores-roble-32": [
    "maiz",
    R(260, 190, 70, 190, 30, true) +
      S("M295 380v230") +
      R(470, 190, 70, 190, 30, true) +
      S("M505 380v230") +
      S("M285 610h20M495 610h20"),
  ],
  "bombillo-led-9w-4u": [
    "maiz",
    S(
      "M400 190a130 130 0 0 1 80 232c-20 16-30 36-30 58H350c0-22-10-42-30-58a130 130 0 0 1 80-232z",
    ) + S("M350 540h100M365 600h70"),
  ],
  "salveque-urbano-sendero-25l": [
    "selva",
    S("M270 320a130 130 0 0 1 260 0v260a40 40 0 0 1-40 40H310a40 40 0 0 1-40-40z") +
      S("M340 230a60 60 0 0 1 120 0") +
      R(320, 430, 160, 120, 20),
  ],
  "botella-termica-sendero-750ml": [
    "celeste",
    R(330, 270, 140, 360, 36) + R(350, 190, 100, 80, 20) + S("M330 380h140"),
  ],
  "balon-futbol-sendero-5": [
    "selva",
    C(400, 400, 190) +
      F("M400 320l76 55-29 90h-94l-29-90z") +
      S("M400 320v-110M476 375l100-36M447 465l62 90M353 465l-62 90M324 375l-100-36"),
  ],
  "hamaca-algodon-doble": [
    "arena",
    S("M170 300c60 240 400 240 460 0") +
      S("M170 300v-90M630 300v-90") +
      S("M250 400c60 60 240 60 300 0"),
  ],
  "alimento-perro-adulto-tinamu-8kg": [
    "guaria",
    S("M260 230h280l30 380H230z") +
      C(400, 440, 40, true) +
      C(340, 370, 22, true) +
      C(400, 340, 22, true) +
      C(460, 370, 22, true),
  ],
  "camiseta-algodon-sendero": [
    "anil",
    S("M300 220l-130 80 50 90 60-34v264h240V356l60 34 50-90-130-80c-20 40-180 40-200 0z"),
  ],
  "rompecabezas-volcanes-500": [
    "guaria",
    S(
      "M220 300h130a50 50 0 1 1 100 0h130v130a50 50 0 1 0 0 100v130H450a50 50 0 1 0-100 0H220V530a50 50 0 1 1 0-100z",
    ),
  ],
  "libreta-tapa-dura-a5": [
    "anil",
    R(260, 190, 300, 420, 20) + S("M330 190v420") + S("M380 300h130M380 370h130M380 440h90"),
  ],
  "lampara-mesa-bambu": ["maiz", S("M300 380l40-170h120l40 170z") + S("M400 380v190M320 600h160")],
};

mkdirSync(OUT, { recursive: true });
for (const [slug, [tone, drawing]] of Object.entries(ART)) {
  const [background, ink] = TONES[tone];
  writeFileSync(
    `${OUT}${slug}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-hidden="true">` +
      `<rect width="800" height="800" fill="${background}"/>` +
      `<g color="${ink}">${drawing}</g></svg>\n`,
  );
}
console.info(`Drew ${Object.keys(ART).length} pictures in ${OUT}`);
