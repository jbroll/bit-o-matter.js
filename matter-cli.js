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
import http from "http";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const JSQR_JS = fs.readFileSync(require.resolve("jsqr/dist/jsQR.js"));
import open from "open";
import "@matter/nodejs-ble";
import {
  ServerNode,
  Environment,
  Logger,
  LogLevel,
  ControllerBehavior,
  Seconds,
} from "@matter/main";
import { QrPairingCodeCodec } from "@matter/main/types";
import { ManualPairingCodeCodec } from "@matter/types/schema";
import { Invoke } from "@matter/main/protocol";
import { OnOff } from "@matter/main/clusters/on-off";

// ---------- Config ----------

const BASE_DIR = path.resolve(".matter-cli");
const DEVICES_FILE = path.join(BASE_DIR, "devices.json");
const WIFI_FILE = path.join(BASE_DIR, "wifi.json");

// Show commissioning progress
Logger.defaultLogLevel = LogLevel.DEBUG;
Logger.addLogger("console", (level, msg) => process.stderr.write(msg + "\n"));

// Configure storage path and disable process signal trapping before creating nodes
Environment.default.vars.set("path.root", BASE_DIR);
Environment.default.vars.set("runtime.signals", false);
Environment.default.vars.set("runtime.exitcode", false);
Environment.default.vars.set("ble.enable", true);

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

function loadWifi() {
  if (!fs.existsSync(WIFI_FILE)) return {};
  return JSON.parse(fs.readFileSync(WIFI_FILE));
}

function saveWifi(ssid, password) {
  const wifi = loadWifi();
  wifi[ssid] = password;
  fs.writeFileSync(WIFI_FILE, JSON.stringify(wifi, null, 2));
}

async function getController() {
  const controller = await ServerNode.create(
    ServerNode.RootEndpoint.with(ControllerBehavior),
    { controller: { adminFabricLabel: "matter-cli" } },
  );
  await controller.start();
  return controller;
}

const SCAN_PAGE_HTML = `<!DOCTYPE html>
<html>
<head><title>Scan Matter QR</title></head>
<body style="font-family:sans-serif;padding:1em;max-width:500px">
  <h2>Scan Matter QR Code</h2>

  <div id="scanning">
    <p id="s">Starting camera...</p>
    <video id="v" autoplay playsinline muted width="400" style="border:1px solid #ccc"></video>
    <details style="margin-top:1em">
      <summary style="cursor:pointer;color:#666">Paste QR string instead</summary>
      <input id="q" type="text" placeholder="MT:..." style="width:100%;margin-top:.5em;padding:.4em;box-sizing:border-box">
      <button onclick="useQr(document.getElementById('q').value.trim())" style="margin-top:.4em;padding:.4em 1em">Submit</button>
    </details>
  </div>

  <div id="confirm" style="display:none">
    <p style="font-size:1.2em">&#10003; QR code scanned.</p>
    <ol>
      <li>Plug in the device</li>
      <li>Hold its button until the LED blinks rapidly (pairing mode)</li>
      <li>Enter your Wi-Fi credentials below</li>
    </ol>
    <label>Wi-Fi SSID:<br>
      <input id="ssid" type="text" list="ssid-list" style="width:100%;padding:.4em;margin:.3em 0 .8em;box-sizing:border-box">
      <datalist id="ssid-list"></datalist>
    </label>
    <label>Wi-Fi Password:<br>
      <input id="wpass" type="password" style="width:100%;padding:.4em;margin:.3em 0 .8em;box-sizing:border-box">
    </label>
    <button id="pairBtn" style="padding:.6em 1.6em;font-size:1.1em">Pair Now</button>
    <p id="cs"></p>
  </div>

  <script src="/jsqr.js"></script>
  <script>
    var v = document.getElementById("v");
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var scanning = true;

    navigator.mediaDevices.getUserMedia({ video: true })
      .then(function(stream) {
        v.srcObject = stream;
        v.onloadedmetadata = function() {
          document.getElementById("s").textContent = "Point camera at QR code...";
          requestAnimationFrame(tick);
        };
      })
      .catch(function(e) {
        document.getElementById("s").textContent = "Camera error: " + e.name + " — " + e.message;
      });

    function tick() {
      if (!scanning) return;
      if (v.readyState < 2 || !v.videoWidth) { requestAnimationFrame(tick); return; }
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(d.data, d.width, d.height);
      if (code && code.data.slice(0, 3) === "MT:") {
        useQr(code.data);
        return;
      }
      requestAnimationFrame(tick);
    }

    function useQr(qr) {
      if (!scanning || qr.slice(0, 3) !== "MT:") return;
      scanning = false;
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
      document.getElementById("scanning").style.display = "none";
      document.getElementById("confirm").style.display = "block";
      document.getElementById("pairBtn").onclick = function() {
        document.getElementById("pairBtn").disabled = true;
        document.getElementById("cs").textContent = "Commissioning... (may take up to 60s)";
        fetch("/pair", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr: qr, ssid: document.getElementById("ssid").value, wifiPassword: document.getElementById("wpass").value }) })
          .then(function(r) { return r.text(); })
          .then(function(body) {
            try {
              var result = JSON.parse(body);
              document.getElementById("cs").textContent = "Error: " + result.error;
            } catch (_) {
              document.getElementById("cs").textContent = "Paired! You can close this tab.";
              setTimeout(function() { window.close(); }, 2000);
            }
          })
          .catch(function(e) {
            document.getElementById("cs").textContent = "Network error: " + e.message;
          });
      };
    }

    window.addEventListener("beforeunload", function() {
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
    });

    var savedWifi = {};
    fetch("/wifi").then(function(r) { return r.json(); }).then(function(data) {
      savedWifi = data;
      var dl = document.getElementById("ssid-list");
      var ssids = Object.keys(data);
      ssids.forEach(function(s) {
        var opt = document.createElement("option");
        opt.value = s;
        dl.appendChild(opt);
      });
      if (ssids.length === 1) {
        document.getElementById("ssid").value = ssids[0];
        document.getElementById("wpass").value = data[ssids[0]];
      }
    });
    document.getElementById("ssid").addEventListener("input", function() {
      if (savedWifi[this.value] !== undefined) {
        document.getElementById("wpass").value = savedWifi[this.value];
      }
    });
  </script>
</body>
</html>`;

