import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanPageHtml } from "../lib/scan-page.js";

describe("scanPageHtml", () => {
  it("returns valid HTML", () => {
    const html = scanPageHtml("test-device");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });

  it("includes the default name", () => {
    const html = scanPageHtml("kitchen-plug");
    assert.ok(html.includes('value="kitchen-plug"'));
  });

  it("escapes HTML special characters in name", () => {
    const html = scanPageHtml('"><script>alert(1)</script>');
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&quot;&gt;&lt;script&gt;"));
  });

  it("handles undefined name", () => {
    const html = scanPageHtml(undefined);
    assert.ok(html.includes('value=""'));
  });

  it("handles null name", () => {
    const html = scanPageHtml(null);
    assert.ok(html.includes('value=""'));
  });

  it("includes QR scanner elements", () => {
    const html = scanPageHtml("test");
    assert.ok(html.includes("jsqr.js"));
    assert.ok(html.includes("step-scan"));
    assert.ok(html.includes("step-confirm"));
  });

  it("includes wifi dropdown", () => {
    const html = scanPageHtml("test");
    assert.ok(html.includes("wifi-select"));
    assert.ok(html.includes("wifi-custom"));
  });

  it("includes camera flip button", () => {
    const html = scanPageHtml("test");
    assert.ok(html.includes("flipBtn"));
    assert.ok(html.includes("environment"));
  });

  it("does not contain wifi passwords", () => {
    const html = scanPageHtml("test");
    assert.ok(!html.includes("savedWifi["));
    assert.ok(!html.includes("wpass\"].value = data"));
  });
});
