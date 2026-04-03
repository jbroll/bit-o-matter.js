# bit-o-matter

A minimal, scriptable Matter device controller for Linux. Pair and control Matter smart home devices from the command line.

Built on [matter.js](https://github.com/matter-js/matter.js). Designed for headless use on a Raspberry Pi or similar.

## Install

```bash
git clone git@github.com:jbroll/bit-o-matter.js.git
cd bit-o-matter.js
npm install
```

Link the `bit` command:

```bash
ln -s $(pwd)/bit-o-matter.js ~/bin/bit
chmod +x bit-o-matter.js
```

### BLE Setup (Linux)

Node needs raw HCI access for Bluetooth commissioning:

```bash
sudo setcap 'cap_net_raw+eip cap_net_admin+eip' $(readlink -f $(which node))
```

## Usage

### Save Wi-Fi credentials

```
bit wifi <ssid> <password>
bit wifi                          # list saved networks
```

Credentials are stored in `~/.matter-cli/wifi.json` and used automatically during pairing.

### Pair a device

```
bit pair                          # scan QR code via browser
bit pair kitchen                  # scan QR, pre-fill device name
bit pair kitchen 0387-951-7925    # 11-digit manual pairing code
bit pair kitchen 12345678 3840    # explicit passcode + discriminator
```

Pairing uses BLE to commission the device onto your Wi-Fi network. The browser-based flow opens a local page with a camera QR scanner.

### Control devices

```
bit on <name>
bit off <name>
```

### Manage devices

```
bit list                          # show paired devices
bit rename <old> <new>
bit remove <name>                 # decommission and remove
```

### Diagnostics

```
bit scan                          # scan BLE for nearby Matter devices
bit pair --verbose                # show matter.js debug logging
```

## Storage

All state is stored in `~/.matter-cli/`:

| File | Contents |
|------|----------|
| `node0/` | Matter fabric and node credentials. Losing this requires re-pairing all devices. |
| `devices.json` | Friendly name to device ID mapping. |
| `wifi.json` | Saved Wi-Fi credentials (mode `0600`). |

## Tests

```bash
npm test
```

Uses Node's built-in test runner (`node:test`). No additional dependencies.

## Service

A persistent REST server that keeps a long-lived Matter controller and subscription-based state cache. Property reads return instantly from cache; writes send Matter commands to devices.

```bash
npm start                         # start on port 3000
PORT=8080 npm start               # custom port
```

Quick test:

```bash
curl localhost:3000/things
curl localhost:3000/things/plug1/properties
curl -X PUT localhost:3000/things/plug1/properties/on -d '{"value":true}'
```

Live updates via Server-Sent Events:

```bash
curl localhost:3000/events
```

See [SERVICE.md](SERVICE.md) for full documentation and [SERVICE-SPEC.md](SERVICE-SPEC.md) for the API specification.

## Requirements

- Node.js >= 20.19
- Linux with BlueZ (for BLE commissioning)
- Bluetooth adapter

## License

ISC
