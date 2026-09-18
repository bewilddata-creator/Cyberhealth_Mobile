// Copies the pure ES modules into Apps Script .gs files (Apps Script has no modules: one shared global scope).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FILES = [
  ["js/schedule.js", "Schedule.gs"],
  ["js/access.js", "Access.gs"],
  ["js/authcore.js", "AuthCore.gs"],
  ["server/prescriptions.js", "Prescriptions.gs"],
  ["server/actions.js", "Actions.gs"],
  ["server/photos.js", "Photos.gs"],
];

export function toGs(source, from) {
  const body = source.split("\n")
    .filter(line => !/^\s*import\s/.test(line))
    .map(line => line.replace(/^export\s+(?=(async\s+)?function\b|const\b|let\b|class\b)/, ""))
    .join("\n");
  return `// GENERATED from ${from} by scripts/sync-gs.mjs. Do not edit here: edit ${from} and run npm run sync-gs.\n${body}`;
}

export function sync(outDir = join(root, "apps-script")) {
  mkdirSync(outDir, { recursive: true });
  for (const [src, out] of FILES) writeFileSync(join(outDir, out), toGs(readFileSync(join(root, src), "utf8"), src));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sync();
  console.log(`Synced ${FILES.length} files into apps-script/`);
}
