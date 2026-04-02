const fs = require("fs");

// Patch 1: BLE scanning — scan all peripherals, not just those advertising Matter UUID
["esm", "cjs"].forEach((t) => {
  const f = `node_modules/@matter/nodejs-ble/dist/${t}/NobleBleClient.js`;
  const s = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, s.replace(/startScanningAsync\(\[.*?\]/, "startScanningAsync([]"));
});

// Patch 2: WiFi scan — don't fail commissioning if device doesn't see the SSID
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
