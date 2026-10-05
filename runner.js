/* OneBros - runner page
 * One renderer for every runner. Reads ?runner=<id> (or #runner=<id>), then
 * loads data/runners.json through the shared catalog. Depends on shared.js.
 */
(function () {
  "use strict";

  const {
    PATHS,
    $,
    escapeHtml,
    safeUrl,
    loadJson,
    loadCatalog,
    runnerCard,
    avatarHtml,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    loadErrorHtml,
  } = window.OneBros;

  function runnerIdFromLocation() {
    return (
      new URLSearchParams(window.location.search).get("runner") ||
      new URLSearchParams(window.location.hash.replace(/^#/, "")).get("runner") ||
      ""
    );
  }

  function profileLinkLabel(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === "youtube.com" || host === "youtu.be") return "YouTube";
      if (host === "teamhitless.com") return "Team Hitless";
      return host;
    } catch {
      return "Profile";
    }
  }

  function staffForRunner(staffData, runner) {
    const people = (staffData && staffData.staff) || [];
    return people.find((p) => p.username === runner.id || p.id === runner.id) || null;
  }

  function staffBadgesHtml(staffData, person) {
    if (!person) return "";
    const rolesById = new Map(((staffData && staffData.roles) || []).map((r) => [r.id, r]));
    const badges = [...rolesById.values()]
      .filter((role) => (person.roles || []).includes(role.id))
      .map((role) => `<li class="staff-badge">${escapeHtml(role.name)}</li>`)
      .join("");
    return badges ? `<ul class="staff-badges">${badges}</ul>` : "";
  }

  function runsLead(runner) {
    const runs = (runner.games || []).length;
    if (!runs) return "No verified runs yet.";
    const games = new Set(runner.games.map((g) => g.game)).size;
    const runWord = runs === 1 ? "run" : "runs";
    const gameWord = games === 1 ? "game" : "games";
    return `${runs} verified ${runWord} across ${games} ${gameWord}.`;
  }

  function renderHero(catalog, runner, staffData) {
    const external = safeUrl(runner.profile);
    const person = staffForRunner(staffData, runner);
    const badges = staffBadgesHtml(staffData, person);
    const action = external
      ? `<div class="hero-actions"><a class="btn btn-ghost" href="${escapeHtml(external)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profileLinkLabel(external))}</a></div>`
      : "";
    document.title = `Onebros - ${runner.name}`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", `Verified runs by ${runner.name} on Onebros.`);

    $("#runner-hero").innerHTML = `
      <p class="breadcrumb"><a href="index.html#runners">Runners</a> <span aria-hidden="true">/</span> ${escapeHtml(runner.name)}</p>
      <header class="runner-head profile-id">
        ${avatarHtml(runner, external)}
        <div class="profile-id-text">
          <h1 id="runner-title" class="runner-name">${escapeHtml(runner.name)}</h1>
          ${badges}
        </div>
      </header>
      <p class="hero-lead">${escapeHtml(runsLead(runner))}</p>
      ${action}`;
  }

  function gameArt(game) {
    const bg = game && (game.cardBackground || game.pageBackground);
    const src = bg && safeUrl(bg.src);
    if (!src) return { src: "", position: "" };
    const position = /^[\w\s.%-]+$/.test(bg.position || "") ? bg.position : "";
    return { src, position };
  }

  function gameLogoHtml(game) {
    const logo = game && game.logo;
    const src = logo && safeUrl(logo.src);
    if (!src) return "";
    const size = logo.width && logo.height ? ` width="${Number(logo.width)}" height="${Number(logo.height)}"` : "";
    const blend = logo.blend === "screen" ? " blend-screen" : "";
    return `<img class="profile-game-logo${blend}" src="${escapeHtml(src)}"${size} alt="" aria-hidden="true" decoding="async">`;
  }

  function gameBannerHtml(catalog, gameId) {
    const game = catalog.game(gameId);
    const title = escapeHtml(game ? game.title : gameId);
    const pageUrl = catalog.gamePageUrl(gameId);
    const art = game ? gameArt(game) : { src: "", position: "" };
    const logo = game ? gameLogoHtml(game) : "";
    const artImg = art.src
      ? `<img class="profile-game-art" src="${escapeHtml(art.src)}" alt=""${art.position ? ` style="object-position: ${art.position}"` : ""}>`
      : "";
    const heading = logo
      ? `<h3 class="sr-only">${title}</h3>`
      : `<h3 class="profile-game-title">${title}</h3>`;
    const inner = `${artImg}${logo}${heading}`;
    const cls = `profile-game-banner${art.src ? "" : " is-plain"}`;
    return pageUrl
      ? `<a class="${cls}" href="${escapeHtml(pageUrl)}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }

  function renderRuns(catalog, runner) {
    const entries = runner.games || [];
    const byGame = new Map();
    for (const entry of entries) {
      if (!byGame.has(entry.game)) byGame.set(entry.game, []);
      byGame.get(entry.game).push(entry);
    }
    const order = new Map(catalog.games.map((g, i) => [g.id, i]));
    const groups = [...byGame.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
    const body = groups.length
      ? groups
          .map(([gameId, group]) => {
            const card = runnerCard(catalog, runner, group, {
              challengeMode: "full",
              head: false,
              showGame: false,
            });
            return `
              <section class="profile-game">
                ${gameBannerHtml(catalog, gameId)}
                ${card}
              </section>`;
          })
          .join("")
      : `<p class="empty">No verified runs yet.</p>`;
    $("#runner-content").innerHTML = `
      <section class="section" id="runs" aria-labelledby="runs-title">
        <div class="container">
          <header class="section-head">
            <h2 id="runs-title" class="section-title">Verified runs</h2>
          </header>
          <div class="profile-runs">${body}</div>
        </div>
      </section>`;
  }

  function renderNotFound(message) {
    document.title = "Onebros - Runner not found";
    $("#runner-hero").innerHTML = `
      <p class="breadcrumb"><a href="index.html#runners">Runners</a></p>
      <h1 id="runner-title" class="game-hero-title">Runner not found</h1>
      <p class="hero-lead">${message}</p>
      <div class="hero-actions"><a class="btn btn-primary" href="index.html#runners">Back to runners</a></div>`;
    $("#runner-content").innerHTML = "";
  }

  async function init() {
    initChrome();
    const content = $("#runner-content");
    bindAvatarFallback($("#runner-hero"));
    bindAvatarFallback(content);

    const runnerId = runnerIdFromLocation();
    let catalog;
    let staffData = null;
    try {
      [catalog, staffData] = await Promise.all([
        loadCatalog(),
        loadJson(PATHS.staff).catch(() => null),
      ]);
    } catch (err) {
      console.error(err);
      $("#runner-hero").innerHTML = loadErrorHtml();
      return;
    }
    initGamesMenu(catalog);

    const runner = catalog.runners.find((r) => r.id === runnerId);
    if (!runner) {
      renderNotFound(
        runnerId ? "We couldn't find that runner." : "Choose a runner to view their verified runs."
      );
      return;
    }

    renderHero(catalog, runner, staffData);
    renderRuns(catalog, runner);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
