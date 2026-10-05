#!/usr/bin/env node
/**
 * Sync Accepted rows from the Checking Tracker CSV into data/runners.json.
 *
 * Usage:
 *   node scripts/sync-runners.js path/to/export.csv          # dry-run (print summary)
 *   node scripts/sync-runners.js path/to/export.csv --write  # update runners.json + YouTube avatars
 *   node scripts/sync-runners.js path/to/export.csv --write --skip-avatars
 *
 * Or backfill avatars anytime:
 *   node scripts/fetch-runner-avatars.js --write
 *
 * Export tip: on Checking Tracker, filter Status = Accepted, then File → Download → CSV.
 *
 * Only Status=Accepted rows are used. Existing runners keep avatar, profile, and
 * display name unless the sheet provides a Hitless profile and profile is empty.
 *
 * Use --replace to rebuild runners.json from the filtered CSV (drops runners /
 * challenges that no longer qualify). Metadata (avatar, profile, name) is kept
 * for matching runner ids.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNNERS_PATH = path.join(ROOT, "data", "runners.json");
const ALIASES_PATH = path.join(__dirname, "runner-aliases.json");
const ASSETS_RUNNERS = path.join(ROOT, "assets", "runners");
const { fetchAvatarsForRunners } = require("./youtube-avatar");
const { matchChallengeTitle } = require("./match-challenge-title");

/* Sheet "Game" text → games.json id */
const GAME_MAP = {
  "demon's souls": "des",
  "demons souls": "des",
  "demon's souls (2020)": "des",
  "demons souls (2020)": "des",
  "demon's souls remake": "des",
  "dark souls": "ds1",
  "dark souls: remastered": "ds1",
  "dark souls remastered": "ds1",
  "dark souls 1": "ds1",
  "dark souls ii": "ds2",
  "dark souls 2": "ds2",
  "dark souls 2: scholar of the first sin": "ds2",
  "dark souls ii: scholar of the first sin": "ds2",
  "scholar of the first sin": "ds2",
  bloodborne: "bb",
  "dark souls iii": "ds3",
  "dark souls 3": "ds3",
  sekiro: "sekiro",
  "sekiro: shadows die twice": "sekiro",
  "elden ring": "er",
};

/* Sheet "Tier" text → role id */
const TIER_MAP = {
  champion: "champion",
  legend: "legend",
  master: "master",
  "elite master": "elitemaster",
  elitemaster: "elitemaster",
  "grand master": "grandmaster",
  grandmaster: "grandmaster",
  "hitless scholar": "hitless-scholar",
  "hitless sage": "hitless-sage",
};

