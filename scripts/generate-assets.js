/*
 * Vyroniq native asset generator.
 *
 * Produces production-grade Android launcher + splash resources from the two
 * source images in assets/:
 *   assets/icon.png   1024x1024  app glyph (transparent background)
 *   assets/splash.png brand cold-launch image
 *
 * Why this exists instead of `@capacitor/assets generate`: that CLI hard-fails
 * unless the sources are exactly 1024x1024 / 2732x2732 and the configured
 * `icon.foreground` file is present. It also does not composite an opaque
 * legacy ic_launcher (needed for pre-Android-8 launchers) or pad the adaptive
 * foreground into the 66dp safe-zone. This script handles all of that
 * deterministically and is idempotent.
 *
 * Run: node scripts/generate-assets.js
 */
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

const BRAND_BG = 0x26a69aff; // #26A69A teal (matches capacitor.config.ts icon.background)

// Launcher icon edge length per density (px).
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Splash size per density [portraitW, portraitH]; landscape is the transpose.
const SPLASH = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

// Bounding box of opaque pixels (the visible glyph), read from the raw RGBA
// buffer for speed (avoids ~1M getPixelColor calls).
function glyphBBox(img, alphaMin = 8) {
  const { width: w, height: h, data } = img.bitmap;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Scale to fit within boxW x boxH, preserving aspect ratio (letterbox).
function fitTo(img, boxW, boxH) {
  const scale = Math.min(boxW / img.bitmap.width, boxH / img.bitmap.height);
  return img
    .clone()
    .resize({ w: Math.max(1, Math.round(img.bitmap.width * scale)), h: Math.max(1, Math.round(img.bitmap.height * scale)) });
}

// Scale to fill w x h then center-crop (full-bleed, no borders/distortion).
function coverTo(img, w, h) {
  const scale = Math.max(w / img.bitmap.width, h / img.bitmap.height);
  const rw = Math.round(img.bitmap.width * scale);
  const rh = Math.round(img.bitmap.height * scale);
  const r = img.clone().resize({ w: rw, h: rh });
  return r.crop({ x: Math.round((rw - w) / 2), y: Math.round((rh - h) / 2), w, h });
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const iconSrc = path.join(ASSETS, 'icon.png');
  const splashSrc = path.join(ASSETS, 'splash.png');
  if (!fs.existsSync(iconSrc)) throw new Error('Missing assets/icon.png');
  if (!fs.existsSync(splashSrc)) throw new Error('Missing assets/splash.png');

  // --- Load & normalize the icon to 1024x1024 -------------------------------
  const icon = await Jimp.Jimp.read(iconSrc);
  if (icon.bitmap.width !== 1024 || icon.bitmap.height !== 1024) {
    coverTo(icon, 1024, 1024).write(iconSrc);
  }
  const iconImg = await Jimp.Jimp.read(iconSrc);

  const bb = glyphBBox(iconImg);
  console.log(`[assets] glyph bbox: ${bb.w}x${bb.h} @ (${bb.x},${bb.y}) of 1024x1024`);
  const glyph = iconImg.clone().crop({ x: bb.x, y: bb.y, w: bb.w, h: bb.h });

  // --- assets/icon-foreground.png (adaptive, safe-zone padded) --------------
  // Adaptive icons show only the centre ~66.6% (72/108dp). Keep the glyph at
  // 60% so it is never clipped by the circular/squircle mask.
  const fgBox = Math.round(1024 * 0.6);
  const glyphFg = fitTo(glyph, fgBox, fgBox);
  const fgCanvas = new Jimp.Jimp({ width: 1024, height: 1024, color: 0x00000000 });
  fgCanvas.composite(
    glyphFg,
    Math.round((1024 - glyphFg.bitmap.width) / 2),
    Math.round((1024 - glyphFg.bitmap.height) / 2),
  );
  await fgCanvas.write(path.join(ASSETS, 'icon-foreground.png'));
  console.log('[assets] wrote assets/icon-foreground.png');

  // --- assets/icon-background.png (solid brand colour, for tooling/reference)
  const bgCanvas = new Jimp.Jimp({ width: 1024, height: 1024, color: BRAND_BG });
  await bgCanvas.write(path.join(ASSETS, 'icon-background.png'));
  console.log('[assets] wrote assets/icon-background.png');

  // --- Legacy composite: opaque teal + centred glyph (pre-Android-8) --------
  const legacyBox = Math.round(1024 * 0.72);
  const glyphLegacy = fitTo(glyph, legacyBox, legacyBox);
  const legacy = new Jimp.Jimp({ width: 1024, height: 1024, color: BRAND_BG });
  legacy.composite(
    glyphLegacy,
    Math.round((1024 - glyphLegacy.bitmap.width) / 2),
    Math.round((1024 - glyphLegacy.bitmap.height) / 2),
  );

  // --- Per-density mipmaps --------------------------------------------------
  for (const [density, size] of Object.entries(LAUNCHER)) {
    const dir = path.join(RES, `mipmap-${density}`);
    ensureDir(dir);
    await legacy.clone().resize({ w: size, h: size }).write(path.join(dir, 'ic_launcher.png'));
    await legacy.clone().resize({ w: size, h: size }).write(path.join(dir, 'ic_launcher_round.png'));
    await fgCanvas.clone().resize({ w: size, h: size }).write(path.join(dir, 'ic_launcher_foreground.png'));
    await new Jimp.Jimp({ width: size, height: size, color: BRAND_BG }).write(
      path.join(dir, 'ic_launcher_background.png'),
    );
    console.log(`[assets] mipmap-${density} -> ${size}px (ic_launcher, round, foreground, background)`);
  }

  // --- Adaptive icon XMLs ---------------------------------------------------
  const anydpi = path.join(RES, 'mipmap-anydpi-v26');
  ensureDir(anydpi);
  const adaptive =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '    <background android:drawable="@color/ic_launcher_background"/>\n' +
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n' +
    '</adaptive-icon>\n';
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
  console.log('[assets] mipmap-anydpi-v26 adaptive icons');

  // --- values/colors.xml: ensure brand teal for the adaptive-icon background ---
  // ic_launcher_background MUST live in colors.xml (the canonical Capacitor
  // location). Writing it to a second values/*.xml would collide as a duplicate
  // resource and fail the build. Patch colors.xml in place.
  const valuesDir = path.join(RES, 'values');
  ensureDir(valuesDir);
  const colorsPath = path.join(valuesDir, 'colors.xml');
  let colorsXml = fs.existsSync(colorsPath) ? fs.readFileSync(colorsPath, 'utf8') : null;
  if (colorsXml === null) {
    colorsXml =
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
  }
  if (/name="ic_launcher_background"/.test(colorsXml)) {
    colorsXml = colorsXml.replace(
      /<color name="ic_launcher_background">[^<]*<\/color>/,
      '<color name="ic_launcher_background">#26A69A</color>',
    );
  } else {
    colorsXml = colorsXml.replace(
      '<resources>',
      '<resources>\n    <color name="ic_launcher_background">#26A69A</color>',
    );
  }
  fs.writeFileSync(colorsPath, colorsXml);
  // Remove any legacy standalone duplicate that would break the resource merger.
  const legacyBg = path.join(valuesDir, 'ic_launcher_background.xml');
  if (fs.existsSync(legacyBg)) fs.rmSync(legacyBg);
  console.log('[assets] values/colors.xml ic_launcher_background = #26A69A (duplicate removed)');

  // --- Splash density drawables (full-bleed brand image) --------------------
  const splash = await Jimp.Jimp.read(splashSrc);
  for (const [density, [pw, ph]] of Object.entries(SPLASH)) {
    const pdir = path.join(RES, `drawable-port-${density}`);
    const ldir = path.join(RES, `drawable-land-${density}`);
    ensureDir(pdir);
    ensureDir(ldir);
    await coverTo(splash, pw, ph).write(path.join(pdir, 'splash.png'));
    await coverTo(splash, ph, pw).write(path.join(ldir, 'splash.png'));
  }
  // Default drawable used by @drawable/splash in styles.xml (AppTheme.NoActionBarLaunch)
  const ddir = path.join(RES, 'drawable');
  ensureDir(ddir);
  await coverTo(splash, 480, 320).write(path.join(ddir, 'splash.png'));
  console.log('[assets] splash drawables (port/land/default) from brand image');

  console.log('\n[assets] Done. All Android icon & splash resources are on-brand.');
}

main().catch((err) => {
  console.error('[assets] ERROR:', err);
  process.exit(1);
});

