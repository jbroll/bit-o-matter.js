#!/usr/bin/env node

/**
 * Minimal Matter CLI (no daemon)
 *
 * Intent:
 * - Ephemeral controller: created per invocation, destroyed on exit
 * - Persistent identity: stored on disk (fabric, certs, paired nodes)
 * - Friendly naming layer: maps human names -> nodeId/endpoint
 *
 * This is the lightest viable way to script Matter devices.
 */

import fs from "fs";
import path from "path";

// ---------- Config ----------

import { homedir } from "os";
const BASE_DIR = path.join(homedir(), ".matter-cli");
const DEVICES_FILE = path.join(BASE_DIR, "devices.json");
const WIFI_FILE = path.join(BASE_DIR, "wifi.json");

let _matter; // cached matter.js imports
async function matter() {
  if (_matter) return _matter;
  const m = await import("@matter/main");
  const { Invoke } = await import("@matter/main/protocol");
  const { OnOff } = await import("@matter/main/clusters/on-off");

  const verbose = process.argv.includes("--verbose");
  m.Logger.defaultLogLevel = verbose ? m.LogLevel.DEBUG : m.LogLevel.FATAL;
  m.Environment.default.vars.set("path.root", BASE_DIR);
  m.Environment.default.vars.set("runtime.signals", false);
  m.Environment.default.vars.set("runtime.exitcode", false);
  m.Environment.default.vars.set("ble.enable", false);

  _matter = { ...m, Invoke, OnOff };
  return _matter;
}

// ---------- Helpers ----------

function ensureDirs() {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
  if (!fs.existsSync(DEVICES_FILE)) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify({}, null, 2));
  }
}

function loadDevices() {
  return JSON.parse(fs.readFileSync(DEVICES_FILE));
}

function saveDevices(devices) {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
}

function peerUniqueId(peerId) {
  const f = path.join(BASE_DIR, "node0", `nodes.${peerId}.endpoints.0.40.18`);
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return undefined; }
}

function loadWifi() {
  if (!fs.existsSync(WIFI_FILE)) return {};
  return JSON.parse(fs.readFileSync(WIFI_FILE));
}

function saveWifi(ssid, password) {
  const wifi = loadWifi();
  wifi[ssid] = password;
  fs.writeFileSync(WIFI_FILE, JSON.stringify(wifi, null, 2));
}

async function getController({ ble = false } = {}) {
  const { ServerNode, ControllerBehavior, Environment } = await matter();
  if (ble) {
    Environment.default.vars.set("ble.enable", true);
    await import("@matter/nodejs-ble");
  }
  const controller = await ServerNode.create(
    ServerNode.RootEndpoint.with(ControllerBehavior),
    {
      network: { ble: false },
      controller: { adminFabricLabel: "matter-cli", ble },
    },
  );
  await controller.start();
  return controller;
}

