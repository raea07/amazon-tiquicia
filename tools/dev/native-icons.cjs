// Draws the native apps' icons and splash images from the brand's geometry.
//
//   node tools/dev/native-icons.cjs
//
// Writes into apps/*-native/assets/. The drawing is the brand's app icon
// (packages/brand/assets/app-icon.svg: the white mark at 70 % on a brand-colour
// square) and the mark alone for the splash screen and Android's adaptive
// icon. Rendered with the Chromium that the browser journeys already use,
// because there is no SVG rasteriser on the build machines.

const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  require.resolve("playwright", { paths: [path.join(__dirname, "../e2e")] }),
);

const ROOT = path.join(__dirname, "../..");
const APPS = ["shop-native", "seller-native", "driver-native", "warehouse-native"];
const BRAND = "#0b7f8e"; // celeste 600, semantic.brand
const MARK = `<path d="M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42" fill="none" stroke="COLOR" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11" r="6" fill="COLOR"/><circle cx="36" cy="11" r="6" fill="COLOR"/>`;

const mark = (color, scale) => {
  const offset = (48 - 48 * scale) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${MARK.replaceAll("COLOR", color)}</g>`;
};

const images = {
  // iOS masks the corners itself and refuses transparency: a full square.
  "icon.png": [1024, `<rect width="48" height="48" fill="${BRAND}"/>${mark("#ffffff", 0.7)}`],
  // Android draws the background colour and crops to a circle or squircle:
  // the mark must sit inside the central 66 % safe zone.
  "android-icon-foreground.png": [1024, mark("#ffffff", 0.42)],
  "android-icon-monochrome.png": [1024, mark("#ffffff", 0.42)],
  "splash-icon.png": [512, mark(BRAND, 1)],
  "favicon.png": [
    96,
    `<rect width="48" height="48" rx="11" fill="${BRAND}"/>${mark("#ffffff", 0.7)}`,
  ],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, [size, body]] of Object.entries(images)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">${body}</svg>`;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
    );
    const png = await page.locator("svg").screenshot({ omitBackground: true });
    for (const app of APPS) {
      const dir = path.join(ROOT, "apps", app, "assets");
      mkdirSync(dir, { recursive: true });
      require("node:fs").writeFileSync(path.join(dir, name), png);
    }
    console.info(`${name} ${size}×${size}`);
  }
  await browser.close();
})();
