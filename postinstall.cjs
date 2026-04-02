const fs = require("fs");

let failed = false;

function patch(file, pattern, replacement, label) {
  const s = fs.readFileSync(file, "utf8");
  if (!pattern.test(s)) {
    if (s.includes(replacement.slice(0, 30))) return; // already patched
    console.error(`postinstall: FATAL — patch "${label}" did not match in ${file}`);
    failed = true;
    return;
  }
  fs.writeFileSync(file, s.replace(pattern, replacement));
}

// Patch 1: BLE scanning — scan all peripherals, not just those advertising Matter UUID
["esm", "cjs"].forEach((t) => {
  patch(
    `node_modules/@matter/nodejs-ble/dist/${t}/NobleBleClient.js`,
    /startScanningAsync\(\[.*?\]/,
    "startScanningAsync([]",
    "BLE scan filter"
  );
});

// Patch 2: BLE discovery — accept Matter service data of any length (not just 8 bytes)
["esm", "cjs"].forEach((t) => {
  patch(
    `node_modules/@matter/nodejs-ble/dist/${t}/NobleBleClient.js`,
    /matterServiceData\.data\.length !== 8/,
    "matterServiceData.data.length === 0",
    "BLE service data length"
  );
});

// Patch 3: WiFi scan — don't fail commissioning if device doesn't see the SSID
["esm", "cjs"].forEach((t) => {
  patch(
    `node_modules/@matter/protocol/dist/${t}/peer/ControllerCommissioningFlow.js`,
    /throw new WifiNetworkSetupFailedError\(\s*`Commissionee did not return any WiFi networks/,
    'logger.warn(`Commissionee did not return any WiFi networks',
    "WiFi scan validation"
  );
});

if (failed) process.exit(1);