function scanPageHtml(defaultName) {
  return `<!DOCTYPE html>
<html>
<head><title>Matter Pair</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;padding:1em;max-width:480px;margin:0 auto}
  label{display:block;margin:.6em 0 .2em;font-weight:500}
  input,select{width:100%;padding:.5em;border:1px solid #ccc;border-radius:4px;font-size:1em}
  button{padding:.6em 1.6em;font-size:1em;border-radius:4px;border:1px solid #999;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .hidden{display:none}
  #v{width:100%;border:1px solid #ccc;border-radius:4px}
  .cam-row{position:relative}
  #flipBtn{position:absolute;bottom:8px;right:8px;padding:.3em .6em;font-size:.9em;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:4px}
  .status{margin-top:.8em;font-weight:500}
  .status.err{color:#c33}
  .status.ok{color:#2a2}
</style>
</head>
<body>
  <h2>Pair Matter Device</h2>

  <div id="step-scan">
    <p id="cam-status">Starting camera...</p>
    <div class="cam-row">
      <video id="v" autoplay playsinline muted></video>
      <button id="flipBtn" class="hidden">Flip</button>
    </div>
    <details style="margin-top:.8em">
      <summary style="cursor:pointer;color:#666">Paste QR string instead</summary>
      <input id="qr-input" type="text" placeholder="MT:..." style="margin-top:.4em">
      <button onclick="useQr(document.getElementById('qr-input').value.trim())" style="margin-top:.4em">Submit</button>
    </details>
  </div>

  <div id="step-confirm" class="hidden">
    <p style="font-size:1.1em">QR code scanned.</p>

    <label for="dev-name">Device name:</label>
    <input id="dev-name" type="text" value="${defaultName || ""}" placeholder="e.g. kitchen-plug" required>

    <label for="wifi-select">Wi-Fi network:</label>
    <select id="wifi-select"><option value="">Loading...</option></select>

    <div id="wifi-custom" class="hidden">
      <label for="ssid">SSID:</label>
      <input id="ssid" type="text">
      <label for="wpass">Password:</label>
      <input id="wpass" type="password">
    </div>

    <div style="margin-top:1em">
      <button id="pairBtn">Pair Now</button>
    </div>
    <p id="status" class="status"></p>
  </div>

  <script src="/jsqr.js"></script>
  <script>
    var v = document.getElementById("v");
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var scanning = true;
    var currentFacing = "environment";
    var hasMultipleCameras = false;
    var qrPayload = "";

    // --- Camera ---
    function startCamera(facing) {
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })
        .then(function(stream) {
          v.srcObject = stream;
          currentFacing = facing;
          v.onloadedmetadata = function() {
            document.getElementById("cam-status").textContent = "Point camera at QR code...";
            requestAnimationFrame(tick);
          };
        })
        .catch(function() {
          if (facing === "environment") {
            startCamera("user");
          } else {
            document.getElementById("cam-status").textContent = "No camera available. Paste QR string below.";
          }
        });
    }

    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var cams = devices.filter(function(d) { return d.kind === "videoinput"; });
      hasMultipleCameras = cams.length > 1;
      if (hasMultipleCameras) document.getElementById("flipBtn").classList.remove("hidden");
    });

    document.getElementById("flipBtn").onclick = function() {
      startCamera(currentFacing === "environment" ? "user" : "environment");
    };

    startCamera("environment");

    function tick() {
      if (!scanning) return;
      if (v.readyState < 2 || !v.videoWidth) { requestAnimationFrame(tick); return; }
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(d.data, d.width, d.height);
      if (code && code.data.slice(0, 3) === "MT:") { useQr(code.data); return; }
      requestAnimationFrame(tick);
    }

    function useQr(qr) {
      if (!scanning || qr.slice(0, 3) !== "MT:") return;
      scanning = false;
      qrPayload = qr;
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
      document.getElementById("step-scan").classList.add("hidden");
      document.getElementById("step-confirm").classList.remove("hidden");
      var nameInput = document.getElementById("dev-name");
      if (!nameInput.value) nameInput.focus();
    }

    // --- Wi-Fi ---
    var savedWifi = {};
    fetch("/wifi").then(function(r) { return r.json(); }).then(function(data) {
      savedWifi = data;
      var sel = document.getElementById("wifi-select");
      sel.innerHTML = "";
      var ssids = Object.keys(data);
      ssids.forEach(function(s) {
        var opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        sel.appendChild(opt);
      });
      var other = document.createElement("option");
      other.value = "__other__"; other.textContent = "Other network...";
      sel.appendChild(other);
      if (ssids.length === 0) {
        sel.value = "__other__";
        document.getElementById("wifi-custom").classList.remove("hidden");
      }
    });

    document.getElementById("wifi-select").addEventListener("change", function() {
      var custom = document.getElementById("wifi-custom");
      if (this.value === "__other__") {
        custom.classList.remove("hidden");
        document.getElementById("ssid").value = "";
        document.getElementById("wpass").value = "";
      } else {
        custom.classList.add("hidden");
      }
    });

    // --- Pair ---
    document.getElementById("pairBtn").onclick = function() {
      var name = document.getElementById("dev-name").value.trim();
      if (!name) { setStatus("Enter a device name", true); return; }

      var ssid, wifiPassword;
      var sel = document.getElementById("wifi-select");
      if (sel.value === "__other__") {
        ssid = document.getElementById("ssid").value;
        wifiPassword = document.getElementById("wpass").value;
      } else {
        ssid = sel.value;
        wifiPassword = savedWifi[ssid] || "";
      }

      document.getElementById("pairBtn").disabled = true;
      setStatus("Commissioning... (may take up to 2 minutes)");
      fetch("/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr: qrPayload, name: name, ssid: ssid, wifiPassword: wifiPassword })
      })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.ok) {
            setStatus("Paired '" + result.name + "' successfully!");
            setTimeout(function() { window.close(); }, 3000);
          } else {
            setStatus("Error: " + result.error, true);
            document.getElementById("pairBtn").disabled = false;
          }
        })
        .catch(function(e) {
          setStatus("Network error: " + e.message, true);
          document.getElementById("pairBtn").disabled = false;
        });
    };

    function setStatus(msg, isError) {
      var el = document.getElementById("status");
      el.textContent = msg;
      el.className = "status " + (isError ? "err" : "ok");
    }

    window.addEventListener("beforeunload", function() {
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
    });
  </script>
</body>
</html>`;
}

