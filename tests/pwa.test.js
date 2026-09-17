// The service worker's SHELL must list every runtime module (so the app works offline once
// installed), and the manifest + icons must be in place for "Add to Home Screen".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const shell = () => {
  const src = readFileSync("sw.js", "utf8");
  return JSON.parse(src.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
};

test("every file in the service worker SHELL exists", () => {
  for (const f of shell().filter(f => f !== "./")) assert.ok(existsSync(f), `missing ${f}`);
});

test("every app module is in SHELL, and dev/server files are not", () => {
  const files = shell();
  const modules = [...readdirSync("js").filter(f => f.endsWith(".js")).map(f => `js/${f}`), ...readdirSync("js/views").map(f => `js/views/${f}`)];
  for (const m of modules.filter(m => m !== "js/access.js" && m !== "js/authcore.js")) assert.ok(files.includes(m), `${m} is not in SHELL`);
  assert.equal(files.some(f => f.startsWith("dev/") || f.startsWith("server/")), false);
});

test("manifest points at existing icons and opens standalone", () => {
  const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) assert.ok(existsSync(icon.src), icon.src);
  assert.ok(existsSync("icons/icon-180.png"));
  assert.match(readFileSync("index.html", "utf8"), /src="js\/main\.js"/);
});
