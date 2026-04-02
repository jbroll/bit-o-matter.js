import fs from "fs";
import { loadWifi } from "./store.js";
import { scanPageHtml } from "./scan-page.js";

export async function scanQrCode(defaultName) {
  const http = await import("http");
  const { default: open } = await import("open");
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const JSQR_JS = fs.readFileSync(require.resolve("jsqr/dist/jsQR.js"));
  const { QrPairingCodeCodec } = await import("@matter/main/types");

  return new Promise((resolve, reject) => {
    let pairRes = null;
    let settled = false;

    function cleanup() {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("QR scan cancelled"));
      }
    }

    process.once("SIGINT", cleanup);

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/wifi") {
        // Only return SSID names, never passwords
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(Object.keys(loadWifi())));
        return;
      }
      if (req.method === "GET" && req.url === "/jsqr.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.end(JSQR_JS);
        return;
      }
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(scanPageHtml(defaultName));
        return;
      }
      if (req.method === "POST" && req.url === "/pair") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { qr, name, ssid, wifiPassword } = JSON.parse(body);
            const [payload] = QrPairingCodeCodec.decode(qr);
            pairRes = res;

            // Look up password server-side for saved networks
            const savedWifi = loadWifi();
            const resolvedPassword = savedWifi[ssid] !== undefined
              ? savedWifi[ssid]
              : wifiPassword;

            settled = true;
            process.removeListener("SIGINT", cleanup);
            resolve({
              name,
              passcode: payload.passcode,
              discriminator: payload.discriminator,
              ssid, wifiPassword: resolvedPassword,
              notify: (err) => {
                const json = err
                  ? JSON.stringify({ ok: false, error: err.message })
                  : JSON.stringify({ ok: true, name });
                pairRes.setHeader("Content-Type", "application/json");
                pairRes.end(json);
                server.close();
              },
            });
          } catch (err) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(8787, "127.0.0.1", () => {
      process.stderr.write("Opening browser QR scanner at http://localhost:8787\n");
      open("http://localhost:8787").catch(() => {
        process.stderr.write("Could not open browser — visit http://localhost:8787\n");
      });
    });

    server.on("error", (err) => {
      process.removeListener("SIGINT", cleanup);
      if (err.code === "EADDRINUSE") {
        reject(new Error("Port 8787 is already in use"));
      } else {
        reject(err);
      }
    });
  });
}
