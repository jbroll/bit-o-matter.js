const fs = require("fs");

// Patch 1: BLE scanning — scan all peripherals, not just those advertising Matter UUID
["esm", "cjs"].forEach((t) => {
  const f = `node_modules/@matter/nodejs-ble/dist/${t}/NobleBleClient.js`;
  const s = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, s.replace(/startScanningAsync\(\[.*?\]/, "startScanningAsync([]"));
});

// Patch 2: BLE discovery — accept Matter service data of any length (not just 8 bytes)
["esm", "cjs"].forEach((t) => {
  const f = `node_modules/@matter/nodejs-ble/dist/${t}/NobleBleClient.js`;
  const s = fs.readFileSync(f, "utf8");
  fs.writeFileSync(
    f,
    s.replace(
      /matterServiceData\.data\.length !== 8/,
      "matterServiceData.data.length === 0"
    )
  );
});

// Patch 3: WiFi scan — don't fail commissioning if device doesn't see the SSID
["esm", "cjs"].forEach((t) => {
  const f = `node_modules/@matter/protocol/dist/${t}/peer/ControllerCommissioningFlow.js`;
  const s = fs.readFileSync(f, "utf8");
  fs.writeFileSync(
    f,
    s.replace(
      /throw new WifiNetworkSetupFailedError\(\s*`Commissionee did not return any WiFi networks/,
      'logger.warn(`Commissionee did not return any WiFi networks'
    )
  );
});
