import http from "http";
import { EventEmitter } from "events";
import { loadDevices, saveDevices, deviceType } from "./store.js";
import { toggle, remove } from "./commands.js";
import { setProperty, PropertyError } from "./properties.js";

function thingNotFound() {
  return { status: 404, body: { error: "not_found", message: "Thing not found" } };
}

export function createService({ port = 3000, controller = null } = {}) {
  const startTime = Date.now();
  // State cache: thingId -> { prop: value, ... }
  const cache = new Map();
  const events = new EventEmitter();
  const sseClients = new Set();

  // Centralized cache update — always emits events
  function updateCache(thingId, prop, value) {
    const props = cache.get(thingId) ?? {};
    props[prop] = value;
    cache.set(thingId, props);
    const event = { thing: thingId, property: prop, value };
    events.emit("propertyChange", event);
    for (const res of sseClients) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

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

    ["PUT", "/things/:id/properties/:prop", async ({ id, prop }, body) => {
      const devices = loadDevices();
      const entry = devices[id];
      if (!entry) return thingNotFound();
      if (!body || !("value" in body)) {
        return { status: 400, body: { error: "invalid_input", message: "Missing 'value' field" } };
      }
      if (controller) {
        try {
          await setProperty(controller, entry, prop, body.value);
        } catch (err) {
          if (err instanceof PropertyError) {
            return { status: err.statusCode, body: { error: "invalid_state", message: err.message } };
          }
          throw err;
        }
      }
      updateCache(id, prop, body.value);
      return { status: 204 };
    }],

    ["PUT", "/things/:id/properties", async ({ id }, body) => {
      const devices = loadDevices();
      const entry = devices[id];
      if (!entry) return thingNotFound();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { status: 400, body: { error: "invalid_input", message: "Expected JSON object" } };
      }
      if (controller) {
        for (const [prop, value] of Object.entries(body)) {
          try {
            await setProperty(controller, entry, prop, value);
          } catch (err) {
            if (err instanceof PropertyError) {
              return { status: err.statusCode, body: { error: "invalid_state", message: err.message } };
            }
            throw err;
          }
        }
      }
      for (const [prop, value] of Object.entries(body)) {
        updateCache(id, prop, value);
      }
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
    // SSE endpoint — long-lived connection
    const path = req.url.split("?")[0].replace(/\/+$/, "") || "/";
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(":\n\n"); // SSE comment as keepalive
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

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
    events,
    updateCache,
    listen: (p) => new Promise((resolve) => {
      server.listen(p ?? port, () => resolve(server));
    }),
    close: () => new Promise((resolve) => {
      for (const res of sseClients) res.end();
      sseClients.clear();
      server.close(resolve);
    }),
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
