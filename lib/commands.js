import { matter, getController } from "./controller.js";
import { loadDevices, saveDevices, loadWifi, saveWifi, peerUniqueId, deviceType } from "./store.js";
import { scanQrCode } from "./qr-server.js";

export async function pair(name, passcode, discriminator, cliSsid, cliWifiPassword) {
  const { ManualPairingCodeCodec } = await import("@matter/types/schema");

  let notify, ssid, wifiPassword;

  const isManualCode = passcode !== undefined && discriminator === undefined
    && /^[\d-]+$/.test(passcode) && passcode.replace(/\D/g, "").length === 11;

  if (passcode === undefined) {
    let webName;
    ({ name: webName, passcode, discriminator, notify, ssid, wifiPassword } = await scanQrCode(name));
    name = webName || name;
  } else if (isManualCode) {
    const decoded = ManualPairingCodeCodec.decode(passcode.replace(/\D/g, ""));
    passcode = decoded.passcode;
    discriminator = undefined;
    passcode = { passcode: decoded.passcode, shortDiscriminator: decoded.shortDiscriminator };
  }

  if (!name) {
    console.error("Device name is required");
    process.exit(1);
  }
  if (loadDevices()[name]) {
    console.error(`Device '${name}' already exists. Remove it first or choose a different name.`);
    process.exit(1);
  }

  if (notify === undefined) {
    if (cliSsid) {
      ssid = cliSsid;
      wifiPassword = cliWifiPassword ?? "";
    } else {
      const saved = loadWifi();
      const keys = Object.keys(saved);
      if (keys.length === 1) {
        ssid = keys[0];
        wifiPassword = saved[ssid];
      } else if (keys.length > 1) {
        const arg = isManualCode ? passcode?.passcode ?? passcode : `${passcode} ${discriminator}`;
        console.error(`Multiple saved Wi-Fi networks — specify: pair ${name} ${arg} <ssid> <password>`);
        process.exit(1);
      }
    }
  }

  const { Seconds, Logger, LogLevel } = await matter();
  if (process.argv.includes("--verbose")) {
    Logger.defaultLogLevel = LogLevel.DEBUG;
  }
  const controller = await getController({ ble: true });

  let commissionOptions;
  if (isManualCode && typeof passcode === "object") {
    commissionOptions = {
      passcode: passcode.passcode,
      shortDiscriminator: passcode.shortDiscriminator,
      timeout: Seconds(120),
    };
  } else {
    commissionOptions = {
      passcode: Number(passcode),
      discriminator: Number(discriminator),
      timeout: Seconds(120),
    };
  }
  commissionOptions.regulatoryCountryCode = "US";
  if (ssid) {
    commissionOptions.wifiNetwork = { wifiSsid: ssid, wifiCredentials: wifiPassword };
  }

  // Clean up orphaned peers that aren't in devices.json
  const activeIds = new Set(Object.values(loadDevices()).map(d => d.id));
  for (const peer of controller.peers) {
    if (!activeIds.has(peer.id)) {
      try { await peer.delete(); } catch {}
    }
  }

  let clientNode;
  try {
    clientNode = await controller.peers.commission(commissionOptions);
  } catch (err) {
    if (notify) notify(err);
    await controller.close();
    throw err;
  }

  const devices = loadDevices();

  // Clean up any existing entry for the same physical device
  const newUid = peerUniqueId(clientNode.id);
  if (newUid) {
    for (const [oldName, oldEntry] of Object.entries(devices)) {
      if (oldName === name) continue;
      if (peerUniqueId(oldEntry.id) === newUid) {
        const oldPeer = controller.peers.get(oldEntry.id);
        if (oldPeer) {
          try { await oldPeer.delete(); } catch {}
        }
        delete devices[oldName];
        console.log(`Replaced previous entry '${oldName}'`);
      }
    }
  }

  devices[name] = {
    id: clientNode.id,
    endpoint: 1,
  };
  saveDevices(devices);

  if (ssid) saveWifi(ssid, wifiPassword);
  if (notify) notify(null);
  console.log(`Paired '${name}'`);
  await controller.close();
}

