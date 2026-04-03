/**
 * Subscribe to paired devices and populate a state cache.
 *
 * Uses matter.js sustained subscriptions that auto-reconnect.
 * Attribute reports are mapped to friendly property names.
 */

// Cluster ID → { attributeId → propertyName }
const ATTR_MAP = new Map([
  [6,  new Map([[0, "on"]])],                    // OnOff: onOff
  [8,  new Map([[0, "brightness"]])],             // LevelControl: currentLevel
  [768, new Map([                                 // ColorControl
    [0, "hue"], [1, "saturation"],
    [3, "colorX"], [4, "colorY"],
    [7, "colorTemperature"],
  ])],
]);

/**
 * Subscribe to all peers and populate the cache.
 * @param {object} controller - matter.js ServerNode with ControllerBehavior
 * @param {Map} cache - thingId → { prop: value }
 * @param {object} devices - name → { id, endpoint } from devices.json
 * @param {function} [onUpdate] - optional callback(thingId, prop, value) for each attribute change
 */
export async function subscribeAll(controller, cache, devices, onUpdate) {
  const { Subscribe, Read } = await import("@matter/main/protocol");

  const nameById = new Map();
  for (const [name, info] of Object.entries(devices)) {
    nameById.set(info.id, { name, endpoint: info.endpoint });
  }

  for (const peer of controller.peers) {
    const mapping = nameById.get(peer.id);
    if (!mapping) continue;

    const { name, endpoint } = mapping;
    if (!cache.has(name)) cache.set(name, {});

    function handleData(data) {
      return (async () => {
        for await (const chunk of data) {
          for (const report of chunk) {
            applyReport(cache, name, report, onUpdate);
          }
        }
      })();
    }

    try {
      const sub = await peer.interaction.subscribe(
        Subscribe(
          {
            keepSubscriptions: true,
            sustain: true,
            update: handleData,
          },
          Read.Attribute({ endpoint }),
        ),
      );

      // Process initial data report from subscription
      await handleData(sub);

      console.log(`Subscribed to '${name}' (${peer.id})`);
    } catch (err) {
      console.error(`Failed to subscribe to '${name}' (${peer.id}):`, err.message);
    }
  }
}

function applyReport(cache, name, report, onUpdate) {
  if (report.kind !== "attr-value") return;
  const clusterMap = ATTR_MAP.get(report.path.clusterId);
  if (!clusterMap) return;
  const propName = clusterMap.get(report.path.attributeId);
  if (!propName) return;

  if (onUpdate) {
    onUpdate(name, propName, report.value);
  } else {
    const props = cache.get(name) ?? {};
    props[propName] = report.value;
    cache.set(name, props);
  }
}
