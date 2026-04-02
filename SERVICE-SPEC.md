# Bit-o-Matter Service API Specification

Version: 0.1 (draft)

## 0. Scope

| Aspect | Choice |
|--------|--------|
| Transport | HTTP/1.1 or HTTP/2 |
| Payload | JSON |
| Encoding | UTF-8 |
| Auth | Out of scope (assume local or pre-authenticated) |
| IDs | Opaque strings (`[a-zA-Z0-9._-]+` recommended) |

## 1. Core Concepts

**Thing** — A logical device. Maps to a Matter node/endpoint.

**Property** — Readable (and optionally writable) state. Reads are idempotent. The server maintains an in-memory cache updated by Matter subscriptions, so reads return instantly without polling devices.

**Action** — Command with side effects (non-idempotent). May return output data.

## 2. Common Conventions

### Headers

```
Content-Type: application/json
Accept: application/json
```

### Errors (uniform shape)

```json
{
  "error": "not_found",
  "message": "Thing not found"
}
```

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success with response body |
| 204 | Success, no body (write/action with no output) |
| 400 | Invalid input |
| 404 | Unknown thing, property, or action |
| 409 | Invalid state transition |
| 500 | Internal server error |

## 3. Endpoints

9 endpoints total.

### 3.0 System Info

```
GET /
```

**Response:**

```json
{
  "name": "bit-o-matter",
  "version": "0.1.0",
  "things": 3,
  "uptime": 3600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Service name |
| `version` | string | Service version |
| `things` | integer | Number of paired things |
| `uptime` | integer | Server uptime in seconds |

---

### 3.1 List Things

```
GET /things
```

**Response:**

```json
[
  { "id": "lamp1", "type": "light" },
  { "id": "plug1", "type": "switch" }
]
```

Lightweight discovery — no state dump.

---

### 3.2 Get Thing

```
GET /things/{id}
```

**Response:**

```json
{
  "id": "plug1",
  "type": "on/off plug",

  "properties": {
    "on": true
  },

  "actions": ["toggle"]
}
```

`properties` = current cached snapshot.
`actions` = available capability names.

---

### 3.3 List Properties

```
GET /things/{id}/properties
```

**Response:**

```json
{
  "on": true,
  "brightness": 42
}
```

Returns all properties as a flat object. Values come from the in-memory subscription cache.

---

### 3.4 Get Property

```
GET /things/{id}/properties/{prop}
```

**Response:**

```json
{
  "value": true
}
```

Always wrapped in `{ "value": ... }` for consistency and extensibility.

---

### 3.5 Set Property

```
PUT /things/{id}/properties/{prop}
```

**Request:**

```json
{
  "value": true
}
```

**Response:** `204 No Content`

Rules:
- Must be idempotent
- `400` on invalid type or value
- `404` on unknown property
- `409` on read-only property

---

### 3.6 Set Properties (batch)

```
PUT /things/{id}/properties
```

**Request:**

```json
{
  "on": true,
  "brightness": 50
}
```

**Response:** `204 No Content`

Rules:
- Partial object — only listed properties are set
- Atomic: all succeed or all fail
- Same validation rules as single-property set
- `409` if any property is read-only

---

### 3.7 Invoke Action

```
POST /things/{id}/actions/{action}
```

**Request:**

```json
{
  "input": {}
}
```

(or empty body if no input)

**Response:**

- `204 No Content` — action completed, no output
- `200 OK` with output:

```json
{
  "output": { "result": "success" }
}
```

Rules:
- Always non-idempotent
- `400` on invalid input
- `404` on unknown action

---

### 3.8 Add Thing (pair)

```
POST /things
```

**Request:**

```json
{
  "id": "plug4",
  "pairingCode": "0387-951-7925"
}
```

**Response:**

```json
{
  "id": "plug4",
  "type": "on/off plug"
}
```

`201 Created` on success. Commissioning happens synchronously — this may take up to 2 minutes. The server manages WiFi credentials and BLE commissioning internally.

---

### 3.9 Remove Thing (decommission)

```
DELETE /things/{id}
```

**Response:** `204 No Content`

Decommissions the device from the fabric and removes it. Falls back to force-delete if the device is unreachable.

---

## 4. Naming Rules

| Kind | Convention | Examples |
|------|-----------|----------|
| Properties | nouns | `on`, `brightness`, `temperature` |
| Actions | verbs | `toggle`, `identify`, `reset` |

## 5. Type System

Properties include type metadata in the thing description. Read-only properties are indicated with `"readOnly": true`.

```json
{
  "properties": {
    "on": {
      "type": "boolean",
      "readOnly": false
    },
    "brightness": {
      "type": "integer",
      "min": 0,
      "max": 100,
      "readOnly": false
    },
    "temperature": {
      "type": "number",
      "unit": "celsius",
      "readOnly": true
    }
  }
}
```

Supported types: `boolean`, `integer`, `number`, `string`, `enum`.

This metadata is available via `GET /things/{id}` when requested (e.g., with `?schema=true` query parameter) to keep the default response lightweight.

## 6. Mapping to Matter

| This API | Matter equivalent |
|----------|-------------------|
| Thing | Node / Endpoint |
| Property | Attribute (subscribed) |
| Action | Command |
| Type metadata | Cluster attribute constraints |
| `readOnly` | Attribute access control |

Examples:
- `on` → OnOff cluster, `onOff` attribute
- `brightness` → LevelControl cluster, `currentLevel` attribute
- `toggle` → OnOff cluster, `toggle` command

## 7. State Management

The server maintains a persistent Matter controller (unlike the CLI which creates one per invocation). Device state is managed via matter.js subscriptions:

1. On startup, the server connects to all paired devices and subscribes to attribute changes.
2. Property reads return instantly from the in-memory cache.
3. Property writes are sent to the device; the subscription confirms the change and updates the cache.
4. If a device becomes unreachable, cached values are retained. The thing's reachability can be exposed as a read-only `reachable` property.

## 8. Design Philosophy

- 9 endpoints, fully consistent semantics
- No RPC leakage into URLs
- Maps cleanly to Matter device model
- Cache-first reads (instant), subscription-updated state
- CLI and service share the same storage (`~/.matter-cli/`)
- Easy to wrap with any frontend