export async function toggle(name, turnOn) {
  const devices = loadDevices();
  const entry = devices[name];

  if (!entry) {
    console.error(`Unknown device: ${name}`);
    process.exit(1);
  }

  const controller = await getController();
  const peer = controller.peers.get(entry.id);

  if (!peer) {
    console.error(
      `Device '${name}' (id: ${entry.id}) not found in controller storage`,
    );
    await controller.close();
    process.exit(1);
  }

  const { Invoke, OnOff } = await matter();
  const command = turnOn ? "on" : "off";
  for await (const _ of peer.interaction.invoke(
    Invoke(
      Invoke.ConcreteCommandRequest({
        endpoint: entry.endpoint,
        cluster: OnOff.Cluster,
        command,
      }),
    ),
  )) { /* drain response chunks */ }
  await controller.close();
}

export function list() {
  const devices = loadDevices();
  const entries = Object.entries(devices);
  if (entries.length === 0) {
    console.log("No devices paired.");
    return;
  }
  const rows = entries.map(([name, info]) => [name, deviceType(info.id, info.endpoint)]);
  const nameW = Math.max(4, ...rows.map(r => r[0].length));
  const typeW = Math.max(4, ...rows.map(r => r[1].length));
  console.log(`${"Name".padEnd(nameW)}  ${"Type".padEnd(typeW)}`);
  console.log(`${"-".repeat(nameW)}  ${"-".repeat(typeW)}`);
  for (const [name, type] of rows) {
    console.log(`${name.padEnd(nameW)}  ${type.padEnd(typeW)}`);
  }
}

export function rename(oldName, newName) {
  const devices = loadDevices();
  if (!devices[oldName]) {
    console.error(`Unknown device: ${oldName}`);
    process.exit(1);
  }
  if (devices[newName]) {
    console.error(`Device '${newName}' already exists`);
    process.exit(1);
  }
  devices[newName] = devices[oldName];
  delete devices[oldName];
  saveDevices(devices);
  console.log(`Renamed '${oldName}' -> '${newName}'`);
}

export async function remove(name) {
  const devices = loadDevices();
  const entry = devices[name];
  if (!entry) {
    console.error(`Unknown device: ${name}`);
    process.exit(1);
  }

  const controller = await getController();
  const peer = controller.peers.get(entry.id);

  if (peer) {
    try {
      await peer.decommission();
    } catch {
      try { await peer.delete(); } catch {}
    }
  }

  delete devices[name];
  saveDevices(devices);
  await controller.close();
  console.log(`Removed '${name}'`);
}

export async function bleScan() {
  const seconds = 10;
  console.log(`Scanning BLE for ${seconds}s... (looking for Matter devices)`);
  await import("@matter/nodejs-ble");
  const noble = (await import("@stoprocent/noble")).default;
  if (typeof noble.on !== "function") {
    // Some noble versions export a factory
  }

  await new Promise((resolve) => {
    if (noble.state === "poweredOn") resolve();
    else noble.on("stateChange", (s) => { if (s === "poweredOn") resolve(); });
  });

  const seen = new Set();
  noble.on("discover", (p) => {
    if (seen.has(p.address)) return;
    seen.add(p.address);
    const ad = p.advertisement;
    const svcData = (ad.serviceData || []).map(({ uuid, data }) =>
      `${uuid}:${Buffer.from(data).toString("hex")}`
    ).join(" ");
    const isMatter = (ad.serviceData || []).some(({ uuid }) =>
      uuid.toLowerCase() === "fff6"
    );
    console.log(
      `  ${p.address}  ${isMatter ? "** MATTER **" : "            "}  ` +
      `rssi=${p.rssi}  conn=${p.connectable ? "Y" : "N"}  ${ad.localName || ""}  ${svcData || "(no svc data)"}`
    );
  });

  await noble.startScanningAsync([], true);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await noble.stopScanningAsync();
  console.log(`Found ${seen.size} device(s).`);
}
