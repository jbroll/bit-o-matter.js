import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  setBaseDir, getBaseDir, ensureDirs,
  loadDevices, saveDevices,
  loadWifi, saveWifi,
  peerUniqueId, deviceType,
} from "../lib/store.js";

let tmpDir;
let origBaseDir;

beforeEach(() => {
  origBaseDir = getBaseDir();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "matter-cli-test-"));
  setBaseDir(tmpDir);
});

afterEach(() => {
  setBaseDir(origBaseDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureDirs", () => {
  it("creates base dir and devices.json when missing", () => {
    // tmpDir exists but no files inside
    ensureDirs();
    assert.ok(fs.existsSync(tmpDir));
    assert.ok(fs.existsSync(path.join(tmpDir, "devices.json")));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json"))), {});
  });

  it("is idempotent", () => {
    ensureDirs();
    ensureDirs();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json"))), {});
  });

  it("does not overwrite existing devices.json", () => {
    ensureDirs();
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    ensureDirs();
    assert.deepEqual(loadDevices(), { plug1: { id: "peer1", endpoint: 1 } });
  });
});

describe("loadDevices / saveDevices", () => {
  beforeEach(() => ensureDirs());

  it("round-trips device data", () => {
    const data = { kitchen: { id: "peer3", endpoint: 1 }, bedroom: { id: "peer4", endpoint: 2 } };
    saveDevices(data);
    assert.deepEqual(loadDevices(), data);
  });

  it("throws on corrupted file", () => {
    fs.writeFileSync(path.join(tmpDir, "devices.json"), "not json{{{");
    assert.throws(() => loadDevices(), /corrupted/);
  });

  it("starts empty", () => {
    assert.deepEqual(loadDevices(), {});
  });
});

describe("loadWifi / saveWifi", () => {
  it("returns empty object when file missing", () => {
    assert.deepEqual(loadWifi(), {});
  });

  it("round-trips wifi credentials", () => {
    saveWifi("MyNetwork", "secret123");
    assert.deepEqual(loadWifi(), { MyNetwork: "secret123" });
  });

  it("appends to existing networks", () => {
    saveWifi("Net1", "pass1");
    saveWifi("Net2", "pass2");
    assert.deepEqual(loadWifi(), { Net1: "pass1", Net2: "pass2" });
  });

  it("overwrites existing network password", () => {
    saveWifi("Net1", "old");
    saveWifi("Net1", "new");
    assert.deepEqual(loadWifi(), { Net1: "new" });
  });

  it("writes with restricted permissions", () => {
    saveWifi("test", "pass");
    const stats = fs.statSync(path.join(tmpDir, "wifi.json"));
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe("peerUniqueId", () => {
  it("returns undefined when file missing", () => {
    assert.equal(peerUniqueId("peer99"), undefined);
  });

  it("returns parsed unique ID", () => {
    const dir = path.join(tmpDir, "node0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "nodes.peer6.endpoints.0.40.18"), '"ABC123"');
    assert.equal(peerUniqueId("peer6"), "ABC123");
  });
});

describe("deviceType", () => {
  it("returns 'unknown' when file missing", () => {
    assert.equal(deviceType("peer99", 1), "unknown");
  });

  it("maps known device type", () => {
    const dir = path.join(tmpDir, "node0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "nodes.peer1.endpoints.1.29.0"),
      JSON.stringify([{ deviceType: 0x010a, revision: 2 }])
    );
    assert.equal(deviceType("peer1", 1), "on/off plug");
  });

  it("returns hex fallback for unknown type", () => {
    const dir = path.join(tmpDir, "node0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "nodes.peer1.endpoints.1.29.0"),
      JSON.stringify([{ deviceType: 0xffff, revision: 1 }])
    );
    assert.equal(deviceType("peer1", 1), "type 0xffff");
  });
});
