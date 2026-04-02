import { BASE_DIR } from "./store.js";

let _matter;
export async function matter() {
  if (_matter) return _matter;
  const m = await import("@matter/main");
  const { Invoke } = await import("@matter/main/protocol");
  const { OnOff } = await import("@matter/main/clusters/on-off");

  const verbose = process.argv.includes("--verbose");
  m.Logger.defaultLogLevel = verbose ? m.LogLevel.DEBUG : m.LogLevel.FATAL;
  m.Environment.default.vars.set("path.root", BASE_DIR);
  m.Environment.default.vars.set("runtime.signals", false);
  m.Environment.default.vars.set("runtime.exitcode", false);
  m.Environment.default.vars.set("ble.enable", false);

  _matter = { ...m, Invoke, OnOff };
  return _matter;
}

export async function getController({ ble = false } = {}) {
  const { ServerNode, ControllerBehavior, Environment } = await matter();
  if (ble) {
    Environment.default.vars.set("ble.enable", true);
    await import("@matter/nodejs-ble");
  }
  const controller = await ServerNode.create(
    ServerNode.RootEndpoint.with(ControllerBehavior),
    {
      network: { ble: false },
      controller: { adminFabricLabel: "matter-cli", ble },
    },
  );
  await controller.start();
  return controller;
}
