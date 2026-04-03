#!/usr/bin/env node

import { ensureDirs, loadDevices } from "./lib/store.js";
import { getController } from "./lib/controller.js";
import { createService } from "./lib/service.js";
import { subscribeAll } from "./lib/subscriptions.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  ensureDirs();

  const controller = await getController();
  const svc = createService({ port, controller });

  const devices = loadDevices();
  if (Object.keys(devices).length > 0) {
    console.log("Subscribing to devices...");
    await subscribeAll(controller, svc.cache, devices, svc.updateCache);
  }

  await svc.listen();
  console.log(`bit-o-matter service listening on http://localhost:${port}`);

  async function shutdown() {
    console.log("Shutting down...");
    await svc.close();
    await controller.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
