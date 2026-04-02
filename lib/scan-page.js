function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function scanPageHtml(defaultName) {
  return `<!DOCTYPE html>
<html>
<head><title>Matter Pair</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;padding:1em;max-width:480px;margin:0 auto}
  label{display:block;margin:.6em 0 .2em;font-weight:500}
  input,select{width:100%;padding:.5em;border:1px solid #ccc;border-radius:4px;font-size:1em}
  button{padding:.6em 1.6em;font-size:1em;border-radius:4px;border:1px solid #999;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .hidden{display:none}
  #v{width:100%;border:1px solid #ccc;border-radius:4px}
  .cam-row{position:relative}
  #flipBtn{position:absolute;bottom:8px;right:8px;padding:.3em .6em;font-size:.9em;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:4px}
  .status{margin-top:.8em;font-weight:500}
  .status.err{color:#c33}
  .status.ok{color:#2a2}
</style>
</head>
<body>
  <h2>Pair Matter Device</h2>

  <div id="step-scan">
    <p id="cam-status">Starting camera...</p>
    <div class="cam-row">
      <video id="v" autoplay playsinline muted></video>
      <button id="flipBtn" class="hidden">Flip</button>
    </div>
    <details style="margin-top:.8em">
      <summary style="cursor:pointer;color:#666">Paste QR string instead</summary>
      <input id="qr-input" type="text" placeholder="MT:..." style="margin-top:.4em">
      <button onclick="useQr(document.getElementById('qr-input').value.trim())" style="margin-top:.4em">Submit</button>
    </details>
  </div>

  <div id="step-confirm" class="hidden">
    <p style="font-size:1.1em">QR code scanned.</p>

    <label for="dev-name">Device name:</label>
    <input id="dev-name" type="text" value="${escapeHtml(defaultName)}" placeholder="e.g. kitchen-plug" required>

    <label for="wifi-select">Wi-Fi network:</label>
    <select id="wifi-select"><option value="">Loading...</option></select>

    <div id="wifi-custom" class="hidden">
      <label for="ssid">SSID:</label>
      <input id="ssid" type="text">
      <label for="wpass">Password:</label>
      <input id="wpass" type="password">
    </div>

    <div style="margin-top:1em">
      <button id="pairBtn">Pair Now</button>
    </div>
    <p id="status" class="status"></p>
  </div>

  <script src="/jsqr.js"></script>
  <script>
    var v = document.getElementById("v");
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var scanning = true;
    var currentFacing = "environment";
    var hasMultipleCameras = false;
    var qrPayload = "";

    // --- Camera ---
    function startCamera(facing) {
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })
        .then(function(stream) {
          v.srcObject = stream;
          currentFacing = facing;
          v.onloadedmetadata = function() {
            document.getElementById("cam-status").textContent = "Point camera at QR code...";
            requestAnimationFrame(tick);
          };
        })
        .catch(function() {
          if (facing === "environment") {
            startCamera("user");
          } else {
            document.getElementById("cam-status").textContent = "No camera available. Paste QR string below.";
          }
        });
    }

    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var cams = devices.filter(function(d) { return d.kind === "videoinput"; });
      hasMultipleCameras = cams.length > 1;
      if (hasMultipleCameras) document.getElementById("flipBtn").classList.remove("hidden");
    });

    document.getElementById("flipBtn").onclick = function() {
      startCamera(currentFacing === "environment" ? "user" : "environment");
    };

    startCamera("environment");

    function tick() {
      if (!scanning) return;
      if (v.readyState < 2 || !v.videoWidth) { requestAnimationFrame(tick); return; }
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(d.data, d.width, d.height);
      if (code && code.data.slice(0, 3) === "MT:") { useQr(code.data); return; }
      requestAnimationFrame(tick);
    }

    function useQr(qr) {
      if (!scanning || qr.slice(0, 3) !== "MT:") return;
      scanning = false;
      qrPayload = qr;
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
      document.getElementById("step-scan").classList.add("hidden");
      document.getElementById("step-confirm").classList.remove("hidden");
      var nameInput = document.getElementById("dev-name");
      if (!nameInput.value) nameInput.focus();
    }

    // --- Wi-Fi ---
    fetch("/wifi").then(function(r) { return r.json(); }).then(function(ssids) {
      var sel = document.getElementById("wifi-select");
      sel.innerHTML = "";
      ssids.forEach(function(s) {
        var opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        sel.appendChild(opt);
      });
      var other = document.createElement("option");
      other.value = "__other__"; other.textContent = "Other network...";
      sel.appendChild(other);
      if (ssids.length === 0) {
        sel.value = "__other__";
        document.getElementById("wifi-custom").classList.remove("hidden");
      }
    });

    document.getElementById("wifi-select").addEventListener("change", function() {
      var custom = document.getElementById("wifi-custom");
      if (this.value === "__other__") {
        custom.classList.remove("hidden");
      } else {
        custom.classList.add("hidden");
      }
    });

    // --- Pair ---
    document.getElementById("pairBtn").onclick = function() {
      var name = document.getElementById("dev-name").value.trim();
      if (!name) { setStatus("Enter a device name", true); return; }

      var ssid, wifiPassword;
      var sel = document.getElementById("wifi-select");
      if (sel.value === "__other__") {
        ssid = document.getElementById("ssid").value;
        wifiPassword = document.getElementById("wpass").value;
      } else {
        ssid = sel.value;
        wifiPassword = "";
      }

      document.getElementById("pairBtn").disabled = true;
      setStatus("Commissioning... (may take up to 2 minutes)");
      fetch("/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr: qrPayload, name: name, ssid: ssid, wifiPassword: wifiPassword })
      })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.ok) {
            setStatus("Paired '" + result.name + "' successfully!");
            setTimeout(function() { window.close(); }, 3000);
          } else {
            setStatus("Error: " + result.error, true);
            document.getElementById("pairBtn").disabled = false;
          }
        })
        .catch(function(e) {
          setStatus("Network error: " + e.message, true);
          document.getElementById("pairBtn").disabled = false;
        });
    };

    function setStatus(msg, isError) {
      var el = document.getElementById("status");
      el.textContent = msg;
      el.className = "status " + (isError ? "err" : "ok");
    }

    window.addEventListener("beforeunload", function() {
      if (v.srcObject) v.srcObject.getTracks().forEach(function(t) { t.stop(); });
    });
  </script>
</body>
</html>`;
}
