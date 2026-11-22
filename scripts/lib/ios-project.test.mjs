import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plistArray, plistString, pbxSettings } from './ios-project.mjs';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
  </array>
  <key>UISupportedInterfaceOrientations~ipad</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
  </array>
</dict></plist>`;

test('plistArray reads an array key and tells the iPhone key from the ~ipad one', () => {
  assert.deepEqual(plistArray(PLIST, 'UISupportedInterfaceOrientations'), ['UIInterfaceOrientationPortrait']);
  assert.deepEqual(plistArray(PLIST, 'UISupportedInterfaceOrientations~ipad'),
    ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft']);
  assert.equal(plistArray(PLIST, 'UIRequiredDeviceCapabilities'), null);
});

test('plistString reads a string key', () => {
  assert.equal(plistString(PLIST, 'CFBundleShortVersionString'), '$(MARKETING_VERSION)');
  assert.equal(plistString(PLIST, 'CFBundleDisplayName'), null);
});

test('pbxSettings returns each distinct value of a build setting, quoted or not', () => {
  const pbx = `
    buildSettings = { MARKETING_VERSION = 2.14.4; PRODUCT_BUNDLE_IDENTIFIER = com.example.app; TARGETED_DEVICE_FAMILY = "1,2"; };
    buildSettings = { MARKETING_VERSION = 2.14.4; PRODUCT_BUNDLE_IDENTIFIER = com.example.app; TARGETED_DEVICE_FAMILY = "1,2"; };
    buildSettings = { MARKETING_VERSION = 2.14.3; };`;
  assert.deepEqual(pbxSettings(pbx, 'MARKETING_VERSION'), ['2.14.4', '2.14.3']);
  assert.deepEqual(pbxSettings(pbx, 'PRODUCT_BUNDLE_IDENTIFIER'), ['com.example.app']);
  assert.deepEqual(pbxSettings(pbx, 'TARGETED_DEVICE_FAMILY'), ['1,2']);
  assert.deepEqual(pbxSettings(pbx, 'CURRENT_PROJECT_VERSION'), []);
});