/**
 * Opens a browser QR scanner.
 * Returns { passcode, discriminator, notify(err) }.
 * Call notify(null) on success or notify(err) on failure — this sends the
 * final result to the browser and closes the server.
 */
async function scanQrCode(defaultName) {
  const http = await import("http");
  const { default: open } = await import("open");
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const JSQR_JS = fs.readFileSync(require.resolve("jsqr/dist/jsQR.js"));
  const { QrPairingCodeCodec } = await import("@matter/main/types");

  return new Promise((resolve, reject) => {
    let pairRes = null;

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/wifi") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(loadWifi()));
        return;
      }
      if (req.method === "GET" && req.url === "/jsqr.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.end(JSQR_JS);
        return;
      }
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(scanPageHtml(defaultName));
        return;
      }
      if (req.method === "POST" && req.url === "/pair") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { qr, name, ssid, wifiPassword } = JSON.parse(body);
            const [payload] = QrPairingCodeCodec.decode(qr);
            pairRes = res;
            resolve({
              name,
              passcode: payload.passcode,
              discriminator: payload.discriminator,
              ssid, wifiPassword,
              notify: (err) => {
                const json = err
                  ? JSON.stringify({ ok: false, error: err.message })
                  : JSON.stringify({ ok: true, name });
                pairRes.setHeader("Content-Type", "application/json");
                pairRes.end(json);
                server.close();
              },
            });
          } catch (err) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(8787, () => {
      process.stderr.write("Opening browser QR scanner at http://localhost:8787\n");
      open("http://localhost:8787").catch(() => {
        process.stderr.write("Could not open browser — visit http://localhost:8787\n");
      });
    });
  });
}

function usage() {
  console.log(`
Usage:
  wifi <ssid> <password>                                    save Wi-Fi credentials
  wifi                                                     show saved Wi-Fi networks
  pair                                                     scan QR code via browser
  pair <name>                                              scan QR, pre-fill device name
  pair <name> <manual-code>                                11-digit code from label
  pair <name> <passcode> <discriminator>                   explicit (Wi-Fi from wifi.json)
  pair <name> <passcode> <discriminator> <ssid> <passwd>   explicit with Wi-Fi
  on <name>
  off <name>
  list
  rename <old> <new>                                       rename a device
  remove <name>                                            decommission and remove a device
  scan                                                     scan BLE for Matter devices

Examples:
  matter-cli wifi MyNetwork s3cr3t
  matter-cli pair
  matter-cli pair kitchen 0387-951-7925
  matter-cli on kitchen
`);
}

// ---------- Commands ----------

