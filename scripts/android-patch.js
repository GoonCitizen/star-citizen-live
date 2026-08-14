'use strict';

/**
 * Patch the Capacitor Android project after `npx cap add android` / `npx cap sync`.
 * Adds fabric:// intent-filters, INTERNET + notifications, and loopback-only cleartext.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const netSecPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');

const INTENT_FILTER = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="fabric" android:host="login" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="fabric" android:host="link" />
            </intent-filter>`;

const NET_SEC = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Local LiveRelay only. Remote application traffic is Fabric TCP/NOISE, not HTTP. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

function patchManifest (xml) {
  let out = xml;
  if (!out.includes('android.permission.INTERNET')) {
    out = out.replace(
      '<application',
      '    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application'
    );
  } else if (!out.includes('POST_NOTIFICATIONS')) {
    out = out.replace(
      'android.permission.INTERNET" />',
      'android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
    );
  }
  if (!out.includes('android:usesCleartextTraffic')) {
    out = out.replace('<application', '<application android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/network_security_config"');
  }
  if (!out.includes('android:host="login"')) {
    const marker = '</activity>';
    const i = out.indexOf(marker);
    if (i >= 0) {
      const before = out.lastIndexOf('<activity', i);
      const chunk = out.slice(before, i);
      if (chunk.includes('MainActivity')) {
        out = out.slice(0, i) + INTENT_FILTER + '\n        ' + out.slice(i);
      }
    }
  }
  return out;
}

function main () {
  if (!fs.existsSync(manifestPath)) {
    console.warn('[ANDROID] no android/ project yet — run `npx cap add android` first');
    return;
  }
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const next = patchManifest(xml);
  if (next !== xml) {
    fs.writeFileSync(manifestPath, next);
    console.log('[ANDROID] patched AndroidManifest.xml (fabric:// + INTERNET + cleartext)');
  } else {
    console.log('[ANDROID] AndroidManifest.xml already patched');
  }
  fs.mkdirSync(path.dirname(netSecPath), { recursive: true });
  fs.writeFileSync(netSecPath, NET_SEC);
  console.log('[ANDROID] wrote network_security_config.xml');

  const capBuild = path.join(root, 'android', 'app', 'capacitor.build.gradle');
  if (fs.existsSync(capBuild)) {
    const raw = fs.readFileSync(capBuild, 'utf8');
    const patched = raw.replace(/JavaVersion\.VERSION_21/g, 'JavaVersion.VERSION_17');
    if (patched !== raw) {
      fs.writeFileSync(capBuild, patched);
      console.log('[ANDROID] capacitor.build.gradle Java 17 (Homebrew OpenJDK 17)');
    }
  }
  const gradleRoots = [
    path.join(root, 'node_modules', '@capacitor'),
    path.join(root, 'node_modules', '@choreruiz')
  ];
  for (const gradleRoot of gradleRoots) {
    if (!fs.existsSync(gradleRoot)) continue;
    const stack = [gradleRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory() && ent.name !== 'node_modules') stack.push(p);
        else if (ent.name.endsWith('.gradle')) {
          const raw = fs.readFileSync(p, 'utf8');
          const patched = raw.replace(/JavaVersion\.VERSION_21/g, 'JavaVersion.VERSION_17');
          if (patched !== raw) {
            fs.writeFileSync(p, patched);
            console.log('[ANDROID] Java 17', path.relative(root, p));
          }
        }
      }
    }
  }
}

main();
