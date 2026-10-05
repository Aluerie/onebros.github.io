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
    staff: "data/staff.json",
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
        if (!game || !game.page) return "";
        // Keep ?game= for GitHub Pages. Also put the id in the hash so local
        // static servers that rewrite game.html → /game (and drop the query) still work.
        const id = encodeURIComponent(game.id);
        return `game.html?game=${id}#game=${id}`;
      },

      // Every { runner, entry } pair, where entry = one role a runner holds in one game.
      entries() {
        return runners.flatMap((runner) => (runner.games || []).map((entry) => ({ runner, entry })));
      },

      /** Best date for when this game/role entry was verified (challenge completedAt). */
      entryVerifiedAt(entry, runner) {
        let best = "";
        for (const c of entry.challenges || []) {
          const d = String(c.completedAt || "").trim();
          if (d && (!best || d > best)) best = d;
        }
        return best || runner.addedAt || "";
      },

      compareVerifiedEntry(a, b) {
        const da = catalog.entryVerifiedAt(a.entry, a.runner);
        const db = catalog.entryVerifiedAt(b.entry, b.runner);
        if (da !== db) return da < db ? 1 : -1;
        return runnerIndex.get(b.runner) - runnerIndex.get(a.runner);
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

  // shortFallback: the short label for a challenge with no canonical title (only used for proof links).
  function challengeLinkLabel(challenge, mode = "short", shortFallback = "") {
    const canonical = String(challenge.title || "").trim() || shortFallback;
    const full = String(challenge.restrictions || challenge.title || "").trim();
    if (mode === "full") return full;
    return canonical;
  }

  function challengeHtml(challenge, mode = "short", shortFallback = "") {
    const proof = safeUrl(challenge.proof);
    const label = challengeLinkLabel(challenge, mode, proof ? shortFallback : "");
    if (!label) return "";
    const title = escapeHtml(label);
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
   * @param opts     { highlight, background, challengeMode }
   *                 background: use the cardBackground of the game of the runner's top role
   *                 challengeMode: "short" (homepage — canonical titles) or "full" (game HoF)
   *
   * Only real data is shown: without a profile URL the picture and name are plain (not links);
   * a role with no recorded challenges shows just "Game — Role", with no empty list or placeholder.
   */
  function runnerCard(catalog, runner, entries = runner.games || [], opts = {}) {
    const { highlight = () => false, background = false, challengeMode = "short" } = opts;
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
        // No Hit runs have no canonical challenge title: in short mode their proof link is named
        // after the role (e.g. "Hitless Sage") instead of listing the full restrictions.
        const shortFallback = role && role.track === "nohit" ? role.name : "";
        const challenges = (entry.challenges || [])
          .map((c) => challengeHtml(c, challengeMode, shortFallback))
          .filter(Boolean);
        return `
          <div class="runner-entry tier-${escapeHtml(entry.role)}${highlight(entry) ? " is-match" : ""}">
            <p class="runner-entry-head">
              <span class="tier-dot" aria-hidden="true"></span>
              <span class="runner-entry-game">${gameLabel}</span><span class="sep" aria-hidden="true">—</span>
              <span class="runner-entry-tier">${roleLabel}</span>
            </p>
            ${challenges.length ? `<ul class="challenge-list">${challenges.join("")}</ul>` : ""}
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

  /* Games dropdown in the site nav. The "Games" link (.nav-games) becomes a "Games ▾" toggle for
   * a list of "All Games" (the link's own href) plus every game with a page, in games.json order.
   * Opens inline inside the mobile menu. Without the hook or any game page, the plain link stays. */
  function initGamesMenu(catalog, currentId = "") {
    const item = $(".site-nav .nav-games");
    const link = item && $("a", item);
    const games = catalog.games.filter((g) => catalog.gamePageUrl(g.id));
    if (!link || !games.length) return;

    item.innerHTML = `
      <button class="nav-games-toggle" type="button" aria-expanded="false" aria-controls="games-menu">
        ${escapeHtml(link.textContent.trim())}<span class="nav-games-caret" aria-hidden="true">▾</span>
      </button>
      <ul class="nav-games-menu" id="games-menu" hidden>
        <li><a href="${escapeHtml(link.getAttribute("href"))}">All Games</a></li>
        ${games
          .map(
            (g) =>
              `<li><a href="${escapeHtml(catalog.gamePageUrl(g.id))}"${
                g.id === currentId ? ' aria-current="page"' : ""
              }>${escapeHtml(g.title)}</a></li>`
          )
          .join("")}
      </ul>`;

    const toggle = $(".nav-games-toggle", item);
    const menu = $(".nav-games-menu", item);
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
    };

    toggle.addEventListener("click", () => setOpen(menu.hidden));
    // Following a link closes the dropdown; the nav's own handler also closes the mobile menu.
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    // Clicks outside (including the hamburger toggle) close it.
    document.addEventListener("click", (e) => {
      if (!item.contains(e.target)) setOpen(false);
    });
    // Tabbing away closes it (focus moving to nothing, e.g. a click on plain text, is left to the click handler).
    item.addEventListener("focusout", (e) => {
      if (e.relatedTarget && !item.contains(e.relatedTarget)) setOpen(false);
    });
    // Escape closes only the dropdown (not the mobile menu) and returns focus to the toggle.
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || menu.hidden) return;
      e.stopPropagation();
      setOpen(false);
      toggle.focus();
    });
  }

  function loadErrorHtml() {
    return `
      <p class="error">
        Could not load data. If you opened this file directly, run a local server
        instead (e.g. VS Code Live Server) — browsers block
        <code>fetch()</code> on <code>file://</code>.
      </p>`;
  }

  // Discord logo for the "Join the Discord" buttons; decorative, since the button text names the link.
  const discordIcon =
    '<svg class="btn-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/>' +
    "</svg>";

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
    avatarHtml,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    loadErrorHtml,
    discordIcon,
  };
})();
