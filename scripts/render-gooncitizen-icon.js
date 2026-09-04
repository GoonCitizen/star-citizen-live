'use strict';

/**
 * Render the canonical GoonCitizen lettermark (serif lowercase **gc**) into
 * this package's desktop / Android / dashboard icon assets.
 *
 * Requires macOS (`swift`, `sips`, `iconutil`). Uses Arvo Bold from
 * `@fabric/http` (or sibling `~/fabric-http` / `FABRIC_HTTP`).
 *
 *   npm run make:icons
 *   node scripts/render-gooncitizen-icon.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  GOONCITIZEN_BRAND_PURPLE,
  GOONCITIZEN_BRAND_FOREGROUND,
  GOONCITIZEN_BRAND_LETTER,
  GOONCITIZEN_BRAND_TITLE,
  GOONCITIZEN_BRAND_TRACKING_EM
} = require('../functions/goonCitizenBrand');

const ROOT = path.join(__dirname, '..');
const SWIFT = path.join(__dirname, 'render-gooncitizen-icon.swift');
const ASSETS = path.join(ROOT, 'assets');
const ICONS = path.join(ASSETS, 'icons');
const MASTER = 1024;
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

function resolveArvoFont () {
  const rel = path.join('assets', 'themes', 'fabric', 'assets', 'fonts', 'arvo-normal-700.ttf');
  const candidates = [];
  if (process.env.FABRIC_HTTP) {
    candidates.push(path.join(process.env.FABRIC_HTTP, rel));
  }
  try {
    const httpPkg = require.resolve('@fabric/http/package.json');
    candidates.push(path.join(path.dirname(httpPkg), rel));
  } catch (_) {
    // linked / missing
  }
  candidates.push(path.join(ROOT, 'node_modules', '@fabric', 'http', rel));
  candidates.push(path.join(ROOT, '..', 'fabric-http', rel));
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Arvo Bold TTF not found. Install @fabric/http (or set FABRIC_HTTP / link sibling fabric-http).'
  );
}

function run (cmd, args, opts) {
  const res = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts || {}));
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim() || `${cmd} exited ${res.status}`;
    throw new Error(err);
  }
  return res;
}

function writeIco (entries, dest) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const dirParts = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    const w = entry.width >= 256 ? 0 : entry.width;
    const h = entry.height >= 256 ? 0 : entry.height;
    dir.writeUInt8(w, 0);
    dir.writeUInt8(h, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += entry.png.length;
    dirParts.push(dir);
  }
  fs.writeFileSync(dest, Buffer.concat([header, ...dirParts, ...entries.map((e) => e.png)]));
}

function copyFile (src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function buildIcns (pngBySize, dest) {
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'gooncitizen-iconset-'));
  const map = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ];
  for (const [name, size] of map) {
    fs.copyFileSync(pngBySize[size], path.join(iconset, name));
  }
  const named = `${iconset}.iconset`;
  fs.renameSync(iconset, named);
  try {
    run('iconutil', ['-c', 'icns', named, '-o', dest]);
  } finally {
    fs.rmSync(named, { recursive: true, force: true });
  }
}

function writeAndroidLaunchers (masterPng) {
  const res = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(res)) {
    console.log('[gooncitizen-icon] skip android launchers (no res/)');
    return;
  }
  const densities = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432]
  ];
  for (const [dir, launcher, foreground] of densities) {
    const folder = path.join(res, dir);
    fs.mkdirSync(folder, { recursive: true });
    const launcherPng = path.join(folder, 'ic_launcher.png');
    run('sips', ['-z', String(launcher), String(launcher), masterPng, '--out', launcherPng]);
    copyFile(launcherPng, path.join(folder, 'ic_launcher_round.png'));
    run('sips', [
      '-z', String(foreground), String(foreground), masterPng,
      '--out', path.join(folder, 'ic_launcher_foreground.png')
    ]);
  }
  const colorXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `    <color name="ic_launcher_background">${GOONCITIZEN_BRAND_PURPLE}</color>`,
    '</resources>',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), colorXml);
  const bgVector = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="108dp"',
    '    android:height="108dp"',
    '    android:viewportWidth="108"',
    '    android:viewportHeight="108">',
    `    <path android:fillColor="${GOONCITIZEN_BRAND_PURPLE}" android:pathData="M0,0h108v108h-108z" />`,
    '</vector>',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(res, 'drawable', 'ic_launcher_background.xml'), bgVector);
}

function main () {
  if (process.platform !== 'darwin') {
    throw new Error('npm run make:icons requires macOS (swift, sips, iconutil)');
  }
  const font = resolveArvoFont();
  fs.mkdirSync(ICONS, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });

  const masterPng = path.join(ICONS, 'icon-1024.png');
  const svgOut = path.join(ASSETS, 'favicon.svg');
  const swiftBrand = [
    SWIFT,
    '--font', font,
    '--purple', GOONCITIZEN_BRAND_PURPLE,
    '--white', GOONCITIZEN_BRAND_FOREGROUND,
    '--letter', GOONCITIZEN_BRAND_LETTER,
    '--title', GOONCITIZEN_BRAND_TITLE,
    '--tracking', String(GOONCITIZEN_BRAND_TRACKING_EM)
  ];

  run('swift', swiftBrand.concat([
    '--size', String(MASTER),
    '--png', masterPng,
    '--svg', svgOut
  ]));

  const letter32 = path.join(ICONS, 'icon-letter-32.png');
  const letter64 = path.join(ICONS, 'icon-letter-64.png');
  run('swift', swiftBrand.concat(['--transparent', '--size', '32', '--png', letter32]));
  run('swift', swiftBrand.concat(['--transparent', '--size', '64', '--png', letter64]));

  const pngBySize = { 1024: masterPng };
  for (const size of PNG_SIZES) {
    if (size === 1024) continue;
    const dest = path.join(ICONS, `icon-${size}.png`);
    run('sips', ['-z', String(size), String(size), masterPng, '--out', dest]);
    pngBySize[size] = dest;
  }

  copyFile(pngBySize[512], path.join(ASSETS, 'icon.png'));
  copyFile(pngBySize[512], path.join(ICONS, 'icon.png'));
  copyFile(pngBySize[180], path.join(ASSETS, 'apple-touch-icon.png'));
  copyFile(pngBySize[32], path.join(ASSETS, 'tray.png'));
  copyFile(letter32, path.join(ASSETS, 'trayTemplate.png'));
  copyFile(letter64, path.join(ASSETS, 'trayTemplate@2x.png'));

  const icoPath = path.join(ASSETS, 'favicon.ico');
  writeIco(
    [16, 32, 48, 256].map((size) => ({
      width: size,
      height: size,
      png: fs.readFileSync(pngBySize[size])
    })),
    icoPath
  );
  copyFile(icoPath, path.join(ASSETS, 'icon.ico'));

  const icnsPath = path.join(ASSETS, 'icon.icns');
  buildIcns(pngBySize, icnsPath);

  const androidWww = path.join(ROOT, 'android-www');
  if (fs.existsSync(androidWww)) {
    copyFile(icoPath, path.join(androidWww, 'favicon.ico'));
    copyFile(svgOut, path.join(androidWww, 'favicon.svg'));
    copyFile(path.join(ASSETS, 'apple-touch-icon.png'), path.join(androidWww, 'apple-touch-icon.png'));
  }

  writeAndroidLaunchers(masterPng);

  const readme = [
    '# GoonCitizen lettermark',
    '',
    'Serif lowercase **gc** (Arvo Bold) in white on rich royal purple `' + GOONCITIZEN_BRAND_PURPLE + '`.',
    '',
    'Canonical generator: `npm run make:icons` (`scripts/render-gooncitizen-icon.js`).',
    'Hub and goon.vc keep the Fabric **f** from `@fabric/http` `npm run make:icons`.',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(ICONS, 'README.md'), readme);

  console.log('[gooncitizen-icon] wrote', path.relative(ROOT, svgOut), 'and', PNG_SIZES.length, 'png sizes');
}

main();
