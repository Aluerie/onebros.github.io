/**
 * Map sheet "Restrictions" text to a standard challenge title from data/games/<id>.json.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "data", "games");

const gameRulesCache = new Map();

function loadGameRules(gameId) {
  if (gameRulesCache.has(gameId)) return gameRulesCache.get(gameId);
  const file = path.join(GAMES_DIR, `${gameId}.json`);
  if (!fs.existsSync(file)) {
    gameRulesCache.set(gameId, null);
    return null;
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  gameRulesCache.set(gameId, data);
  return data;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .replace(/\bno\s+rolling\b/g, "no roll")
    .replace(/\bno\s+blocking\b/g, "no block")
    .replace(/\bno\s+parrying\b/g, "no parry")
    .replace(/\bno\s+sprinting\b/g, "no sprint")
    .replace(/\+0\s+weapons?\b/g, "+0 weapon")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  const n = normalizeText(value);
  return n ? n.split(" ").filter(Boolean) : [];
}

function tokenOverlap(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

function canonicalTitlesForRole(rules, roleId) {
  const titles = [];
  for (const tier of rules.tiers || []) {
    if (tier.role !== roleId) continue;
    for (const c of tier.challenges || []) {
      if (c.title) titles.push(c.title);
    }
  }
  const noHit = rules.noHit;
  if (noHit) {
    for (const r of noHit.roles || []) {
      if (r.role !== roleId) continue;
      for (const c of r.challenges || []) {
        if (c.title) titles.push(c.title);
      }
    }
  }
  return titles;
}

/**
 * @returns {{ title: string, restrictions: string }}
 *   title — standard challenge name for short UI; empty if none matched
 *   restrictions — full sheet text when it differs from title (for game HoF)
 */
function matchChallengeTitle(gameId, roleId, restrictionsText) {
  const full = String(restrictionsText || "").trim();
  if (!full) return { title: "", restrictions: "" };

  const rules = loadGameRules(gameId);
  if (!rules) return { title: "", restrictions: full };

  const candidates = canonicalTitlesForRole(rules, roleId);
  if (!candidates.length) return { title: "", restrictions: full };

  const normFull = normalizeText(full);

  for (const c of candidates) {
    if (normalizeText(c) === normFull) return { title: c, restrictions: "" };
  }

  let best = "";
  let bestScore = 0;
  for (const c of candidates) {
    const nc = normalizeText(c);
    let score = tokenOverlap(c, full);
    if (nc && normFull.includes(nc)) score = Math.max(score, 0.85);
    if (nc && nc.includes(normFull)) score = Math.max(score, 0.75);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (bestScore >= 0.45 && best) {
    return { title: best, restrictions: full };
  }
  return { title: "", restrictions: full };
}

module.exports = { matchChallengeTitle, normalizeText };
