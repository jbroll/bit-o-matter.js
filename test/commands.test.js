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
    const mockController = {
      peers: { get: () => null },
    };
    const { toggle } = await import("../lib/commands.js");
    await assert.rejects(() => toggle(mockController, "missing", true), /Unknown device/);
  });

  it("throws when peer not in controller storage", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const mockController = {
      peers: { get: () => null },
    };
    const { toggle } = await import("../lib/commands.js");
    await assert.rejects(() => toggle(mockController, "plug1", true), /not found in controller/);
  });
});

describe("remove", () => {
  it("throws on unknown device", async () => {
    saveDevices({});
    const { remove } = await import("../lib/commands.js");
    await assert.rejects(() => remove(null, "missing"), /Unknown device/);
  });

  it("decommissions and removes device", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    let decommissioned = false;
    const mockController = {
      peers: {
        get: (id) => id === "peer1" ? {
          decommission: async () => { decommissioned = true; },
          delete: async () => {},
        } : null,
      },
    };
    const lines = captureLog();
    const { remove } = await import("../lib/commands.js");
    await remove(mockController, "plug1");
    assert.ok(decommissioned);
    assert.ok(lines.some(l => l.includes("Removed")));
    const devices = JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json")));
    assert.equal(devices.plug1, undefined);
  });

  it("falls back to delete when decommission fails", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    let deleted = false;
    const mockController = {
      peers: {
        get: (id) => id === "peer1" ? {
          decommission: async () => { throw new Error("unreachable"); },
          delete: async () => { deleted = true; },
        } : null,
      },
    };
    const { remove } = await import("../lib/commands.js");
    await remove(mockController, "plug1");
    assert.ok(deleted);
  });

  it("removes device even when peer not in controller", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const mockController = {
      peers: { get: () => null },
    };
    const { remove } = await import("../lib/commands.js");
    await remove(mockController, "plug1");
    const devices = JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json")));
    assert.equal(devices.plug1, undefined);
  });
});

describe("pair", () => {
  it("throws when name already exists", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const { pair } = await import("../lib/commands.js");
    await assert.rejects(
      () => pair(null, "plug1", "12345678", "3840"),
      /already exists/
    );
  });

  it("throws when name is empty", async () => {
    const { pair } = await import("../lib/commands.js");
    await assert.rejects(
      () => pair(null, undefined, "12345678", "3840"),
      /name is required/
    );
  });

  it("uses single saved wifi network", async () => {
    saveDevices({});
    saveWifi("MyNet", "secret123");
    let capturedOpts;
    const mockController = {
      peers: {
        [Symbol.iterator]: () => [][Symbol.iterator](),
        commission: async (opts) => {
          capturedOpts = opts;
          return { id: "peer99" };
        },
      },
    };
    const { pair } = await import("../lib/commands.js");
    captureLog();
    await pair(mockController, "newplug", "12345678", "3840");
    assert.ok(capturedOpts.wifiNetwork);
    assert.equal(capturedOpts.wifiNetwork.wifiSsid, "MyNet");
    assert.equal(capturedOpts.wifiNetwork.wifiCredentials, "secret123");
  });

  it("throws when multiple wifi networks and none specified", async () => {
    saveDevices({});
    saveWifi("Net1", "pass1");
    saveWifi("Net2", "pass2");
    const { pair } = await import("../lib/commands.js");
    await assert.rejects(
      () => pair(null, "newplug", "12345678", "3840"),
      /Multiple saved Wi-Fi/
    );
  });

  it("uses CLI wifi args over saved networks", async () => {
    saveDevices({});
    saveWifi("SavedNet", "savedpass");
    let capturedOpts;
    const mockController = {
      peers: {
        [Symbol.iterator]: () => [][Symbol.iterator](),
        commission: async (opts) => {
          capturedOpts = opts;
          return { id: "peer99" };
        },
      },
    };
    const { pair } = await import("../lib/commands.js");
    captureLog();
    await pair(mockController, "newplug", "12345678", "3840", "CliNet", "clipass");
    assert.equal(capturedOpts.wifiNetwork.wifiSsid, "CliNet");
    assert.equal(capturedOpts.wifiNetwork.wifiCredentials, "clipass");
  });

  it("cleans up orphaned peers before commissioning", async () => {
    saveDevices({ existing: { id: "peer1", endpoint: 1 } });
    let orphanDeleted = false;
    const mockController = {
      peers: {
        [Symbol.iterator]: () => [{
          id: "orphan_peer",
          delete: async () => { orphanDeleted = true; },
        }][Symbol.iterator](),
        commission: async () => ({ id: "peer99" }),
      },
    };
    const { pair } = await import("../lib/commands.js");
    captureLog();
    await pair(mockController, "newplug", "12345678", "3840");
    assert.ok(orphanDeleted, "should delete peer not in devices.json");
  });

  it("saves device after successful commission", async () => {
    saveDevices({});
    const mockController = {
      peers: {
        [Symbol.iterator]: () => [][Symbol.iterator](),
        commission: async () => ({ id: "peer42" }),
      },
    };
    const { pair } = await import("../lib/commands.js");
    captureLog();
    await pair(mockController, "myplug", "12345678", "3840");
    const devices = JSON.parse(fs.readFileSync(path.join(tmpDir, "devices.json")));
    assert.equal(devices.myplug.id, "peer42");
    assert.equal(devices.myplug.endpoint, 1);
  });
});
