import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { setBaseDir, getBaseDir, ensureDirs, saveDevices, saveWifi } from "../lib/store.js";

let tmpDir;
let origBaseDir;

beforeEach(() => {
  origBaseDir = getBaseDir();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "matter-cli-cmd-"));
  setBaseDir(tmpDir);
  ensureDirs();
});

afterEach(() => {
  setBaseDir(origBaseDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  mock.restoreAll();
});

// Helper to set up device type file
function setDeviceType(peerId, endpoint, typeId) {
  const dir = path.join(tmpDir, "node0");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `nodes.${peerId}.endpoints.${endpoint}.29.0`),
    JSON.stringify([{ deviceType: typeId, revision: 2 }])
  );
}

// Helper to capture console.log output
function captureLog() {
  const lines = [];
  mock.method(console, "log", (...args) => lines.push(args.join(" ")));
  return lines;
}

describe("list", () => {
  // list is synchronous and only depends on store — no mocking needed
  let list;
  beforeEach(async () => {
    ({ list } = await import("../lib/commands.js"));
  });

  it("shows message when no devices", () => {
    const lines = captureLog();
    list();
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("No devices"));
  });

  it("shows table with devices", () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    setDeviceType("peer1", 1, 0x010a);
    const lines = captureLog();
    list();
    assert.ok(lines[0].includes("Name"));
    assert.ok(lines[0].includes("Type"));
    assert.ok(lines[1].includes("----"));
    assert.ok(lines[2].includes("plug1"));
    assert.ok(lines[2].includes("on/off plug"));
  });

  it("handles unknown device type", () => {
    saveDevices({ widget: { id: "peer2", endpoint: 1 } });
    const lines = captureLog();
    list();
    assert.ok(lines[2].includes("unknown"));
  });
});

describe("rename", () => {
  let rename;
  beforeEach(async () => {
    ({ rename } = await import("../lib/commands.js"));
  });

  it("renames a device", () => {
    saveDevices({ old: { id: "peer1", endpoint: 1 } });
    const lines = captureLog();
    rename("old", "new");
    const devices = JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json")));
    assert.ok(devices["new"]);
    assert.equal(devices["old"], undefined);
    assert.ok(lines[0].includes("Renamed"));
  });

  it("throws on unknown source name", () => {
    saveDevices({});
    assert.throws(() => rename("missing", "new"), /Unknown device/);
  });

  it("throws on duplicate target name", () => {
    saveDevices({
      a: { id: "peer1", endpoint: 1 },
      b: { id: "peer2", endpoint: 1 },
    });
    assert.throws(() => rename("a", "b"), /already exists/);
  });
});

describe("toggle", () => {
  it("throws on unknown device", async () => {
    saveDevices({});
    // Mock the controller module to avoid loading matter.js
    const mockController = {
      peers: { get: () => null },
      close: async () => {},
    };
    // We need to use the real toggle but with a device that doesn't exist
    const { toggle } = await import("../lib/commands.js");
    await assert.rejects(() => toggle("missing", true), /Unknown device/);
  });
});

describe("remove", () => {
  it("throws on unknown device", async () => {
    saveDevices({});
    const { remove } = await import("../lib/commands.js");
    await assert.rejects(() => remove("missing"), /Unknown device/);
  });
});

describe("pair", () => {
  it("throws when name already exists", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const { pair } = await import("../lib/commands.js");
    await assert.rejects(
      () => pair("plug1", "12345678", "3840"),
      /already exists/
    );
  });

  it("throws when name is empty", async () => {
    const { pair } = await import("../lib/commands.js");
    await assert.rejects(
      () => pair(undefined, "12345678", "3840"),
      /name is required/
    );
  });
});
