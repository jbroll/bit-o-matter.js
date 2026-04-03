import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../lib/service.js";
import { setBaseDir, ensureDirs, saveDevices } from "../lib/store.js";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir, svc;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-test-"));
  setBaseDir(tmpDir);
  ensureDirs();
  svc = createService({ port: 0 });
});

afterEach(async () => {
  await svc.close();
  fs.rmSync(tmpDir, { recursive: true });
});

async function request(server, path, { method = "GET", body } = {}) {
  const addr = server.address();
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, opts);
  if (res.status === 204) return { status: 204, body: null };
  return { status: res.status, body: await res.json() };
}

describe("GET /", () => {
  it("returns service info", async () => {
    const server = await svc.listen();
    const { status, body } = await request(server, "/");
    assert.equal(status, 200);
    assert.equal(body.name, "bit-o-matter");
    assert.equal(body.version, "0.1.0");
    assert.equal(typeof body.things, "number");
    assert.equal(typeof body.uptime, "number");
  });

  it("reports correct thing count", async () => {
    saveDevices({ a: { id: "peer1", endpoint: 1 }, b: { id: "peer2", endpoint: 1 } });
    const server = await svc.listen();
    const { body } = await request(server, "/");
    assert.equal(body.things, 2);
  });
});

describe("GET /things", () => {
  it("returns empty array when no devices", async () => {
    const server = await svc.listen();
    const { status, body } = await request(server, "/things");
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it("returns device list with types", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things");
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "plug1");
    assert.equal(typeof body[0].type, "string");
  });
});

describe("GET /things/:id", () => {
  it("returns thing detail", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things/plug1");
    assert.equal(status, 200);
    assert.equal(body.id, "plug1");
    assert.equal(typeof body.type, "string");
    assert.ok("properties" in body);
    assert.ok(Array.isArray(body.actions));
  });

  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status, body } = await request(server, "/things/nope");
    assert.equal(status, 404);
    assert.equal(body.error, "not_found");
  });
});

describe("GET /things/:id/properties", () => {
  it("returns cached properties", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: true });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things/plug1/properties");
    assert.equal(status, 200);
    assert.deepEqual(body, { on: true });
  });

  it("returns empty object when no cached state", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things/plug1/properties");
    assert.equal(status, 200);
    assert.deepEqual(body, {});
  });

  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope/properties");
    assert.equal(status, 404);
  });
});

describe("GET /things/:id/properties/:prop", () => {
  it("returns single property value", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: true, brightness: 50 });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things/plug1/properties/on");
    assert.equal(status, 200);
    assert.deepEqual(body, { value: true });
  });

  it("returns 404 for unknown property", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: true });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/properties/nope");
    assert.equal(status, 404);
  });

  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope/properties/on");
    assert.equal(status, 404);
  });
});

describe("PUT /things/:id/properties/:prop", () => {
  it("sets a property", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/properties/on", {
      method: "PUT", body: { value: true },
    });
    assert.equal(status, 204);
    // Verify cache was updated
    const { body } = await request(server, "/things/plug1/properties/on");
    assert.deepEqual(body, { value: true });
  });

  it("returns 400 without value field", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/properties/on", {
      method: "PUT", body: { wrong: true },
    });
    assert.equal(status, 400);
  });

  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope/properties/on", {
      method: "PUT", body: { value: true },
    });
    assert.equal(status, 404);
  });
});

describe("PUT /things/:id/properties (batch)", () => {
  it("sets multiple properties", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/properties", {
      method: "PUT", body: { on: true, brightness: 50 },
    });
    assert.equal(status, 204);
    const { body } = await request(server, "/things/plug1/properties");
    assert.deepEqual(body, { on: true, brightness: 50 });
  });

  it("merges with existing properties", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: false });
    const server = await svc.listen();
    await request(server, "/things/plug1/properties", {
      method: "PUT", body: { brightness: 75 },
    });
    const { body } = await request(server, "/things/plug1/properties");
    assert.deepEqual(body, { on: false, brightness: 75 });
  });

  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope/properties", {
      method: "PUT", body: { on: true },
    });
    assert.equal(status, 404);
  });
});

