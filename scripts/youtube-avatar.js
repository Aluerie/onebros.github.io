/**
 * Resolve a YouTube channel avatar URL and save it under assets/runners/.
 * Uses oEmbed + channel page metadata (no API key required).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const YOUTUBE_HOST = /^(?:www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/i;

function isYoutubeUrl(url) {
  try {
    const u = new URL(url);
    return YOUTUBE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** @returns {string} normalized watch/playlist/channel URL for oEmbed */
function normalizeYoutubeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : "";
    }
    if (/youtube\.com/i.test(u.hostname)) {
      if (u.pathname.startsWith("/watch") || u.pathname.startsWith("/playlist")) {
        u.searchParams.delete("si");
        return u.origin + u.pathname + u.search;
      }
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0]?.startsWith("@")) {
        return `${u.origin}/@${parts[0].slice(1)}`;
      }
      if (parts[0] === "channel" && parts[1]) {
        return `${u.origin}/channel/${parts[1]}`;
      }
      if (parts[0] === "c" && parts[1]) {
        return `${u.origin}/c/${parts[1]}`;
      }
    }
  } catch {
    return "";
  }
  return raw;
}

function isChannelUrl(url) {
  try {
    const u = new URL(url);
    return (
      /youtube\.com/i.test(u.hostname) &&
      (u.pathname.startsWith("/@") || u.pathname.startsWith("/channel/") || u.pathname.startsWith("/c/"))
    );
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "OnebrosRunnerSync/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Video or playlist URL → channel page URL via oEmbed */
async function channelUrlFromContentUrl(contentUrl) {
  const normalized = normalizeYoutubeUrl(contentUrl);
  if (!normalized) return "";
  if (isChannelUrl(normalized)) return normalized;

  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`;
  try {
    const data = await fetchJson(oembed);
    if (data.author_url) {
      let author = String(data.author_url).trim();
      if (author.startsWith("/")) author = `https://www.youtube.com${author}`;
      if (isYoutubeUrl(author)) return normalizeYoutubeUrl(author);
    }
  } catch {
    /* fall through */
  }
  return "";
}

/** Channel page HTML → best avatar image URL */
function parseAvatarFromChannelHtml(html) {
  const patterns = [
    /"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[(.*?)\]\s*,/s,
    /"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[(.*?)\]/s,
  ];
  for (const pattern of patterns) {
    const block = html.match(pattern);
    if (!block) continue;
    const urls = [...block[1].matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((m) =>
      m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
    );
    if (urls.length) {
      // Prefer largest width hint (=sNNN in googleusercontent URLs)
      urls.sort((a, b) => {
        const sa = Number((a.match(/=s(\d+)/) || [0, 0])[1]);
        const sb = Number((b.match(/=s(\d+)/) || [0, 0])[1]);
        return sb - sa;
      });
      let best = urls[0];
      if (/=s\d+/.test(best)) best = best.replace(/=s\d+(-[^?]*)?/, "=s176$1");
      return best;
    }
  }
  const og = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (og) return og[1].replace(/\\u0026/g, "&");
  return "";
}

async function avatarUrlForChannel(channelUrl) {
  const page = normalizeYoutubeUrl(channelUrl);
  if (!page || !isChannelUrl(page)) return "";
  const html = await fetchText(page.startsWith("http") ? page : `https://${page}`);
  return parseAvatarFromChannelHtml(html);
}

/** Pick the first URL that yields a channel avatar image */
async function resolveAvatarUrlFromLinks(urls) {
  const seen = new Set();
  for (const url of urls) {
    if (!url || !isYoutubeUrl(url)) continue;
    const key = normalizeYoutubeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);

    let channel = "";
    if (isChannelUrl(url)) channel = normalizeYoutubeUrl(url);
    else channel = await channelUrlFromContentUrl(url);

    if (!channel) continue;
    try {
      const avatar = await avatarUrlForChannel(channel);
      if (avatar) return { avatarUrl: avatar, channelUrl: channel };
    } catch {
      continue;
    }
  }
  return { avatarUrl: "", channelUrl: "" };
}

function extensionFromContentType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("png")) return ".png";
  if (t.includes("webp")) return ".webp";
  if (t.includes("gif")) return ".gif";
  return ".jpg";
}

async function downloadAvatarImage(avatarUrl, destPathWithoutExt) {
  const res = await fetch(avatarUrl, {
    headers: { "User-Agent": "OnebrosRunnerSync/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading avatar`);
  const ext = extensionFromContentType(res.headers.get("content-type"));
  const destPath = destPathWithoutExt + ext;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

/** Collect YouTube URLs from a runner record (profile first, then proofs). */
function youtubeUrlsForRunner(runner) {
  const urls = [];
  if (runner.profile && isYoutubeUrl(runner.profile)) urls.push(runner.profile);
  for (const entry of runner.games || []) {
    for (const c of entry.challenges || []) {
      if (c.proof && isYoutubeUrl(c.proof)) urls.push(c.proof);
    }
  }
  return urls;
}

/**
 * Fill empty avatars (and optional YouTube profile) for runners in place.
 * @returns {{ fetched: string[], skipped: string[], failed: { id: string, reason: string }[] }}
 */
async function fetchAvatarsForRunners(runners, { assetsDir, onlyEmpty = true, force = false } = {}) {
  const fetched = [];
  const skipped = [];
  const failed = [];

  for (const runner of runners) {
    const hasLocalAvatar =
      runner.avatar && String(runner.avatar).startsWith("assets/runners/") && !force;
    if (onlyEmpty && !force && hasLocalAvatar) {
      skipped.push(runner.id);
      continue;
    }
    if (onlyEmpty && !force && runner.avatar && String(runner.avatar).trim()) {
      skipped.push(runner.id);
      continue;
    }

    const urls = youtubeUrlsForRunner(runner);
    if (!urls.length) {
      skipped.push(runner.id);
      continue;
    }

    try {
      const { avatarUrl, channelUrl } = await resolveAvatarUrlFromLinks(urls);
      if (!avatarUrl) {
        failed.push({ id: runner.id, reason: "Could not resolve channel avatar" });
        continue;
      }

      const relBase = path.join("assets", "runners", runner.id).replace(/\\/g, "/");
      const absBase = path.join(assetsDir, runner.id);
      const saved = await downloadAvatarImage(avatarUrl, absBase);
      const relPath = relBase + path.extname(saved);
      runner.avatar = relPath.replace(/\\/g, "/");
      if ((!runner.profile || runner.profile === null) && channelUrl) {
        runner.profile = channelUrl;
      }
      fetched.push(runner.id);
    } catch (err) {
      failed.push({ id: runner.id, reason: err.message || String(err) });
    }
  }

  return { fetched, skipped, failed };
}

module.exports = {
  isYoutubeUrl,
  fetchAvatarsForRunners,
  resolveAvatarUrlFromLinks,
  youtubeUrlsForRunner,
};
