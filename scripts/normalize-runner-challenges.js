#!/usr/bin/env node
/**
 * Re-match challenge titles in data/runners.json (canonical title + restrictions).
 * Usage: node scripts/normalize-runner-challenges.js [--write]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { matchChallengeTitle } = require("./match-challenge-title");

const RUNNERS_PATH = path.join(__dirname, "..", "data", "runners.json");
const write = process.argv.includes("--write");

const data = JSON.parse(fs.readFileSync(RUNNERS_PATH, "utf8"));
let updated = 0;

for (const runner of data.runners || []) {
  for (const entry of runner.games || []) {
    for (const c of entry.challenges || []) {
      const raw = String(c.restrictions || c.title || "").trim();
      if (!raw) continue;
      const { title, restrictions } = matchChallengeTitle(entry.game, entry.role, raw);
      const next = { ...c };
      if (title) next.title = title;
      else delete next.title;
      if (restrictions) next.restrictions = restrictions;
      else delete next.restrictions;
      if (!title && raw) next.restrictions = raw;
      const before = JSON.stringify(c);
      Object.assign(c, next);
      if (JSON.stringify(c) !== before) updated += 1;
    }
  }
}

console.log(`Challenges updated: ${updated}`);
if (write) {
  fs.writeFileSync(RUNNERS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("Wrote data/runners.json");
} else {
  console.log("Dry-run. Re-run with --write to apply.");
}
