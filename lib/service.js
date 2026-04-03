import http from "http";
import { loadDevices, saveDevices, deviceType } from "./store.js";
import { toggle, remove } from "./commands.js";

function thingNotFound() {
  return { status: 404, body: { error: "not_found", message: "Thing not found" } };
}

export function createService({ port = 3000, controller = null } = {}) {
  const startTime = Date.now();
  // State cache: thingId -> { prop: value, ... }
  const cache = new Map();

  const routes = [
    ["GET", "/", () => ({
      status: 200,
      body: {
        name: "bit-o-matter",
        version: "0.1.0",
        things: Object.keys(loadDevices()).length,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      },
    })],

    ["GET", "/things", () => ({
      status: 200,
      body: Object.entries(loadDevices()).map(([name, info]) => ({
        id: name,
        type: deviceType(info.id, info.endpoint),
      })),
    })],

    ["GET", "/things/:id", ({ id }) => {
      const devices = loadDevices();
      const entry = devices[id];
      if (!entry) return thingNotFound();
      return {
        status: 200,
        body: {
          id,
          type: deviceType(entry.id, entry.endpoint),
          properties: cache.get(id) ?? {},
          actions: ["toggle"],
        },
      };
    }],

    ["GET", "/things/:id/properties", ({ id }) => {
      const devices = loadDevices();
      if (!devices[id]) return thingNotFound();
      return { status: 200, body: cache.get(id) ?? {} };
    }],

    ["GET", "/things/:id/properties/:prop", ({ id, prop }) => {
      const devices = loadDevices();
      if (!devices[id]) return thingNotFound();
      const props = cache.get(id);
      if (!props || !(prop in props)) {
        return { status: 404, body: { error: "not_found", message: "Property not found" } };
      }
      return { status: 200, body: { value: props[prop] } };
    }],

    ["PUT", "/things/:id/properties/:prop", ({ id, prop }, body) => {
      const devices = loadDevices();
      if (!devices[id]) return thingNotFound();
      if (!body || !("value" in body)) {
        return { status: 400, body: { error: "invalid_input", message: "Missing 'value' field" } };
      }
      const props = cache.get(id) ?? {};
      props[prop] = body.value;
      cache.set(id, props);
      return { status: 204 };
    }],

    ["PUT", "/things/:id/properties", ({ id }, body) => {
      const devices = loadDevices();
      if (!devices[id]) return thingNotFound();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { status: 400, body: { error: "invalid_input", message: "Expected JSON object" } };
      }
      const props = cache.get(id) ?? {};
      Object.assign(props, body);
      cache.set(id, props);
      return { status: 204 };
    }],

    ["POST", "/things/:id/actions/:action", async ({ id, action }) => {
      const devices = loadDevices();
      const entry = devices[id];
      if (!entry) return thingNotFound();
      if (action !== "toggle") {
        return { status: 404, body: { error: "not_found", message: "Action not found" } };
      }
      if (!controller) {
        return { status: 500, body: { error: "internal", message: "No controller available" } };
      }
      const on = cache.get(id)?.on;
      await toggle(controller, id, !on);
      return { status: 204 };
    }],

    ["POST", "/things", async (_params, body) => {
      if (!body || !body.id || !body.pairingCode) {
        return { status: 400, body: { error: "invalid_input", message: "Missing 'id' and/or 'pairingCode'" } };
      }
      const devices = loadDevices();
      if (devices[body.id]) {
        return { status: 409, body: { error: "conflict", message: `Thing '${body.id}' already exists` } };
      }
      if (!controller) {
        return { status: 500, body: { error: "internal", message: "No controller available" } };
      }
      const { pair } = await import("./commands.js");
      await pair(controller, body.id, body.pairingCode);
      const updated = loadDevices();
      const entry = updated[body.id];
      return {
        status: 201,
        body: {
          id: body.id,
          type: entry ? deviceType(entry.id, entry.endpoint) : "unknown",
        },
      };
    }],

    ["DELETE", "/things/:id", async ({ id }) => {
      const devices = loadDevices();
      if (!devices[id]) return thingNotFound();
      if (!controller) {
        return { status: 500, body: { error: "internal", message: "No controller available" } };
      }
      await remove(controller, id);
      cache.delete(id);
      return { status: 204 };
    }],
  ];

  // Compile route patterns into regexes
  const compiled = routes.map(([method, pattern, handler]) => {
    const paramNames = [];
    const re = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      }) + "$"
    );
    return { method, re, paramNames, handler };
  });

  function match(method, url) {
    const path = url.split("?")[0].replace(/\/+$/, "") || "/";
    for (const route of compiled) {
      if (route.method !== method) continue;
      const m = path.match(route.re);
      if (!m) continue;
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const route = match(req.method, req.url);
    if (!route) {
      json(res, 404, { error: "not_found", message: "Not found" });
      return;
    }
    try {
      const body = await readBody(req);
      const result = await route.handler(route.params, body);
      if (result.status === 204) {
        res.writeHead(204).end();
      } else {
        json(res, result.status, result.body);
      }
    } catch (err) {
      json(res, 500, { error: "internal", message: err.message });
    }
  });

  return {
    server,
    cache,
    listen: (p) => new Promise((resolve) => {
      server.listen(p ?? port, () => resolve(server));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); }
      catch { reject(new SyntaxError("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}
