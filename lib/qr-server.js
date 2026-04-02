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

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/wifi") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(loadWifi()));
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
            resolve({
              name,
              passcode: payload.passcode,
              discriminator: payload.discriminator,
              ssid, wifiPassword,
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

    server.listen(8787, () => {
      process.stderr.write("Opening browser QR scanner at http://localhost:8787\n");
      open("http://localhost:8787").catch(() => {
        process.stderr.write("Could not open browser — visit http://localhost:8787\n");
      });
    });
  });
}