/**
 * Opens a browser QR scanner.
 * Returns { passcode, discriminator, notify(err) }.
 * Call notify(null) on success or notify(err) on failure — this sends the
 * final result to the browser and closes the server.
 */
function scanQrCode() {
  return new Promise((resolve, reject) => {
    let pairRes = null; // held open until commissioning finishes

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
        res.end(SCAN_PAGE_HTML);
        return;
      }
      if (req.method === "POST" && req.url === "/pair") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { qr, ssid, wifiPassword } = JSON.parse(body);
            const [payload] = QrPairingCodeCodec.decode(qr);
            pairRes = res; // hold response open
            resolve({
              passcode: payload.passcode,
              discriminator: payload.discriminator,
              ssid, wifiPassword,
              notify: (err) => {
                pairRes.end(err ? JSON.stringify({ error: err.message }) : "OK");
                server.close();
              },
            });
          } catch (err) {
            res.end(JSON.stringify({ error: err.message }));
            server.close();
            reject(new Error(`Failed to decode QR payload: ${err.message}`));
          }
        });
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(8787, () => {
      console.log("Opening browser QR scanner at http://localhost:8787");
      console.log("Scan the QR code on your device, or Ctrl-C to cancel.");
      open("http://localhost:8787").catch(() => {
        console.log("Could not open browser automatically — visit http://localhost:8787");
      });
    });
  });
}

function usage() {
  console.log(`
Usage:
  pair <name>                                              scan QR code via browser
  pair <name> <manual-code>                                11-digit code from label
  pair <name> <passcode> <discriminator>                   explicit (Wi-Fi from wifi.json)
  pair <name> <passcode> <discriminator> <ssid> <passwd>   explicit with Wi-Fi
  on <name>
  off <name>
  list

Examples:
  node matter-cli.js pair kitchen
  node matter-cli.js pair kitchen 12345678 3840
  node matter-cli.js pair kitchen 12345678 3840 MyWifi s3cr3t
  node matter-cli.js on kitchen
`);
}

// ---------- Commands ----------

async function pair(name, passcode, discriminator, cliSsid, cliWifiPassword) {
  let notify, ssid, wifiPassword;

  // Detect manual pairing code: single arg that is all digits/dashes (11 digits)
  const isManualCode = passcode !== undefined && discriminator === undefined
    && /^[\d-]+$/.test(passcode) && passcode.replace(/\D/g, "").length === 11;

  if (passcode === undefined) {
    ({ passcode, discriminator, notify, ssid, wifiPassword } = await scanQrCode());
  } else if (isManualCode) {
    const decoded = ManualPairingCodeCodec.decode(passcode.replace(/\D/g, ""));
    passcode = decoded.passcode;
    discriminator = undefined; // will use shortDiscriminator below
    console.log(`Manual code decoded: passcode=${passcode} shortDiscriminator=${decoded.shortDiscriminator}`);
    // Store shortDiscriminator for commission options
    passcode = { passcode: decoded.passcode, shortDiscriminator: decoded.shortDiscriminator };
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
        console.log(`Using saved Wi-Fi network: ${ssid}`);
      } else if (keys.length > 1) {
        const arg = isManualCode ? passcode?.passcode ?? passcode : `${passcode} ${discriminator}`;
        console.error(`Multiple saved Wi-Fi networks — specify: pair ${name} ${arg} <ssid> <password>`);
        process.exit(1);
      }
    }
  }

  const controller = await getController();

  console.log("Commissioning device (120s timeout)...");

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
  if (ssid) {
    commissionOptions.wifiNetwork = { wifiSsid: ssid, wifiCredentials: wifiPassword };
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
  devices[name] = {
    id: clientNode.id,
    endpoint: 1,
  };
  saveDevices(devices);

  if (ssid) saveWifi(ssid, wifiPassword);
  if (notify) notify(null);
  console.log(`Paired '${name}' as ${clientNode.id}`);
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

  const command = turnOn ? "on" : "off";
  console.log(`Turning ${command.toUpperCase()} '${name}'...`);

  for await (const _ of peer.interaction.invoke(
    Invoke(
      Invoke.ConcreteCommandRequest({
        endpoint: entry.endpoint,
        cluster: OnOff.Cluster,
        command,
      }),
    ),
  )) { /* drain response chunks */ }

  console.log("Done.");
  await controller.close();
}

function list() {
  const devices = loadDevices();
  const entries = Object.entries(devices);
  if (entries.length === 0) {
    console.log("No devices paired.");
    return;
  }
  console.log("Devices:");
  for (const [name, info] of entries) {
    console.log(`  ${name} -> id=${info.id}, endpoint=${info.endpoint}`);
  }
}

// ---------- Main ----------

async function main() {
  ensureDirs();

  const [cmd, ...args] = process.argv.slice(2);

  try {
    switch (cmd) {
      case "pair":
        if (![1, 2, 3, 5].includes(args.length)) return usage();
        await pair(args[0], args[1], args[2], args[3], args[4]);
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

      default:
        usage();
    }
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exit(1);
  }

  process.exit(0);
}

main();
