'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { patchManifest, ensureCodeScannerDep } = require('../../scripts/android-patch');

const CAPACITOR_DEFAULT = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" android:exported="true">
        </activity>
    </application>
</manifest>
`;

describe('android-patch backup exclusion', () => {
  it('turns Capacitor allowBackup=true into false with extraction rules', () => {
    const out = patchManifest(CAPACITOR_DEFAULT);
    assert.match(out, /android:allowBackup="false"/);
    assert.doesNotMatch(out, /android:allowBackup="true"/);
    assert.match(out, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
    assert.match(out, /android:fullBackupContent="@xml\/backup_rules"/);
    assert.match(out, /android.permission.CAMERA/);
    assert.match(out, /com.google.mlkit.vision.DEPENDENCIES/);
  });

  it('is idempotent once backup is already disabled', () => {
    const once = patchManifest(CAPACITOR_DEFAULT);
    const twice = patchManifest(once);
    assert.equal(twice, once);
  });

  it('adds the Play services code scanner next to Capacitor plugins', () => {
    const gradle = [
      "apply from: 'capacitor.build.gradle'",
      '',
      'dependencies {',
      "    implementation project(':capacitor-android')",
      "    implementation project(':capacitor-cordova-android-plugins')",
      '}'
    ].join('\n');
    const out = ensureCodeScannerDep(gradle);
    assert.match(out, /play-services-code-scanner:16\.1\.0/);
    assert.equal(ensureCodeScannerDep(out), out);
  });
});