describe("POST /things (pair)", () => {
  it("returns 400 without required fields", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things", { method: "POST", body: {} });
    assert.equal(status, 400);
  });

  it("returns 409 when thing already exists", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status, body } = await request(server, "/things", {
      method: "POST", body: { id: "plug1", pairingCode: "12345678" },
    });
    assert.equal(status, 409);
    assert.equal(body.error, "conflict");
  });

  it("returns 500 when no controller", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things", {
      method: "POST", body: { id: "newplug", pairingCode: "12345678" },
    });
    assert.equal(status, 500);
  });
});

describe("POST /things/:id/actions/:action", () => {
  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope/actions/toggle", { method: "POST" });
    assert.equal(status, 404);
  });

  it("returns 404 for unknown action", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: true });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/actions/explode", { method: "POST" });
    assert.equal(status, 404);
  });

  it("returns 500 when no controller", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    svc.cache.set("plug1", { on: false });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1/actions/toggle", { method: "POST" });
    assert.equal(status, 500);
  });
});

describe("DELETE /things/:id", () => {
  it("returns 404 for unknown thing", async () => {
    const server = await svc.listen();
    const { status } = await request(server, "/things/nope", { method: "DELETE" });
    assert.equal(status, 404);
  });

  it("returns 500 when no controller", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const { status } = await request(server, "/things/plug1", { method: "DELETE" });
    assert.equal(status, 500);
  });
});

describe("GET /events (SSE)", () => {
  it("streams property changes", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const addr = server.address();

    const res = await fetch(`http://127.0.0.1:${addr.port}/events`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Read the initial SSE comment
    let { value } = await reader.read();
    let text = decoder.decode(value);
    assert.ok(text.includes(":"), "should start with SSE comment");

    // Trigger a cache update
    svc.updateCache("plug1", "on", true);

    // Read the event
    ({ value } = await reader.read());
    text = decoder.decode(value);
    assert.ok(text.startsWith("data: "), "should be SSE data line");
    const event = JSON.parse(text.replace("data: ", "").trim());
    assert.equal(event.thing, "plug1");
    assert.equal(event.property, "on");
    assert.equal(event.value, true);

    reader.cancel();
  });

  it("emits propertyChange event", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    await svc.listen();

    const received = [];
    svc.events.on("propertyChange", (e) => received.push(e));

    svc.updateCache("plug1", "on", false);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { thing: "plug1", property: "on", value: false });
  });
});

describe("invalid request bodies", () => {
  it("returns 500 for invalid JSON", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    const server = await svc.listen();
    const addr = server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/things/plug1/properties/on`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    assert.equal(res.status, 500);
  });
});

describe("service with mock controller", () => {
  let ctrlSvc, ctrlTmpDir;

  beforeEach(() => {
    ctrlTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-ctrl-test-"));
    setBaseDir(ctrlTmpDir);
    ensureDirs();
  });

  afterEach(async () => {
    if (ctrlSvc) await ctrlSvc.close();
    fs.rmSync(ctrlTmpDir, { recursive: true });
  });

  it("toggle action invokes command on controller", async () => {
    saveDevices({ plug1: { id: "peer1", endpoint: 1 } });
    let invoked = false;
    const mockController = {
      peers: {
        get: (id) => id === "peer1" ? {
          interaction: {
            invoke() {
              invoked = true;
              return { async *[Symbol.asyncIterator]() {} };
            },
          },
        } : null,
      },
    };
    ctrlSvc = createService({ port: 0, controller: mockController });
    ctrlSvc.cache.set("plug1", { on: true });
    const server = await ctrlSvc.listen();
    const { status } = await request(server, "/things/plug1/actions/toggle", { method: "POST" });
    assert.equal(status, 204);
    assert.ok(invoked);
  });

  it("delete removes device via controller", async () => {
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
    ctrlSvc = createService({ port: 0, controller: mockController });
    const server = await ctrlSvc.listen();
    const { status } = await request(server, "/things/plug1", { method: "DELETE" });
    assert.equal(status, 204);
    assert.ok(decommissioned);
    assert.equal(ctrlSvc.cache.has("plug1"), false);
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const server = await svc.listen();
    const { status, body } = await request(server, "/nope");
    assert.equal(status, 404);
    assert.equal(body.error, "not_found");
  });
});
