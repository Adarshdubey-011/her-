// End-to-end: boots the real server on a temp data dir, drives Chromium through create PIN -> onboarding -> chat -> lock -> wrong/right PIN -> persistence -> erase.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const { chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright");
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "her-e2e-")), port = 8799;
const srv = spawn("python3", ["server.py", "--no-browser"], { env: { ...process.env, HER_DATA: dir, HER_PORT: String(port), PYTHONPATH: "." }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 40; i++) { try { await fetch(base + "/api/status", { headers: { "X-HER": "1" } }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
const browser = await chromium.launch();
const errors = [], external = [];
let fail = 0;
const step = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, "\n    ", String(e.message).split("\n")[0]); } };
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:")) external.push(r.url()); });
  const cont = async () => { await page.click("#go"); };
  const pin = async (p) => { for (const d of p) await page.click(`.pad button[data-k="${d}"]`); };
  await page.goto(base);
  await step("first run shows create PIN", async () => { await page.waitForSelector("#go"); await cont(); await page.waitForSelector(".pad"); assert.match(await page.textContent("h1.title"), /Create a PIN/); });
  await step("create PIN 1234 with confirm", async () => { await pin("1234"); await page.waitForSelector("text=Confirm your PIN"); await pin("1234"); await page.waitForSelector(".dcf-btn", { timeout: 15000 }); });
  await step("welcome hero + description", async () => { assert.ok(await page.isVisible(".dcf-svg")); assert.ok(await page.isVisible(".about")); });
  await page.screenshot({ path: "/tmp/e2e-welcome.png" });
  await step("onboarding to chat", async () => { await page.click('.dcf-btn[data-action="begin"]'); await page.click("#n"); await page.click('[data-p="love"]'); await page.click("#n"); await page.waitForSelector("#ta"); });
  await step("emergency banner appears before reply", async () => { await page.fill("#ta", "he keeps following me home and threatened to kill me"); await page.keyboard.press("Enter"); await page.waitForSelector(".banner", { timeout: 3000 }); assert.ok(await page.isVisible('.banner a[href="tel:112"]')); });
  await step("demo reply arrives", async () => { await page.waitForSelector(".m.her.serious:not(:has(.typing))", { timeout: 8000 }); });
  await page.screenshot({ path: "/tmp/e2e-chat.png" });
  await step("saved indicator", async () => { await page.waitForFunction(() => /Saved/.test(document.querySelector("#ss")?.textContent || ""), null, { timeout: 8000 }); });
  await step("rights page lists laws", async () => { await page.click('.dock a[data-go="rights"]'); assert.ok((await page.$$(".law")).length >= 7); });
  await step("draft builds", async () => { await page.click('.dock a[data-go="draft"]'); await page.fill("#what", "test"); await page.click("#mk"); assert.match(await page.textContent("pre.out"), /Respectfully/); });
  await step("help lists 112", async () => { await page.click('.dock a[data-go="help"]'); assert.ok(await page.isVisible('a[href="tel:112"]')); });
  await step("lock then wrong PIN", async () => { await page.click("#lk"); await page.waitForSelector("#go"); await cont(); await page.waitForSelector(".pad"); await pin("0000"); await page.waitForSelector("text=Wrong PIN"); });
  await step("right PIN restores chat", async () => { await pin("1234"); await page.waitForSelector(".m.me", { timeout: 15000 }); assert.match(await page.textContent(".log"), /following me/); });
  await step("reload keeps data encrypted at rest", async () => { const raw = (await import("node:fs")).readFileSync(join(dir, "vault.json"), "utf8"); assert.ok(!raw.includes("following")); });
  await step("erase everything", async () => { await page.click('[data-go="settings"]'); await page.click("#er"); await page.click("#go"); await page.waitForSelector("#go", { timeout: 8000 }); await cont(); await page.waitForSelector("text=Create a PIN", { timeout: 8000 }); assert.ok(!existsSync(join(dir, "vault.json"))); });
  await step("no console errors", async () => assert.deepEqual(errors, [], errors.join(" | ")));
  await step("no external requests", async () => assert.deepEqual(external, []));
} finally { await browser.close(); srv.kill(); }
process.exit(fail ? 1 : 0);
