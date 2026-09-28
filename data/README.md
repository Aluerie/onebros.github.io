# OneBros data

All site content lives in these JSON files. The HTML pages only render them.

| File | Contents |
| --- | --- |
| `games.json` | Role tracks and roles, and every game: id, title, year, per-game role names (`roleNames`), and whether its page is published (`"page": true`). `defaultRoles` and a game's `roles` list are reference data only (not displayed); a game page shows its roles through the tiers in `games/<id>.json`. |
| `games/<id>.json` | Full rules for one game (e.g. `games/des.json`). Only needed when `"page": true`. |
| `runners.json` | Verified runners and the roles/challenges they completed. |
| `rules.json` | General / Overarching Rules shown on the homepage. Each section has `content` and/or `subsections`. A content block is a paragraph (string), `{ "list": [...] }`, or `{ "note": "...", "text": "..." }`. A section with `"exception"` (No Hit) is shown apart from the regular rules, and is also shown on every game page's No Hit section. |

## Roles

Roles are split into two separate tracks in `games.json`:

| Track | Role ids (lowest → highest) |
| --- | --- |
| `onebros` — OneBros challenge rules | `champion`, `legend`, `master`, `elitemaster`, `grandmaster` |
| `nohit` — Team Hitless ruleset | `hitless-scholar`, `hitless-sage` |

No Hit roles are never a sub-tier of Legend/Master; they are listed and grouped separately everywhere.
A game can rename OneBros roles with `roleNames` (Demon's Souls: Slayer / Monumental / Old One).

## Adding a runner

Append an object to the **end** of the `runners` array in `runners.json`:

```json
{
  "id": "runner-id",
  "name": "DisplayName",
  "avatar": "https://link-to-profile-picture.jpg",
  "profile": "https://www.youtube.com/@channel",
  "addedAt": "2026-09-28",
  "games": [
    {
      "game": "des",
      "role": "master",
      "challenges": [
        { "title": "Challenge name", "proof": "https://www.youtube.com/watch?v=...", "completedAt": "2023-10-10" }
      ]
    },
    {
      "game": "des",
      "role": "hitless-scholar",
      "challenges": [
        { "title": "Challenge name", "proof": "https://www.youtube.com/watch?v=..." }
      ]
    }
  ]
}
```

- `id`: unique, lowercase, no spaces.
- `avatar`: profile picture path or URL (local files go in `assets/runners/`). Shown as a circle
  (cropped by CSS only). If it is empty or fails to load, the runner's initial is shown.
- `profile`: the link opened by the runner's picture and name (normally YouTube).
  Use `null` when there is none: picture and name are then shown without a link.
- `challenges`: may be `[]` when only the role is verified; the card then shows just "Game — Role".
  Never add placeholder titles or URLs.
- `addedAt` (every new runner): date — or ISO date-time — the entry was **added to the OneBros
  site**. Used for the default display order on the homepage and in each game's Hall of Fame:
  newest added first. Runners with the same `addedAt` keep their order in this file, the one
  further down (added later) first; runners without `addedAt` come after all dated ones.
  It is about the site listing, not the achievement.
- `challenges[].completedAt` (optional): **when the achievement was completed**, `YYYY-MM-DD` —
  historical metadata only, never used for ordering. If the run was never dated explicitly,
  use the documented proxy: the publish date of the last required video of the proof (e.g. the
  final boss of a playlist) — never the date the runner was added here. Omit it when it cannot
  be established. A runner may have `addedAt` and no `completedAt`, or several challenges with
  different `completedAt` dates.
- Neither date is shown on the cards yet.
- `games[]`: one entry per role a runner holds in a game. A OneBros role and a No Hit role
  in the same game are two separate entries.
- `games[].game`: a game `id` from `games.json` (`des`, `ds1`, `ds2`, `bb`, `ds3`, `sekiro`, `er`).
- `games[].role`: a role id from the table above. Pages show the game's own name where it has one.
- `challenges[].title`: shown as the link text. `proof` is the video URL it opens.
  An empty `proof` shows the title as plain text.

## Adding a game page

1. Create `games/<id>.json` with the same structure as `games/des.json`:
   - `tiers`: one per OneBros role, in progression order, each with `role`, `content`,
     `challengesTitle` and `challenges` (`{ title, items }`).
   - `restrictions` (optional): `{ title, groups: [{ type, title, items }] }`.
   - `noHit` (optional): `{ content, roles: [{ role, content }] }` with roles
     `hitless-scholar` / `hitless-sage`. Shown as a separate track, never as a tier.
2. In `games.json`, set that game's `"page": true`, list its OneBros roles in `roles`
   (e.g. add `elitemaster`), and fill in `roleNames` if the game uses its own names.
3. Optional images in `games.json` (files go in `assets/games/`):
   - `"logo": { "src", "width", "height", "blend" }` — the page's cinematic hero: large and
     centred, it replaces the visible text title (the text stays available to screen readers).
     Use `"blend": "screen"` for a logo drawn on a black background. With a logo only (as
     Demon's Souls), the hero is the logo on the site background.
   - `"hero": { "src", "width", "height", "alt", "position" }` (optional) — background artwork
     behind the logo, cropped to fill.

No HTML or JavaScript changes are needed. The page is served at `game.html?game=<id>`.

### Rule text format

`content` is a list of blocks: a string (paragraph), `{ "list": [...] }`,
`{ "note": "...", "text": "..." }`, or a link `{ "label": "Proof example:", "text": "...", "url": "https://..." }`.
List items are strings or `{ "text": "...", "items": [...] }`.
Inside any rule text, `**double asterisks**` render as bold.
