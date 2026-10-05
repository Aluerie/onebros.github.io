"use strict";

const fs = require("fs");
const path = require("path");
const { fetchAvatarsForRunners, youtubeUrlsForRunner } = require("./youtube-avatar");

const ROOT = path.resolve(__dirname, "..");
const RUNNERS_PATH = path.join(ROOT, "data", "runners.json");
const ASSETS_DIR = path.join(ROOT, "assets", "runners");

async function main() {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");

  const data = JSON.parse(fs.readFileSync(RUNNERS_PATH, "utf8"));
  const runners = data.runners || [];

  const candidates = runners.filter((r) => {
    if (force) return youtubeUrlsForRunner(r).length > 0;
    return !r.avatar || !String(r.avatar).trim();
  });

  console.log(`Runners in file: ${runners.length}`);
  console.log(`Candidates:      ${candidates.length}${force ? " (force)" : ""}`);

  if (!candidates.length) {
    console.log("Nothing to fetch.");
    return;
  }

  if (!write) {
    for (const r of candidates) {
      const urls = youtubeUrlsForRunner(r);
      console.log(`  ${r.id}: ${urls[0] || "(no YouTube URL)"}`);
    }
    console.log("\nDry-run. Re-run with --write to download avatars.");
    return;
  }

  const working = JSON.parse(JSON.stringify(runners));
  const { fetched, skipped, failed } = await fetchAvatarsForRunners(working, {
    assetsDir: ASSETS_DIR,
    onlyEmpty: !force,
    force,
  });

  fs.writeFileSync(RUNNERS_PATH, `${JSON.stringify({ runners: working }, null, 2)}\n`, "utf8");

  console.log(`Fetched: ${fetched.join(", ") || "(none)"}`);
  if (skipped.length) console.log(`Skipped: ${skipped.length}`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, RUNNERS_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
