/* OneBros - staff page script
 * Renders the community team from data/staff.json: one section per group, in file order.
 * Each person is listed once, in the first shown group (in file order, i.e. by priority) matching
 * any of their roles, with a badge for every role they hold. Within a group, people
 * are ordered by the group's role order, then file order. Groups marked "hidden": true stay in the
 * data but are not shown. A person with a "profile" URL gets their avatar and name linked to it (new tab).
 * Depends on shared.js.
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
    avatarHtml,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    loadErrorHtml,
  } = window.OneBros;

  // One badge for every role the person holds, in the order roles are listed in staff.json.
  function staffCardHtml(person, rolesById) {
    const profile = safeUrl(person.profile);
    const name = escapeHtml(person.name);
    const badges = [...rolesById.values()]
      .filter((role) => (person.roles || []).includes(role.id))
      .map((role) => `<li class="staff-badge">${escapeHtml(role.name)}</li>`)
      .join("");
    return `
      <article class="runner-card staff-card">
        <header class="staff-head">
          ${avatarHtml(person, profile)}
          <div class="staff-id">
            <h3 class="runner-name">
              ${profile ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name}
            </h3>
            ${person.username ? `<p class="staff-username">@${escapeHtml(person.username)}</p>` : ""}
          </div>
        </header>
        ${badges ? `<ul class="staff-badges">${badges}</ul>` : ""}
      </article>`;
  }

  function renderStaff(data) {
    const rolesById = new Map((data.roles || []).map((r) => [r.id, r]));
    const placed = new Set();

    const shown = (data.groups || [])
      .filter((group) => !group.hidden)
      .map((group) => {
        // Members follow the order of the group's roles (e.g. admins before moderators), then file order.
        const groupRoles = group.roles || [];
        const rank = (p) => Math.min(...(p.roles || []).map((id) => groupRoles.indexOf(id)).filter((i) => i >= 0));
        const members = (data.staff || [])
          .filter((p) => !placed.has(p) && (p.roles || []).some((id) => groupRoles.includes(id)))
          .sort((a, b) => rank(a) - rank(b));
        members.forEach((p) => placed.add(p));
        return { group, members };
      })
      .filter(({ members }) => members.length);

    // A single shown group needs no heading of its own: the page title already names it.
    const single = shown.length === 1;
    const sections = shown
      .map(({ group, members }, i) => {
        const id = escapeHtml(group.id);
        const head = single
          ? ""
          : `<header class="section-head">
                <h2 id="${id}-title" class="section-title">${escapeHtml(group.title)}</h2>
                ${group.lead ? `<p class="section-lead">${escapeHtml(group.lead)}</p>` : ""}
              </header>`;
        const label = single ? `aria-label="${escapeHtml(group.title)}"` : `aria-labelledby="${id}-title"`;
        return `
          <section class="section${i % 2 ? " section-alt" : ""}" id="${id}" ${label}>
            <div class="container">
              ${head}
              <div class="staff-grid">${members.map((p) => staffCardHtml(p, rolesById)).join("")}</div>
            </div>
          </section>`;
      })
      .join("");

    $("#staff-content").innerHTML = sections || `<div class="container section"><p class="empty">No staff listed yet.</p></div>`;
  }

  async function init() {
    initChrome();
    bindAvatarFallback($("#staff-content"));

    // The catalog only feeds the Games dropdown; the page works without it.
    loadCatalog()
      .then((catalog) => initGamesMenu(catalog))
      .catch((err) => console.error(err));

    try {
      renderStaff(await loadJson(PATHS.staff));
    } catch (err) {
      console.error(err);
      $("#staff-content").innerHTML = `<div class="container section">${loadErrorHtml()}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