function die(message) {
  console.error(message);
  process.exit(1);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function slugifyId(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseArgs(argv) {
  const args = { csv: "", write: false, skipAvatars: false, replace: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--write") args.write = true;
    else if (arg === "--skip-avatars") args.skipAvatars = true;
    else if (arg === "--replace") args.replace = true;
    else if (arg === "--fetch-avatars") {
      /* legacy no-op: avatars run on every --write unless --skip-avatars */
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.csv) args.csv = arg;
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

/** Minimal CSV parser (handles quotes and commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function headerIndex(headers) {
  const byNorm = new Map(headers.map((h, i) => [normalizeKey(h), i]));
  const find = (...names) => {
    for (const name of names) {
      const i = byNorm.get(normalizeKey(name));
      if (i !== undefined) return i;
    }
    return -1;
  };
  return {
    status: find("Status"),
    checker: find("Checker"),
    runner: find("Runner", "Discord Username"),
    link: find("Link", "Link to Proof"),
    game: find("Game"),
    tier: find("Tier"),
    restrictions: find("Restrictions"),
    checked: find("Checked Date"),
    timestamp: find("Timestamp", "Submission date", "Submission Date"),
    hitlessProfile: find("Team Hitless Profile"),
  };
}

function cell(row, index) {
  if (index < 0 || index >= row.length) return "";
  return String(row[index] || "").trim();
}

/** Parse sheet dates like 10/3/2026 or 9/26/2026 23:34:10 → YYYY-MM-DD */
function toIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw || /^done$/i.test(raw)) return "";
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const month = m[1].padStart(2, "0");
    const day = m[2].padStart(2, "0");
    return `${m[3]}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mapGame(label) {
  return GAME_MAP[normalizeKey(label)] || "";
}

function mapTier(label) {
  return TIER_MAP[normalizeKey(label)] || "";
}

function loadAliases() {
  if (!fs.existsSync(ALIASES_PATH)) return {};
  const data = JSON.parse(fs.readFileSync(ALIASES_PATH, "utf8"));
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    out[normalizeKey(key)] = String(value).trim();
  }
  return out;
}

/** Team Hitless / profile column must be an http(s) URL — ignore form free-text. */
function profileUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return "";
  }
}

/** Canonical site title + optional full sheet text (see match-challenge-title.js). */
function buildChallengeFields(gameId, roleId, restrictionsText) {
  const raw = String(restrictionsText || "").trim();
  if (!raw) return null;
  const { title, restrictions } = matchChallengeTitle(gameId, roleId, raw);
  const fields = {};
  if (title) fields.title = title;
  if (restrictions) fields.restrictions = restrictions;
  if (!title && !restrictions) fields.restrictions = raw;
  return fields;
}

function proofUrlsEqual(a, b) {
  const clean = (u) =>
    String(u || "")
      .trim()
      .replace(/[?&]si=[^&]+/i, "")
      .replace(/\?$/, "")
      .toLowerCase();
  return clean(a) === clean(b);
}

function findChallenge(challenges, proof, fields) {
  return (challenges || []).find((c) => {
    if (proof && c.proof && proofUrlsEqual(c.proof, proof)) return true;
    if (!fields) return false;
    if (fields.title && c.title === fields.title) return true;
    if (fields.restrictions && c.restrictions === fields.restrictions) return true;
    return false;
  });
}

function mergeRun(existingData, acceptedRows, aliases) {
  const runners = JSON.parse(JSON.stringify(existingData.runners || []));
  const byId = new Map(runners.map((r) => [r.id, r]));
  const warnings = [];
  const summary = { addedRunners: 0, updatedRunners: 0, addedChallenges: 0, skipped: 0 };

  for (const row of acceptedRows) {
    const {
      runnerName,
      gameId,
      roleId,
      restrictions: restrictionsText,
      proof,
      completedAt,
      hitlessProfile,
      sheetGame,
      sheetTier,
    } = row;

    if (!runnerName) {
      warnings.push("Skipped row with empty Runner");
      summary.skipped += 1;
      continue;
    }
    if (!gameId) {
      warnings.push(`Unknown game "${sheetGame}" for ${runnerName}`);
      summary.skipped += 1;
      continue;
    }
    if (!roleId) {
      warnings.push(`Unknown tier "${sheetTier}" for ${runnerName}`);
      summary.skipped += 1;
      continue;
    }
    const fields = buildChallengeFields(gameId, roleId, restrictionsText);
    if (!proof && fields) {
      warnings.push(`No proof link for ${runnerName} / ${gameId} / ${roleId}`);
    }

    const aliasId = aliases[normalizeKey(runnerName)];
    const id = aliasId || slugifyId(runnerName);
    if (!id) {
      warnings.push(`Could not derive id for runner "${runnerName}"`);
      summary.skipped += 1;
      continue;
    }

    let runner = byId.get(id);
    let isNew = false;
    if (!runner) {
      isNew = true;
      runner = {
        id,
        name: runnerName,
        avatar: "",
        profile: profileUrl(hitlessProfile) || null,
        addedAt: completedAt || todayIso(),
        games: [],
      };
      runners.push(runner);
      byId.set(id, runner);
      summary.addedRunners += 1;
    } else {
      // Keep staff-edited display name / avatar. Fill empty profile from Hitless link.
      const profile = profileUrl(hitlessProfile);
      if ((!runner.profile || runner.profile === null) && profile) {
        runner.profile = profile;
      }
    }

    let entry = (runner.games || []).find((g) => g.game === gameId && g.role === roleId);
    if (!entry) {
      entry = { game: gameId, role: roleId, challenges: [] };
      runner.games.push(entry);
      if (!isNew) summary.updatedRunners += 1;
    }

    if (!fields) {
      // Champion (or similar) with no restriction text → role-only entry.
      continue;
    }

    const existing = findChallenge(entry.challenges, proof, fields);
    if (existing) {
      if (proof && !existing.proof) existing.proof = proof;
      if (completedAt && !existing.completedAt) existing.completedAt = completedAt;
      if (fields.title && !existing.title) existing.title = fields.title;
      if (fields.restrictions && !existing.restrictions) existing.restrictions = fields.restrictions;
      continue;
    }

    const challenge = { ...fields, proof: proof || "" };
    if (completedAt) challenge.completedAt = completedAt;
    entry.challenges.push(challenge);
    summary.addedChallenges += 1;
    if (!isNew) summary.updatedRunners += 1;
  }

  // Deduplicate updatedRunners count (rough): recount unique non-new updated ids is hard;
  // leave as incremental signal. Sort: keep existing order, append new runners at end.
  return { runners: { runners }, summary, warnings };
}

function rowsFromCsv(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8");
  const table = parseCsv(text);
  if (!table.length) die("CSV is empty");

  const headers = table[0];
  const idx = headerIndex(headers);
  if (idx.status < 0 || idx.runner < 0 || idx.game < 0 || idx.tier < 0) {
    die(
      "CSV is missing required headers. Need at least: Status, Runner, Game, Tier\n" +
        `Found: ${headers.join(", ")}`
    );
  }

  const accepted = [];
  for (const row of table.slice(1)) {
    if (normalizeKey(cell(row, idx.status)) !== "accepted") continue;

    const sheetGame = cell(row, idx.game);
    const sheetTier = cell(row, idx.tier);
    const restrictions = cell(row, idx.restrictions);
    const checked = toIsoDate(cell(row, idx.checked));
    const stamped = toIsoDate(cell(row, idx.timestamp));

    accepted.push({
      runnerName: cell(row, idx.runner),
      gameId: mapGame(sheetGame),
      roleId: mapTier(sheetTier),
      restrictions,
      proof: cell(row, idx.link),
      completedAt: checked || stamped,
      hitlessProfile: profileUrl(cell(row, idx.hitlessProfile)),
      sheetGame,
      sheetTier,
    });
  }
  return accepted;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.csv) {
    console.log(`Sync Accepted Checking Tracker rows into data/runners.json

Usage:
  node scripts/sync-runners.js <export.csv>           dry-run
  node scripts/sync-runners.js <export.csv> --write   write runners.json (YouTube avatars for missing)
  node scripts/sync-runners.js <export.csv> --write --replace
  node scripts/sync-runners.js <export.csv> --write --skip-avatars

  node scripts/fetch-runner-avatars.js --write        YouTube avatars only

CSV columns (Checking Tracker export):
  Status, Checker, Runner, Link, Game, Tier, Restrictions,
  Checked Date, Timestamp, Team Hitless Profile, ...

Only rows with Status=Accepted are imported.
Aliases: scripts/runner-aliases.json
Sample:  scripts/sync-runners.sample.csv`);
    process.exit(args.help ? 0 : 1);
  }

  const csvPath = path.resolve(args.csv);
  if (!fs.existsSync(csvPath)) die(`File not found: ${csvPath}`);

  const existing = JSON.parse(fs.readFileSync(RUNNERS_PATH, "utf8"));
  const aliases = loadAliases();
  const accepted = rowsFromCsv(csvPath);

  if (!accepted.length) {
    console.log("No Accepted rows found in CSV. Nothing to do.");
    return;
  }

  const base = args.replace ? { runners: [] } : existing;
  const { runners, summary, warnings } = mergeRun(base, accepted, aliases);

  if (args.replace) {
    // Preserve avatar / profile / display name / addedAt from the previous file.
    const prevById = new Map((existing.runners || []).map((r) => [r.id, r]));
    for (const runner of runners.runners) {
      const prev = prevById.get(runner.id);
      if (!prev) continue;
      if (prev.avatar) runner.avatar = prev.avatar;
      if (prev.profile) runner.profile = prev.profile;
      if (prev.name) runner.name = prev.name;
      if (prev.addedAt) runner.addedAt = prev.addedAt;
    }
  }

  console.log(`Accepted rows: ${accepted.length}`);
  console.log(`Mode:          ${args.replace ? "replace" : "merge"}`);
  console.log(`New runners:   ${summary.addedRunners}`);
  console.log(`Updated:       ${summary.updatedRunners}`);
  console.log(`New challenges:${summary.addedChallenges}`);
  console.log(`Skipped:       ${summary.skipped}`);
  if (args.replace) {
    console.log(`Runners after replace: ${runners.runners.length} (was ${existing.runners?.length || 0})`);
  }
  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (!args.write) {
    console.log("\nDry-run only. Re-run with --write to update data/runners.json");
    console.log("(A --write run also fetches YouTube channel avatars when avatar is empty.)");
    if (!args.replace) {
      console.log("Tip: use --replace to drop runners/challenges that no longer qualify.");
    }
    return;
  }

  if (!args.skipAvatars) {
    console.log("\nFetching YouTube avatars…");
    const { fetched, failed } = await fetchAvatarsForRunners(runners.runners, {
      assetsDir: ASSETS_RUNNERS,
      onlyEmpty: true,
    });
    console.log(`Avatars fetched: ${fetched.join(", ") || "(none)"}`);
    if (failed.length) {
      console.log("Avatar failures:");
      for (const f of failed) console.log(`  - ${f.id}: ${f.reason}`);
    }
  }

  fs.writeFileSync(RUNNERS_PATH, `${JSON.stringify(runners, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${path.relative(ROOT, RUNNERS_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
