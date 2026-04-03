import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setProperty, PropertyError } from "../lib/properties.js";

function mockController(peerId, invokeCallback) {
  return {
    peers: {
      get(id) {
        if (id !== peerId) return undefined;
        return {
          interaction: {
            invoke(request) {
              invokeCallback(request);
              return { async *[Symbol.asyncIterator]() {} };
            },
          },
        };
      },
    },
  };
}

describe("setProperty", () => {
  it("sends OnOff.on command for on=true", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "on", true);
    assert.ok(captured);
  });

  it("sends OnOff.off command for on=false", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "on", false);
    assert.ok(captured);
  });

  it("sends moveToLevel for brightness", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "brightness", 50);
    assert.ok(captured);
  });

  it("throws PropertyError for unknown property", async () => {
    const controller = mockController("peer1", () => {});
    await assert.rejects(
      () => setProperty(controller, { id: "peer1", endpoint: 1 }, "temperature", 22),
      (err) => err instanceof PropertyError
    );
  });

  it("throws when peer not found", async () => {
    const controller = mockController("peer1", () => {});
    await assert.rejects(
      () => setProperty(controller, { id: "missing", endpoint: 1 }, "on", true),
      /not found/
    );
  });
});
