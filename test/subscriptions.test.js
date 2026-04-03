import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { subscribeAll } from "../lib/subscriptions.js";

function mockController(peers) {
  return {
    peers: {
      [Symbol.iterator]() { return peers[Symbol.iterator](); },
    },
  };
}

function mockPeer(id, reports) {
  return {
    id,
    interaction: {
      async subscribe(request) {
        // Store the update callback so we can simulate future updates
        const updateFn = request.updated;
        // Return an async iterable with initial data
        return {
          async *[Symbol.asyncIterator]() {
            yield reports;
          },
          _triggerUpdate: updateFn,
        };
      },
    },
  };
}

describe("subscribeAll", () => {
  it("populates cache from initial attribute reports", async () => {
    const cache = new Map();
    const devices = { plug1: { id: "peer1", endpoint: 1 } };

    const reports = [
      { kind: "attr-value", path: { clusterId: 6, attributeId: 0 }, value: true },
    ];

    const controller = mockController([mockPeer("peer1", reports)]);
    await subscribeAll(controller, cache, devices);

    assert.deepEqual(cache.get("plug1"), { on: true });
  });

  it("maps multiple cluster attributes", async () => {
    const cache = new Map();
    const devices = { light1: { id: "peer2", endpoint: 1 } };

    const reports = [
      { kind: "attr-value", path: { clusterId: 6, attributeId: 0 }, value: true },
      { kind: "attr-value", path: { clusterId: 8, attributeId: 0 }, value: 128 },
      { kind: "attr-value", path: { clusterId: 768, attributeId: 7 }, value: 350 },
    ];

    const controller = mockController([mockPeer("peer2", reports)]);
    await subscribeAll(controller, cache, devices);

    assert.deepEqual(cache.get("light1"), {
      on: true,
      brightness: 128,
      colorTemperature: 350,
    });
  });

  it("ignores unknown clusters and attributes", async () => {
    const cache = new Map();
    const devices = { plug1: { id: "peer1", endpoint: 1 } };

    const reports = [
      { kind: "attr-value", path: { clusterId: 6, attributeId: 0 }, value: false },
      { kind: "attr-value", path: { clusterId: 999, attributeId: 0 }, value: "ignored" },
      { kind: "attr-value", path: { clusterId: 6, attributeId: 99 }, value: "ignored" },
      { kind: "attr-status", path: { clusterId: 6, attributeId: 0 }, status: 0 },
    ];

    const controller = mockController([mockPeer("peer1", reports)]);
    await subscribeAll(controller, cache, devices);

    assert.deepEqual(cache.get("plug1"), { on: false });
  });

  it("skips peers not in devices", async () => {
    const cache = new Map();
    const devices = { plug1: { id: "peer1", endpoint: 1 } };

    const reports = [
      { kind: "attr-value", path: { clusterId: 6, attributeId: 0 }, value: true },
    ];

    const controller = mockController([
      mockPeer("peer1", reports),
      mockPeer("orphan", reports),
    ]);
    await subscribeAll(controller, cache, devices);

    assert.equal(cache.has("plug1"), true);
    assert.equal(cache.size, 1);
  });

  it("handles subscription failure gracefully", async () => {
    const cache = new Map();
    const devices = { broken: { id: "peer1", endpoint: 1 } };

    const failPeer = {
      id: "peer1",
      interaction: {
        async subscribe() { throw new Error("Connection timeout"); },
      },
    };

    const controller = mockController([failPeer]);
    // Should not throw
    await subscribeAll(controller, cache, devices);
    assert.deepEqual(cache.get("broken"), {});
  });
});
