import fs from "fs";
import path from "path";
import { homedir } from "os";

let _baseDir = path.join(homedir(), ".matter-cli");

export function setBaseDir(dir) { _baseDir = dir; }
export function getBaseDir() { return _baseDir; }
function devicesFile() { return path.join(_baseDir, "devices.json"); }
function wifiFile() { return path.join(_baseDir, "wifi.json"); }

export function ensureDirs() {
  if (!fs.existsSync(_baseDir)) fs.mkdirSync(_baseDir, { recursive: true });
  if (!fs.existsSync(devicesFile())) {
    fs.writeFileSync(devicesFile(), JSON.stringify({}, null, 2));
  }
}

export function loadDevices() {
  try {
    return JSON.parse(fs.readFileSync(devicesFile()));
  } catch {
    throw new Error(`Failed to read ${devicesFile()} — file may be corrupted`);
  }
}

export function saveDevices(devices) {
  fs.writeFileSync(devicesFile(), JSON.stringify(devices, null, 2));
}

export function peerUniqueId(peerId) {
  const f = path.join(_baseDir, "node0", `nodes.${peerId}.endpoints.0.40.18`);
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return undefined; }
}

export function loadWifi() {
  if (!fs.existsSync(wifiFile())) return {};
  return JSON.parse(fs.readFileSync(wifiFile()));
}

export function saveWifi(ssid, password) {
  const wifi = loadWifi();
  wifi[ssid] = password;
  fs.writeFileSync(wifiFile(), JSON.stringify(wifi, null, 2), { mode: 0o600 });
}

const DEVICE_TYPE_NAMES = {
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

export function deviceType(peerId, endpoint) {
  const f = path.join(_baseDir, "node0", `nodes.${peerId}.endpoints.${endpoint}.29.0`);
  try {
    const types = JSON.parse(fs.readFileSync(f, "utf8"));
    const id = types[0]?.deviceType;
    return DEVICE_TYPE_NAMES[id] || `type 0x${id.toString(16)}`;
  } catch { return "unknown"; }
}
