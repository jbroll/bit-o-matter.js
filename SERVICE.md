# Bit-o-Matter Service

A persistent REST server for Matter device control. Unlike the CLI (which creates an ephemeral controller per invocation), the service maintains a long-lived controller with subscription-based state caching.

## Quick Start

```bash
npm start                         # listen on port 3000
PORT=8080 npm start               # custom port
bit-server                        # if installed globally via npm link
```

The service shares storage with the CLI (`~/.matter-cli/`). Devices paired via the CLI are immediately available to the service (restart required to pick up new devices).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  server.js                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ controller.js│  │ service.js   │  │subscriptions│  │
│  │ (persistent  │──│ (HTTP routes,│──│.js (Matter  │  │
│  │  controller) │  │  state cache)│  │ attr subs)  │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
│                          │                           │
│                   ┌──────────────┐                   │
│                   │ properties.js│                   │
│                   │ (prop→Matter │                   │
│                   │  command map)│                   │
│                   └──────────────┘                   │
└──────────────────────────────────────────────────────┘
```

### Modules

| Module | Purpose |
|--------|---------|
| `server.js` | Entry point. Creates controller, wires subscriptions, starts HTTP server, handles shutdown. |
| `lib/service.js` | HTTP routing, request handling, state cache, SSE event streaming. |
| `lib/subscriptions.js` | Subscribes to paired devices via Matter protocol. Maps cluster attributes to friendly property names. |
| `lib/properties.js` | Maps property writes to Matter commands (e.g., `on` → OnOff cluster, `brightness` → LevelControl). |
| `lib/commands.js` | Shared with CLI: `pair`, `toggle`, `remove`. Accepts controller as argument. |
| `lib/store.js` | Shared with CLI: device and WiFi persistence. |

### State Cache

On startup, the service subscribes to all paired devices. Matter attribute changes flow into an in-memory cache:

1. Device reports attribute change via Matter subscription
2. `subscriptions.js` maps the cluster/attribute to a friendly property name
3. Cache is updated via `updateCache()`, which also:
   - Emits a `propertyChange` event on the EventEmitter
   - Pushes an SSE event to all connected `/events` clients

Property reads (`GET /things/:id/properties`) return instantly from this cache.

## API Reference

All responses are JSON. Errors use a uniform shape: `{"error": "code", "message": "description"}`.

### System

#### `GET /`

Service info.

```json
{"name": "bit-o-matter", "version": "0.1.0", "things": 3, "uptime": 3600}
```

### Things

#### `GET /things`

List all paired devices.

```json
[{"id": "plug1", "type": "on/off plug"}, {"id": "lamp1", "type": "dimmable light"}]
```

#### `GET /things/:id`

Get a device with its current properties and available actions.

```json
{
  "id": "plug1",
  "type": "on/off plug",
  "properties": {"on": true},
  "actions": ["toggle"]
}
```

#### `POST /things`

Pair a new device. Commissioning happens synchronously and may take up to 2 minutes.

```bash
curl -X POST localhost:3000/things -d '{"id": "plug4", "pairingCode": "0387-951-7925"}'
```

Returns `201 Created`:

```json
{"id": "plug4", "type": "on/off plug"}
```

| Status | Meaning |
|--------|---------|
| 201 | Paired successfully |
| 400 | Missing `id` or `pairingCode` |
| 409 | Device name already exists |

#### `DELETE /things/:id`

Decommission and remove a device.

```bash
curl -X DELETE localhost:3000/things/plug4
```

Returns `204 No Content`. Falls back to force-delete if the device is unreachable.

### Properties

#### `GET /things/:id/properties`

All cached properties.

```json
{"on": true, "brightness": 75}
```

#### `GET /things/:id/properties/:prop`

Single property value.

```json
{"value": true}
```

#### `PUT /things/:id/properties/:prop`

Set a single property. Sends the corresponding Matter command to the device.

```bash
curl -X PUT localhost:3000/things/lamp1/properties/brightness -d '{"value": 50}'
```

Returns `204 No Content`.

| Status | Meaning |
|--------|---------|
| 204 | Set successfully |
| 400 | Missing `value` field |
| 404 | Unknown thing |
| 409 | Read-only or unknown property |

#### `PUT /things/:id/properties`

Set multiple properties in one request.

```bash
curl -X PUT localhost:3000/things/lamp1/properties -d '{"on": true, "brightness": 80}'
```

Returns `204 No Content`. Fails on first read-only property encountered.

### Actions

#### `POST /things/:id/actions/:action`

Invoke an action. Currently supports `toggle`.

```bash
curl -X POST localhost:3000/things/plug1/actions/toggle
```

Returns `204 No Content`. Toggle reads the current `on` state from cache and sends the opposite command.

### Events (SSE)

#### `GET /events`

Server-Sent Events stream of property changes. Connect with `EventSource` or `curl`:

```bash
curl localhost:3000/events
```

Each event is a JSON object:

```
data: {"thing": "plug1", "property": "on", "value": true}

data: {"thing": "lamp1", "property": "brightness", "value": 80}
```

JavaScript client:

```javascript
const events = new EventSource("http://localhost:3000/events");
events.onmessage = (e) => {
  const { thing, property, value } = JSON.parse(e.data);
  console.log(`${thing}.${property} = ${value}`);
};
```

## Supported Properties

Properties are mapped from Matter cluster attributes:

| Property | Matter Cluster | Attribute | Writable |
|----------|---------------|-----------|----------|
| `on` | OnOff (6) | onOff | Yes |
| `brightness` | LevelControl (8) | currentLevel | Yes (0-100, scaled to 0-254) |
| `hue` | ColorControl (768) | currentHue | Read-only* |
| `saturation` | ColorControl (768) | currentSaturation | Read-only* |
| `colorX` | ColorControl (768) | currentX | Read-only* |
| `colorY` | ColorControl (768) | currentY | Read-only* |
| `colorTemperature` | ColorControl (768) | colorTemperatureMireds | Read-only* |

*ColorControl write support can be added by extending the `WRITERS` map in `lib/properties.js`.

## Adding Property Support

To support a new property:

1. **Reading**: Add the cluster/attribute mapping to `ATTR_MAP` in `lib/subscriptions.js`:

```javascript
[clusterId, new Map([[attributeId, "propertyName"]])]
```

2. **Writing**: Add a handler to `WRITERS` in `lib/properties.js`:

```javascript
async propertyName(value) {
  const { MyCluster } = await import("@matter/main/clusters/my-cluster");
  return {
    cluster: MyCluster.Cluster,
    command: "commandName",
    fields: { /* command fields */ },
  };
}
```

## Shared Storage

The service and CLI share `~/.matter-cli/`:

| Path | Owner | Purpose |
|------|-------|---------|
| `node0/` | matter.js | Fabric credentials, node state, cached attributes |
| `devices.json` | CLI + service | Name → `{id, endpoint}` mapping |
| `wifi.json` | CLI | Saved WiFi credentials for pairing |

The service uses the same `devices.json` as the CLI. Devices paired via either interface are available to both (service restart required for new devices).

## Shutdown

The service handles `SIGINT` and `SIGTERM` gracefully:

1. Closes all SSE connections
2. Stops the HTTP server
3. Closes the Matter controller (persists state to disk)
