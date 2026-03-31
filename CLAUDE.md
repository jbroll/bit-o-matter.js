# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Matter CLI is a minimal, scriptable Matter device controller. It's a single Node.js script (`matter-cli.js`) that creates an ephemeral controller per invocation with persistent identity stored on disk.

## Running the CLI

```bash
node matter-cli.js pair <name> <passcode> <discriminator>
node matter-cli.js on <name>
node matter-cli.js off <name>
node matter-cli.js list
```

There is no build step, test suite, or linter configured. Dependencies are installed with `npm install`.

## Architecture

### Storage layout under `.matter-cli/`

- `node0/` — Matter.js-managed fabric and node credentials for the controller node. Losing this requires re-pairing all devices.
- `devices.json` — User abstraction mapping friendly names → `{ id, endpoint }` where `id` is the local `ClientNode.id` string (e.g. `"node1"`).

### API patterns (matter.js 0.16.x)

The script uses the current node-based API, not the legacy `CommissioningController` API.

- **Storage path**: Set via `Environment.default.vars.set("path.root", BASE_DIR)` before creating any nodes. This must happen after imports (environment initializes lazily), and the `VariableService` reactivity propagates the new path before any storage is created.
- **Controller**: A `ServerNode` with `ControllerBehavior` (`ServerNode.RootEndpoint.with(ControllerBehavior)`), created fresh each invocation.
- **Pairing**: `controller.peers.commission({ passcode, discriminator, timeout })` — returns a `CancelablePromise<ClientNode>`. The `ClientNode.id` (e.g. `"node1"`) is stored in `devices.json` as the stable local identifier.
- **Controlling**: `peer.interaction.invoke(Invoke(Invoke.ConcreteCommandRequest({ endpoint, cluster: OnOff.Cluster, command: "on"/"off" })))` — the interaction layer auto-connects if the peer is offline. The result is an async iterable of response chunks.
- **Shutdown**: `await controller.close()` then `process.exit()`.

## Key Constraints

- **Hardcoded endpoint 1**: Works for most smart plugs. Multi-endpoint devices or devices with non-standard endpoints require auto-discovery.
- **mDNS/DNS-SD required**: Devices must be discoverable on the local network.
- **~100–300ms latency per invocation**: Acceptable for scripting/cron; unsuitable for high-frequency control.
- **Storage path is reactive**: Matter.js uses `VariableService.use()` for storage configuration, so setting `path.root` after import but before node creation works correctly.
