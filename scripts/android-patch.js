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
const xmlDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml');
const extractionPath = path.join(xmlDir, 'data_extraction_rules.xml');
const backupPath = path.join(xmlDir, 'backup_rules.xml');

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
  if (!out.includes('android.permission.CAMERA')) {
    out = out.replace(
      'android.permission.POST_NOTIFICATIONS" />',
      'android.permission.POST_NOTIFICATIONS" />\n    <uses-permission android:name="android.permission.CAMERA" />'
    );
  }
  if (!out.includes('com.google.mlkit.vision.DEPENDENCIES')) {
    out = out.replace(
      'android:theme="@style/AppTheme">',
      'android:theme="@style/AppTheme">\n\n        <meta-data\n            android:name="com.google.mlkit.vision.DEPENDENCIES"\n            android:value="barcode_ui" />'
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
  return disableBackup(out);
}

/**
 * Identity wrap + node stores must never leave via Google Auto Backup or
 * device-to-device transfer. Capacitor's default template sets allowBackup=true.
 */
function disableBackup (xml) {
  let out = xml;
  out = out.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');
  if (!/android:allowBackup=/.test(out)) {
    out = out.replace('<application', '<application android:allowBackup="false"');
  }
  if (!out.includes('android:dataExtractionRules')) {
    out = out.replace(
      'android:allowBackup="false"',
      'android:allowBackup="false"\n        android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="@xml/backup_rules"'
    );
  } else if (!out.includes('android:fullBackupContent')) {
    out = out.replace(
      'android:dataExtractionRules="@xml/data_extraction_rules"',
      'android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="@xml/backup_rules"'
    );
  }
  return out;
}

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <!-- Identity wrap + node stores stay off Google backup and device-to-device transfer. -->
    <cloud-backup>
        <exclude domain="file" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="database" path="." />
        <exclude domain="root" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="file" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="database" path="." />
        <exclude domain="root" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="file" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="database" path="." />
    <exclude domain="root" path="." />
    <exclude domain="external" path="." />
</full-backup-content>
`;

const CODE_SCANNER_DEP = "    implementation 'com.google.android.gms:play-services-code-scanner:16.1.0'";

function ensureCodeScannerDep (gradle) {
  if (gradle.includes('play-services-code-scanner')) return gradle;
  const needle = "implementation project(':capacitor-cordova-android-plugins')";
  if (gradle.includes(needle)) {
    return gradle.replace(needle, needle + '\n' + CODE_SCANNER_DEP);
  }
  return gradle.replace(
    "apply from: 'capacitor.build.gradle'",
    "apply from: 'capacitor.build.gradle'\n\ndependencies {\n" + CODE_SCANNER_DEP + '\n}\n'
  );
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
    console.log('[ANDROID] patched AndroidManifest.xml (fabric:// + INTERNET + cleartext + backup off)');
  } else {
    console.log('[ANDROID] AndroidManifest.xml already patched');
  }
  fs.mkdirSync(path.dirname(netSecPath), { recursive: true });
  fs.writeFileSync(netSecPath, NET_SEC);
  console.log('[ANDROID] wrote network_security_config.xml');
  fs.writeFileSync(extractionPath, DATA_EXTRACTION_RULES);
  fs.writeFileSync(backupPath, FULL_BACKUP_CONTENT);
  console.log('[ANDROID] wrote backup exclusion XML');

  const appBuild = path.join(root, 'android', 'app', 'build.gradle');
  if (fs.existsSync(appBuild)) {
    const raw = fs.readFileSync(appBuild, 'utf8');
    const patched = ensureCodeScannerDep(raw);
    if (patched !== raw) {
      fs.writeFileSync(appBuild, patched);
      console.log('[ANDROID] app/build.gradle Play code scanner');
    }
  }

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

module.exports = {
  patchManifest,
  disableBackup,
  ensureCodeScannerDep,
  main
};

if (require.main === module) {
  main();
}
