/**
 * Map property writes to Matter commands, and property reads from Matter attributes.
 */

/**
 * Send a Matter command to set a property value on a device.
 * @param {object} controller - matter.js controller
 * @param {object} entry - { id, endpoint } from devices.json
 * @param {string} prop - property name (e.g. "on", "brightness")
 * @param {*} value - the value to set
 */
export async function setProperty(controller, entry, prop, value) {
  const peer = controller.peers.get(entry.id);
  if (!peer) throw new Error("Device not found in controller storage");

  const { Invoke } = await import("@matter/main/protocol");

  const handler = WRITERS[prop];
  if (!handler) throw new PropertyError(prop, "read-only or unknown");

  const { cluster, command, fields } = await handler(value);

  const req = { endpoint: entry.endpoint, cluster, command };
  if (fields) req.fields = fields;

  for await (const _ of peer.interaction.invoke(
    Invoke(Invoke.ConcreteCommandRequest(req)),
  )) { /* drain */ }
}

export class PropertyError extends Error {
  constructor(prop, reason) {
    super(`Cannot set '${prop}': ${reason}`);
    this.prop = prop;
    this.statusCode = 409;
  }
}

const WRITERS = {
  async on(value) {
    const { OnOff } = await import("@matter/main/clusters/on-off");
    return {
      cluster: OnOff.Cluster,
      command: value ? "on" : "off",
    };
  },

  async brightness(value) {
    const { LevelControl } = await import("@matter/main/clusters/level-control");
    return {
      cluster: LevelControl.Cluster,
      command: "moveToLevel",
      fields: { level: Math.round(value * 2.54), transitionTime: 0, optionsMask: 0, optionsOverride: 0 },
    };
  },
};
