#!/usr/bin/env node

/**
 * Minimal Matter CLI (no daemon)
 *
 * Intent:
 * - Ephemeral controller: created per invocation, destroyed on exit
 * - Persistent identity: stored on disk (fabric, certs, paired nodes)
 * - Friendly naming layer: maps human names -> nodeId/endpoint
 *
 * This is the lightest viable way to script Matter devices.
 */

import { ensureDirs, saveWifi, loadWifi } from "./lib/store.js";
import { pair, toggle, list, rename, remove, bleScan } from "./lib/commands.js";

function usage() {
  console.log(`
Usage:
  wifi <ssid> <password>                                    save Wi-Fi credentials
  wifi                                                     show saved Wi-Fi networks
  pair                                                     scan QR code via browser
  pair <name>                                              scan QR, pre-fill device name
  pair <name> <manual-code>                                11-digit code from label
  pair <name> <passcode> <discriminator>                   explicit (Wi-Fi from wifi.json)
  pair <name> <passcode> <discriminator> <ssid> <passwd>   explicit with Wi-Fi
  on <name>
  off <name>
  list
  rename <old> <new>                                       rename a device
  remove <name>                                            decommission and remove a device
  scan                                                     scan BLE for Matter devices

Examples:
  matter-cli wifi MyNetwork s3cr3t
  matter-cli pair
  matter-cli pair kitchen 0387-951-7925
  matter-cli on kitchen
`);
}

async function main() {
  ensureDirs();

  const argv = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const [cmd, ...args] = argv;

  try {
    switch (cmd) {
      case "pair":
        if (![0, 1, 2, 3, 5].includes(args.length)) return usage();
        await pair(args[0], args[1], args[2], args[3], args[4]);
        break;

      case "wifi":
        if (args.length === 2) {
          saveWifi(args[0], args[1]);
          console.log(`Saved Wi-Fi network: ${args[0]}`);
        } else if (args.length === 0) {
          const saved = loadWifi();
          const ssids = Object.keys(saved);
          if (ssids.length === 0) {
            console.log("No saved Wi-Fi networks.");
          } else {
            console.log("Saved Wi-Fi networks:");
            for (const s of ssids) console.log(`  ${s}`);
          }
        } else {
          return usage();
        }
        break;

      case "on":
        await toggle(args[0], true);
        break;

      case "off":
        await toggle(args[0], false);
        break;

      case "list":
        list();
        break;

      case "rename":
        if (args.length !== 2) return usage();
        rename(args[0], args[1]);
        break;

      case "remove":
        if (args.length !== 1) return usage();
        await remove(args[0]);
        break;

      case "scan":
        await bleScan();
        break;

      default:
        usage();
    }
  } catch (err) {
    console.error("Error:", err.message || err);
    if (err.errors?.length) {
      for (const e of err.errors) console.error("  Cause:", e.message || e);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
