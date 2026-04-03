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

// Helper: extract the first invoke request from a captured ClientInvoke
function firstInvoke(captured) {
  return captured.invokeRequests[0];
}

// Helper: extract the first command entry's fields from a captured ClientInvoke
function firstCommandFields(captured) {
  for (const [, v] of captured.commands) return v.fields;
}

describe("setProperty", () => {
  it("sends OnOff.on command for on=true", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "on", true);
    const ir = firstInvoke(captured);
    assert.equal(ir.commandPath.clusterId, 6);  // OnOff
    assert.equal(ir.commandPath.commandId, 1);   // on
    assert.equal(ir.commandPath.endpointId, 1);
  });

  it("sends OnOff.off command for on=false", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "on", false);
    const ir = firstInvoke(captured);
    assert.equal(ir.commandPath.clusterId, 6);  // OnOff
    assert.equal(ir.commandPath.commandId, 0);   // off
  });

  it("sends moveToLevel for brightness", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "brightness", 50);
    const ir = firstInvoke(captured);
    assert.equal(ir.commandPath.clusterId, 8);  // LevelControl
    assert.equal(ir.commandPath.commandId, 0);   // moveToLevel
    assert.equal(ir.commandPath.endpointId, 1);
  });

  it("scales brightness from 0-100 to 0-254", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "brightness", 100);
    const fields = firstCommandFields(captured);
    assert.equal(fields.level, 254);  // 100 * 2.54 = 254
  });

  it("rounds brightness to nearest integer", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "brightness", 33);
    const fields = firstCommandFields(captured);
    assert.equal(fields.level, 84);  // 33 * 2.54 = 83.82 → 84
  });

  it("handles brightness=0", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 1 }, "brightness", 0);
    const fields = firstCommandFields(captured);
    assert.equal(fields.level, 0);
    assert.equal(fields.transitionTime, 0);
  });

  it("uses the correct endpoint from entry", async () => {
    let captured;
    const controller = mockController("peer1", (req) => { captured = req; });
    await setProperty(controller, { id: "peer1", endpoint: 3 }, "on", true);
    assert.equal(firstInvoke(captured).commandPath.endpointId, 3);
  });

  it("throws PropertyError for unknown property", async () => {
    const controller = mockController("peer1", () => {});
    await assert.rejects(
      () => setProperty(controller, { id: "peer1", endpoint: 1 }, "temperature", 22),
      (err) => {
        assert.ok(err instanceof PropertyError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.prop, "temperature");
        return true;
      }
    );
  });

  it("throws when peer not found", async () => {
    const controller = mockController("peer1", () => {});
    await assert.rejects(
      () => setProperty(controller, { id: "missing", endpoint: 1 }, "on", true),
      /not found/
    );
  });

  it("propagates invoke errors", async () => {
    const controller = {
      peers: {
        get: () => ({
          interaction: {
            invoke() {
              return {
                async *[Symbol.asyncIterator]() { throw new Error("device offline"); },
              };
            },
          },
        }),
      },
    };
    await assert.rejects(
      () => setProperty(controller, { id: "peer1", endpoint: 1 }, "on", true),
      /device offline/
    );
  });
});
