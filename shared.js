/* OneBros - shared helpers and components
 * Used by both the homepage (script.js) and game pages (game.js).
 * Exposes a single global: window.OneBros
 */
(function () {
  "use strict";

  const PATHS = {
    games: "data/games.json",
    runners: "data/runners.json",
    generalRules: "data/rules.json",
    gameRules: (id) => `data/games/${encodeURIComponent(id)}.json`,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Only allow http(s) links coming from the data files.
  function safeUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-");
  }

  /* ---------- Rule text rendering ---------- */

  // Rule text: escaped, with **double asterisks** rendered as bold (the only markup supported).
  function inlineHtml(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // Rule text with the ** markers removed (for places that are already emphasised, e.g. headings).
  function plainText(text) {
    return String(text ?? "").replace(/\*\*(.+?)\*\*/g, "$1");
  }

  // List items are either a string or { text, items: [...] } for nested lists.
  function listHtml(items, cls = "rule-items") {
    if (!items || !items.length) return "";
    return `<ul class="${cls}">${items
      .map((item) =>
        typeof item === "string"
          ? `<li>${inlineHtml(item)}</li>`
          : `<li>${inlineHtml(item.text)}${listHtml(item.items)}</li>`
      )
      .join("")}</ul>`;
  }

  /* Content blocks:
   *   "text"                     paragraph
   *   { list: [...] }            bullet list
   *   { note, text }             callout
   *   { label, text, url }       external link, e.g. a proof example (opens in a new tab)
   */
  function contentHtml(blocks) {
    return (blocks || [])
      .map((block) => {
        if (typeof block === "string") return `<p>${inlineHtml(block)}</p>`;
        if (block.list) return listHtml(block.list);
        if (block.note) {
          return `<p class="rule-note"><strong>${escapeHtml(block.note)}</strong> ${inlineHtml(block.text)}</p>`;
        }
        if (block.url) {
          const url = safeUrl(block.url);
          const text = escapeHtml(block.text || block.url);
          return `<p class="rule-link">${block.label ? `<strong>${escapeHtml(block.label)}</strong> ` : ""}${
            url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text} ↗</a>` : text
          }</p>`;
        }
        return "";
      })
      .join("");
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- Catalog (games + roles + runners) ---------- */

  // Roles come in two separate tracks:
  //   "onebros" — Champion, Legend, Master, Elite Master, Grand Master (OneBros rules)
  //   "nohit"   — Hitless Scholar, Hitless Sage (Team Hitless ruleset)
  // Ranks only compare roles within the same track.
  function createCatalog(gameData, runnerData) {
    const tracks = gameData.tracks || [];
    const trackOrder = new Map(tracks.map((t, i) => [t.id, i]));
    const roles = [...(gameData.roles || [])].sort(
      (a, b) => (trackOrder.get(a.track) ?? 99) - (trackOrder.get(b.track) ?? 99) || a.rank - b.rank
    );
    const games = gameData.games || [];
    const runners = runnerData.runners || [];
    const gamesById = new Map(games.map((g) => [g.id, g]));
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const runnerIndex = new Map(runners.map((r, i) => [r, i])); // position in runners.json

    const catalog = {
      tracks,
      roles,
      games,
      runners,
      submitRunUrl: safeUrl(gameData.submitRunUrl), // Run Submissions Form, shared by every game
      discordUrl: safeUrl(gameData.discordUrl), // Community Discord invite; its buttons stay hidden without one
      game: (id) => gamesById.get(id),
      role: (id) => rolesById.get(id),
      track: (id) => tracksById.get(id),
      rolesInTrack: (trackId) => roles.filter((r) => r.track === trackId),

      // Game-specific role name (e.g. "Old One"), falling back to the default (e.g. "Master").
      roleName(gameId, roleId) {
        const game = gamesById.get(gameId);
        const custom = game && game.roleNames && game.roleNames[roleId];
        if (custom) return custom;
        const role = rolesById.get(roleId);
        return role ? role.name : roleId;
      },

      // Sort key: every OneBros role above every No Hit role, higher rank first within a track.
      roleSortKey(roleId) {
        const role = rolesById.get(roleId);
        if (!role) return 0;
        return (tracks.length - (trackOrder.get(role.track) ?? tracks.length)) * 100 + role.rank;
      },

      gamePageUrl(gameId) {
        const game = gamesById.get(gameId);
        return game && game.page ? `game.html?game=${encodeURIComponent(game.id)}` : "";
      },

      // Every { runner, entry } pair, where entry = one role a runner holds in one game.
      entries() {
        return runners.flatMap((runner) => (runner.games || []).map((entry) => ({ runner, entry })));
      },

      /* Default display order: newest added to the site first.
       *   1. addedAt, descending (ISO date or datetime strings compare correctly as text)
       *   2. same or missing addedAt: later position in runners.json first (entries are appended)
       * Runners without addedAt sort after all runners that have one. completedAt is never used here. */
      compareAdded(a, b) {
        const da = a.addedAt || "";
        const db = b.addedAt || "";
        if (da !== db) return da < db ? 1 : -1;
        return runnerIndex.get(b) - runnerIndex.get(a);
      },
    };
    return catalog;
  }

  async function loadCatalog() {
    const [gameData, runnerData] = await Promise.all([loadJson(PATHS.games), loadJson(PATHS.runners)]);
    return createCatalog(gameData, runnerData);
  }

  /* ---------- General rules sections (data/rules.json) ---------- */

  function ruleSectionBodyHtml(section) {
    const subsections = (section.subsections || [])
      .map(
        (sub) => `
          <div class="rule-sub">
            <h4 class="rule-sub-title">${escapeHtml(sub.title)}</h4>
            <div class="rule-body">${contentHtml(sub.content)}</div>
          </div>`
      )
      .join("");
    return `
      ${section.content ? `<div class="rule-body">${contentHtml(section.content)}</div>` : ""}
      ${subsections ? `<div class="rule-subs">${subsections}</div>` : ""}`;
  }

  // Collapsible panel. Sections with "exception" (No Hit) get their own styling and badge.
  function rulePanelHtml(section, open) {
    return `
      <details class="rule-panel${section.exception ? " is-exception" : ""}" id="${escapeHtml(section.id)}"${open ? " open" : ""}>
        <summary>
          <span class="rule-panel-title">${escapeHtml(section.title)}</span>
          ${section.exception ? `<span class="exception-badge">${escapeHtml(section.exception)}</span>` : ""}
          <span class="rule-panel-icon" aria-hidden="true"></span>
        </summary>
        <div class="rule-panel-body">${ruleSectionBodyHtml(section)}</div>
      </details>`;
  }

  // Optional card artwork from games.json ("cardBackground": { src, position? }), as a style
  // attribute setting the CSS variables used by .has-bg; "" when the game has none.
  function cardBackgroundStyle(game) {
    const bg = game && game.cardBackground;
    const src = bg && safeUrl(bg.src);
    if (!src) return "";
    const position = /^[\w\s.%-]+$/.test(bg.position || "") ? `; --card-bg-position: ${bg.position}` : "";
    return ` style="${escapeHtml(`--card-bg: url("${src}")${position}`)}"`;
  }

  /* ---------- Runner component ---------- */

  function avatarHtml(runner, profile) {
    const initial = escapeHtml((runner.name || "?").trim().charAt(0).toUpperCase());
    const src = safeUrl(runner.avatar);
    const inner = src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${initial}">`
      : initial;
    const cls = "runner-avatar";
    return profile
      ? `<a class="${cls}" href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${inner}</a>`
      : `<span class="${cls}" aria-hidden="true">${inner}</span>`;
  }

  function challengeHtml(challenge) {
    const proof = safeUrl(challenge.proof);
    const title = escapeHtml(challenge.title);
    // The challenge title itself is the proof link.
    return proof
      ? `<li><a class="challenge-link" href="${escapeHtml(proof)}" target="_blank" rel="noopener noreferrer">${title}</a></li>`
      : `<li><span class="challenge-link is-unlinked">${title}</span></li>`;
  }

  /**
   * Render one runner card.
   * @param catalog  result of loadCatalog()
   * @param runner   runner object from runners.json
   * @param entries  the runner's role entries to show (defaults to all)
   * @param opts     { highlight: (entry) => boolean, background: boolean }
   *                 background: use the cardBackground of the game of the runner's top role
   *                 (the entry that also sets the card's tier colour), if that game has one.
   *
   * Only real data is shown: without a profile URL the picture and name are plain (not links);
   * a role with no recorded challenges shows just "Game — Role", with no empty list or placeholder.
   */
  function runnerCard(catalog, runner, entries = runner.games || [], opts = {}) {
    const { highlight = () => false, background = false } = opts;
    const profile = safeUrl(runner.profile);
    const name = escapeHtml(runner.name);
    const sorted = [...entries].sort((a, b) => catalog.roleSortKey(b.role) - catalog.roleSortKey(a.role));
    const topRole = sorted[0] ? catalog.role(sorted[0].role) : null;
    const bg = background && sorted[0] ? cardBackgroundStyle(catalog.game(sorted[0].game)) : "";

    const entryHtml = sorted
      .map((entry) => {
        const game = catalog.game(entry.game);
        const gameTitle = game ? game.title : entry.game;
        const pageUrl = catalog.gamePageUrl(entry.game);
        const gameLabel = pageUrl
          ? `<a href="${escapeHtml(pageUrl)}">${escapeHtml(gameTitle)}</a>`
          : escapeHtml(gameTitle);
        // Cards name the OneBros tier itself (e.g. "Master"), not the game's own name for it ("Old One").
        const role = catalog.role(entry.role);
        const roleLabel = escapeHtml(role ? role.name : entry.role);
        const challenges = entry.challenges || [];
        return `
          <div class="runner-entry tier-${escapeHtml(entry.role)}${highlight(entry) ? " is-match" : ""}">
            <p class="runner-entry-head">
              <span class="tier-dot" aria-hidden="true"></span>
              <span class="runner-entry-game">${gameLabel}</span><span class="sep" aria-hidden="true">—</span>
              <span class="runner-entry-tier">${roleLabel}</span>
            </p>
            ${challenges.length ? `<ul class="challenge-list">${challenges.map(challengeHtml).join("")}</ul>` : ""}
          </div>`;
      })
      .join("");

    return `
      <article class="runner-card${topRole ? " tier-" + escapeHtml(topRole.id) : ""}${bg ? " has-bg" : ""}"${bg}>
        <header class="runner-head">
          ${avatarHtml(runner, profile)}
          <h3 class="runner-name">
            ${profile ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name}
          </h3>
        </header>
        <div class="runner-entries">${entryHtml}</div>
      </article>`;
  }

  // Replace broken profile pictures with the runner's initial.
  function bindAvatarFallback(root) {
    root.addEventListener(
      "error",
      (e) => {
        const img = e.target;
        if (img.tagName === "IMG" && img.dataset.fallback !== undefined) {
          img.replaceWith(document.createTextNode(img.dataset.fallback));
        }
      },
      true
    );
  }

  /* ---------- Page chrome ---------- */

  function initChrome() {
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    const toggle = $(".nav-toggle");
    const nav = $("#site-nav");
    if (toggle && nav) {
      const close = () => {
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
      };
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        document.body.classList.toggle("nav-open", open);
      });
      nav.addEventListener("click", (e) => {
        if (e.target.closest("a")) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
    }

    const header = $(".site-header");
    if (header) {
      const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // #top is the sticky header, which the browser treats as already in view, so #top links
    // scroll to the page top themselves (smooth via CSS, instant with reduced motion).
    // Focus returns to the header brand link so keyboard users continue from the top.
    document.addEventListener("click", (e) => {
      if (!e.target.closest('a[href="#top"]')) return;
      e.preventDefault();
      window.scrollTo({ top: 0 });
      const brand = $(".site-header .brand");
      if (brand) brand.focus({ preventScroll: true });
    });

    // "Back to top" only appears once the page has been scrolled past roughly one screen.
    const backToTop = $(".back-to-top");
    if (backToTop) {
      const onScroll = () =>
        backToTop.classList.toggle("is-visible", window.scrollY > Math.max(600, window.innerHeight));
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  function loadErrorHtml() {
    return `
      <p class="error">
        Could not load data. If you opened this file directly, run a local server
        instead (e.g. VS Code Live Server) — browsers block
        <code>fetch()</code> on <code>file://</code>.
      </p>`;
  }

  window.OneBros = {
    PATHS,
    $,
    escapeHtml,
    safeUrl,
    slugify,
    plainText,
    listHtml,
    contentHtml,
    loadJson,
    loadCatalog,
    ruleSectionBodyHtml,
    rulePanelHtml,
    cardBackgroundStyle,
    runnerCard,
    bindAvatarFallback,
    initChrome,
    loadErrorHtml,
  };
})();
