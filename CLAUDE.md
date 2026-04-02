# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Matter CLI is a minimal, scriptable Matter device controller. It's a modular Node.js CLI that creates an ephemeral controller per invocation with persistent identity stored on disk at `~/.matter-cli/`.

## Running the CLI

```bash
bit wifi <ssid> <password>              # save Wi-Fi credentials
bit pair                                 # scan QR code via browser
bit pair <name> <manual-code>            # 11-digit code from label
bit pair <name> <passcode> <disc>        # explicit pairing
bit on <name>
bit off <name>
bit list
bit rename <old> <new>
bit remove <name>
bit scan                                 # BLE diagnostic scan
```

There is no build step or linter. Dependencies are installed with `npm install`. Tests run with `npm test` (uses `node:test`). A postinstall script (`postinstall.cjs`) patches matter.js for BLE scan compatibility and WiFi scan tolerance.

## Architecture

### Module layout

- `bit-o-matter.js` — CLI entry point (`bit` command), arg parsing, usage
- `lib/store.js` — Device/WiFi persistence, device type lookup
- `lib/controller.js` — Lazy matter.js loader, controller factory
- `lib/commands.js` — All commands: pair, toggle, list, rename, remove, scan
- `lib/qr-server.js` — Localhost HTTP server for browser QR scanning
- `lib/scan-page.js` — HTML template for web pairing UI

### Storage layout under `~/.matter-cli/`

- `node0/` — Matter.js-managed fabric and node credentials for the controller node. Losing this requires re-pairing all devices.
- `devices.json` — User abstraction mapping friendly names → `{ id, endpoint }` where `id` is the local `ClientNode.id` string (e.g. `"peer6"`).
- `wifi.json` — Saved Wi-Fi credentials (owner-readable only, `0o600`).

### API patterns (matter.js 0.17.x alpha)

The script uses the current node-based API, not the legacy `CommissioningController` API.

- **Lazy loading**: `@matter/main` is only imported when commands need the controller (on/off/pair/remove). List, wifi, rename are instant.
- **BLE isolation**: `network: { ble: false }` prevents the Bleno peripheral interface from registering; `controller: { ble: true }` enables Noble central for BLE commissioning. This avoids the "Outbound connections not supported on peripheral interfaces" error.
- **Storage path**: Set via `Environment.default.vars.set("path.root", BASE_DIR)` before creating any nodes.
- **Controller**: A `ServerNode` with `ControllerBehavior`, created fresh each invocation.
- **Pairing**: `controller.peers.commission({ passcode, discriminator, timeout, wifiNetwork, regulatoryCountryCode })`.
- **Controlling**: `peer.interaction.invoke(Invoke(Invoke.ConcreteCommandRequest({ endpoint, cluster: OnOff.Cluster, command })))`.
- **Shutdown**: `await controller.close()` then `process.exit()`.

### Postinstall patches (`postinstall.cjs`)

Three patches applied to `node_modules` after install:
1. **BLE scan filter** — Broadens noble scanning to all peripherals (not just Matter UUID filtered).
2. **BLE service data length** — Accepts Matter service data of any length, not just 8 bytes.
3. **WiFi scan tolerance** — Downgrades "device didn't see SSID" from error to warning.

Each patch logs a warning if its regex doesn't match (upstream API change).

## Key Constraints

- **Hardcoded endpoint 1**: Works for most smart plugs. Multi-endpoint devices or devices with non-standard endpoints require auto-discovery.
- **BLE capabilities required**: Node binary needs `cap_net_raw+eip,cap_net_admin+eip` for BLE scanning (`sudo setcap 'cap_net_raw+eip cap_net_admin+eip' $(readlink -f $(which node))`).
- **~2s latency for controller commands** on Pi: Dominated by matter.js import time. List/wifi/rename are ~170ms.
- **Orphan cleanup**: `pair` automatically deletes orphaned peers (not in devices.json) before commissioning. `remove` decommissions then force-deletes on failure.