async function pair(name, passcode, discriminator, cliSsid, cliWifiPassword) {
  // Lazy-load pairing-only dependencies
  const { ManualPairingCodeCodec } = await import("@matter/types/schema");

  let notify, ssid, wifiPassword;

  // Detect manual pairing code: single arg that is all digits/dashes (11 digits)
  const isManualCode = passcode !== undefined && discriminator === undefined
    && /^[\d-]+$/.test(passcode) && passcode.replace(/\D/g, "").length === 11;

  if (passcode === undefined) {
    let webName;
    ({ name: webName, passcode, discriminator, notify, ssid, wifiPassword } = await scanQrCode(name));
    name = webName || name;
  } else if (isManualCode) {
    const decoded = ManualPairingCodeCodec.decode(passcode.replace(/\D/g, ""));
    passcode = decoded.passcode;
    discriminator = undefined; // will use shortDiscriminator below
    // Store shortDiscriminator for commission options
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

  // Resolve Wi-Fi credentials for manual/decoded paths
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

  // Default assumption: endpoint 1 (typical for plugs)
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

async function toggle(name, turnOn) {
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

let _deviceTypeNames;
function deviceTypeName(id) {
  if (!_deviceTypeNames) {
    // Readable names from Matter device type IDs
    _deviceTypeNames = {
      0x0100: "on/off light", 0x0101: "dimmable light", 0x010c: "color temp light",
      0x010d: "color light", 0x010a: "on/off plug", 0x010b: "dimmable plug",
      0x0103: "on/off switch", 0x0104: "dimmer switch", 0x0105: "color switch",
      0x000a: "door lock", 0x000b: "lock controller", 0x000f: "button",
      0x0202: "window covering", 0x0301: "thermostat", 0x030a: "thermostat controller",
      0x002b: "fan", 0x0302: "temp sensor", 0x0303: "pump", 0x0304: "pump controller",
      0x0305: "pressure sensor", 0x0306: "flow sensor", 0x0307: "humidity sensor",
      0x0106: "light sensor", 0x0107: "occupancy sensor", 0x0015: "contact sensor",
      0x0076: "smoke/co alarm", 0x0041: "freeze detector", 0x0043: "leak detector",
      0x0042: "water valve", 0x0044: "rain sensor",
      0x002d: "air purifier", 0x002c: "air quality sensor",
      0x0073: "washer", 0x007c: "dryer", 0x0075: "dishwasher",
      0x0070: "refrigerator", 0x0079: "microwave", 0x007b: "oven",
      0x0078: "cooktop", 0x007a: "hood", 0x0074: "robot vacuum",
      0x0072: "room ac", 0x0309: "heat pump", 0x050f: "water heater",
      0x050c: "ev charger", 0x050d: "energy manager", 0x0510: "energy sensor",
      0x0022: "speaker", 0x0028: "video player", 0x0023: "casting player",
    };
  }
  return _deviceTypeNames[id];
}

function deviceType(peerId, endpoint) {
  const f = path.join(BASE_DIR, "node0", `nodes.${peerId}.endpoints.${endpoint}.29.0`);
  try {
    const types = JSON.parse(fs.readFileSync(f, "utf8"));
    const id = types[0]?.deviceType;
    return deviceTypeName(id) || `type 0x${id.toString(16)}`;
  } catch { return "unknown"; }
}

function list() {
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

function rename(oldName, newName) {
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

async function remove(name) {
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

async function bleScan() {
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
    const matter = (ad.serviceData || []).some(({ uuid }) =>
      uuid.toLowerCase() === "fff6"
    );
    console.log(
      `  ${p.address}  ${matter ? "** MATTER **" : "            "}  ` +
      `rssi=${p.rssi}  conn=${p.connectable ? "Y" : "N"}  ${ad.localName || ""}  ${svcData || "(no svc data)"}`
    );
  });

  await noble.startScanningAsync([], true);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await noble.stopScanningAsync();
  console.log(`Found ${seen.size} device(s).`);
}

// ---------- Main ----------

async function main() {
  ensureDirs();

  const argv = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const [cmd, ...args] = argv;

  try {
    switch (cmd) {
      case "pair":
        if (![0, 1, 2, 3, 5].includes(args.length)) return usage();
        await pair(args[0], args[1], args[2], args[3], args[4]);
        break;

      case "wifi":
        if (args.length === 2) {
          saveWifi(args[0], args[1]);
          console.log(`Saved Wi-Fi network: ${args[0]}`);
        } else if (args.length === 0) {
          const saved = loadWifi();
          const ssids = Object.keys(saved);
          if (ssids.length === 0) {
            console.log("No saved Wi-Fi networks.");
          } else {
            console.log("Saved Wi-Fi networks:");
            for (const s of ssids) console.log(`  ${s}`);
          }
        } else {
          return usage();
        }
        break;

      case "on":
        await toggle(args[0], true);
        break;

      case "off":
        await toggle(args[0], false);
        break;

      case "list":
        list();
        break;

      case "rename":
        if (args.length !== 2) return usage();
        rename(args[0], args[1]);
        break;

      case "remove":
        if (args.length !== 1) return usage();
        await remove(args[0]);
        break;

      case "scan":
        await bleScan();
        break;

      default:
        usage();
    }
  } catch (err) {
    console.error("Error:", err.message || err);
    if (err.errors?.length) {
      for (const e of err.errors) console.error("  Cause:", e.message || e);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
