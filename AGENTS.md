# AGENTS.md

This file guides AI coding agents (and anyone else) working on this repo.

## What this is

A local-network party game server. One Node/Express/Socket.io process hosts
a "shelf" of games — each one lives behind its own admin console, a shared
"game" screen meant for a TV, and a per-player join view with a QR code.
There's no build step and no frontend framework: every view is plain
HTML/CSS/vanilla JS, served as static files. There's no database either —
each game instance's state is a few JSON files on disk under `data/games/`.

Six games exist today: Trivia Bingo, Fastest Finger, Emoji Movie Quiz,
Tambola, Guess the Number, and Party Night (a meta-game that runs a whole
night of the other five with one cumulative scoreboard — see
`src/engines/party-night/`). New games get added the same way all of these
were: as a new **engine**.

## Architecture

### The engine plug-in system

Every game is an "engine" — a self-contained folder under `src/engines/` for
server logic and `public/engines/` for the three views. Nothing in
`server.js` or `src/routes.js` names a specific engine; they dispatch
generically through the registry at `src/engines/index.js`, so adding a new
engine is: write the files, add one line to that registry's `ENGINES` array,
done.

```
src/engines/<slug>/
  index.js     # the engine's public shape — see below
  state.js     # load/save this game instance's state (one JSON file)
  players.js   # load/save/register/remove players (one JSON file)
  routes.js    # express.Router() mounted at /api/games/:gameId/*
  questions.js # (quiz-style engines only) per-game question bank, seeded
               # from a static pool on first access

public/engines/<slug>/
  admin/{index.html, app.js, style.css}   # host's control panel
  game/{index.html, app.js, style.css}    # shared screen, e.g. a TV
  player/{index.html, app.js, style.css}  # each player's own phone view
```

`index.js` exports:

```js
module.exports = {
  slug: 'my-game', // URL segment: /play/my-game/..., engine id in meta.json
  title: 'My Game',
  emoji: '🎯',
  tagline: 'One line shown on the shelf card and the per-engine lobby.',
  listCreateOptions: () => ({ fields: [] }), // or a pack-style field — see
  // src/engines/fastest-finger/index.js for the pattern (one dropdown,
  // rendered as cards by public/shared/engine-lobby.js)
  createConfig: (body) => ({}), // turn a create-request body into this
  // engine's `config` shape, defaulting/sanitizing rather than rejecting
  gameRouter: engineRoutes.gameRouter, // (io) => express.Router()
  playerSummaries: engineRoutes.playerSummaries, // (gameId) => [...] — used
  // by the generic socket presence hook in server.js
  onTick: (io, gameId) => engineRoutes.tick(io, gameId), // optional — only
  // if the engine has something that should keep advancing even when no
  // one's actively polling (e.g. an auto-reveal timer)
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'my-game'),
};
```

A game **instance** (one specific play session) is just
`{id, name, engine, config, createdAt}`, created via `src/games.js`'s
`createGame` and persisted at `data/games/<id>/meta.json`. Everything else
that instance needs lives in sibling files in that same directory
(`game-state.json`, `players.json`, `questions.json`, ...) — see any
existing engine's `state.js`/`players.js` for the load/save pattern (always
`fs.mkdirSync(gameDir(gameId), { recursive: true })` before writing, always
merge a freshly-loaded file onto a default shape so adding a field later
doesn't break old saved games).

### Multiplayer plumbing

- **Socket.io rooms**: every client joins room `game:<gameId>`
  (`socket.emit('join-game', gameId)`); server broadcasts to
  `io.to('game:' + gameId)`. The two universal events are `state-update`
  (whatever `publicState(gameId)` returns) and `players-update`
  (`playerSummaries(gameId)`) — poll-and-also-push: every view also
  re-fetches on `socket.on('connect', ...)` and a `setInterval`, so a missed
  socket event self-heals within a few seconds.
- **Presence**: a player's view calls
  `socket.emit('identify-player', {gameId, playerId})` once it knows who it
  is; `src/presence.js` + `server.js`'s socket handlers track online/offline
  from that, independent of any one engine.
- **A player's own session resumes from localStorage**: each player view's
  `storageKey(suffix)` returns something like `` `tambola_${gameId}_${suffix}` ``
  — every engine uses a different prefix. All engines share one origin, so
  this is also how Party Night pre-enrolls a player into a round without
  them re-registering (see `src/engines/party-night/routes.js`'s
  `STORAGE_PREFIX` map and `registerIntoSubGame`) — don't rename an existing
  engine's prefix without checking that code.

## The shared design system — read this before writing any CSS

`public/shared/base.css` is loaded by every single view. It defines design
tokens (colors, fonts, radii — all CSS custom properties) and a set of
**atomic classes** for patterns that show up in every engine. The rule for
any new UI, in order:

1. **Use an existing atom if one fits.** Don't write a new `#players-list
li { ... }`-style rule that reimplements something `base.css` already
   provides — that kind of per-engine duplication is exactly what caused
   real bugs earlier (inconsistent padding between engines, one engine's
   title silently rendering a different color than every other one,
   because each copy had quietly drifted). If you're about to write CSS for
   a player/roster list row, a row of action buttons, a card's title, or a
   presence dot — check the table below first.
2. **If the exact same pattern is needed but doesn't exist as an atom yet,
   add it to the shared file** (`base.css`, or `game-columns.css`/
   `leaderboard.css` for the two more specific shared concerns below),
   not to your engine's own `style.css`. Any other engine should be able to
   pick it up for free later.
3. **Only write engine-local CSS for what's genuinely unique to that game's
   content** — Tambola's number grid, Trivia Bingo's bingo cells, Fastest
   Finger's multiple-choice buttons. If you can picture another engine
   wanting the exact same rule, it belongs in the shared file instead.

Current atoms in `public/shared/base.css` (`class="..."` unless noted):

| Atom                                                                                                           | Use for                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.card`                                                                                                        | Any panel/section. Gives it the shared glass/glow background, border, radius, padding.                                                                                                                                                                                                                      |
| `.card > h2`, `.card > h3` (automatic, no class needed)                                                        | A card's title — consistent color/glow/margin-to-content everywhere. Just put a direct-child `<h2>` in a `.card`.                                                                                                                                                                                           |
| `.hint`                                                                                                        | Small muted explainer text under a section title (e.g. "Need at least 25 questions to start").                                                                                                                                                                                                              |
| `.row-list` (on the `<ul>`/`<ol>`), `.row-list-wrap` (add for a wrapping-chips layout instead of one-per-line) | Any player/roster list container.                                                                                                                                                                                                                                                                           |
| `.row` (on each `<li>`), `.row-name`, `.row-stat`                                                              | One row inside a `.row-list` — status dot + name + a trailing stat.                                                                                                                                                                                                                                         |
| `.status-dot`, `.status-dot.online`                                                                            | The online/offline presence dot, standalone or inside a `.row-name`.                                                                                                                                                                                                                                        |
| `.btn-row`                                                                                                     | A row of action buttons (e.g. an admin's Start/Next/Reset controls) — consistent gap, wraps on small screens.                                                                                                                                                                                               |
| `button` (bare), `.btn-primary`, `.btn-secondary`, `.btn-danger`                                               | Buttons. Bare = neutral action. Primary = the main next step. Secondary = lower-emphasis. Danger = destructive.                                                                                                                                                                                             |
| `.btn-kick`                                                                                                    | The small "remove this player" button on an admin roster row.                                                                                                                                                                                                                                               |
| `header`, `header h1` (automatic), `#game-title` / `#join-hint`                                                | Every view's top banner. `header h1`'s `font-size` is the one thing each view overrides for its own context (TV titles are bigger than admin/player ones — see e.g. `public/engines/tambola/game/style.css`). `#game-title` is the admin views' muted subtitle; `#join-hint` is the game views' equivalent. |
| `.pill`                                                                                                        | A small rounded label/badge.                                                                                                                                                                                                                                                                                |
| `.hidden`                                                                                                      | `display: none !important` — toggle visibility from JS.                                                                                                                                                                                                                                                     |

`public/shared/game-columns.css` (only link it in a view that actually needs
this layout): `.col-row` / `.col` give a view a responsive two-column
layout above 760px and one column below it. Add `swap-on-mobile` to
`.col-row` when the second column is the more time-critical one (it then
shows first on mobile) — see Tambola's and Trivia Bingo's game views for
the two different uses.

`public/shared/leaderboard.css`: `.f1-board` (on the list) /
`.f1-row.place-1/2/3` (on each item) give a ranked leaderboard the gold/
silver/bronze F1-podium look. Use this instead of a plain `<ol>` for any
ranked standings. Compute tie-aware places (two players tied for 1st both
get "1st"; the next distinct score is 3rd, not 2nd) the same way
`src/engines/party-night/scoring.js`'s `rankByMetric` and the matching
client-side `placesFor` helpers do — don't just use array index + 1.

`public/shared/confetti.js` (`window.launchConfetti(options)`) and the
cheer-with-fade-out pattern (see Tambola's or Party Night's `game/app.js`
for `playCheer`/`fadeOutCheer`) are the shared "big win" celebration —
reuse them for any new engine's own celebration moment rather than
rewriting a confetti effect.

### Colors specifically

Never hardcode a color. Everything is a `var(--token)` from `base.css`'s
`:root` (`--bg`, `--text`, `--muted`, `--accent`, `--accent2`, `--gold`,
`--danger`, `--success`, `--hairline`, `--glass`, `--glass-strong`, `--chip`
for the one deliberately-always-light surface like a QR code). The whole
app re-themes by changing these tokens in one place — don't reintroduce a
hardcoded hex that bypasses that. Borders/outlines must be a single solid
color, never a gradient (box-shadow glows are fine — they're not a border).

## Adding a new game: checklist

1. Scaffold `src/engines/<slug>/{index.js,state.js,players.js,routes.js}`
   following an existing engine closest to your game's shape (a quiz with a
   question pool → look at `guess-the-number`; something with no fixed
   question pool → look at `tambola`). Reuse `nanoid` for ids, mirror the
   internal `load(gameId)`/`save(gameId, state)` pattern each engine's
   `state.js`/`players.js` already uses (always
   `fs.mkdirSync(gameDir(gameId), { recursive: true })` before writing,
   always merge a freshly-loaded file onto a default shape so adding a
   field later doesn't break old saved games) — whether that default shape
   is also exported (as `defaultState`) varies by engine; export it only if
   another module genuinely needs to reset to it.
2. Register it: add the require + array entry in `src/engines/index.js`.
   Nothing else in `src/` needs to change.
3. Build the three views under `public/engines/<slug>/`. Start from the
   closest existing engine's HTML/JS/CSS as a template, then strip it down
   to the atoms table above — don't carry over another engine's
   already-migrated-away custom list/button CSS.
4. If the game needs a two-column TV layout or a ranked leaderboard, link
   `/shared/game-columns.css` / `/shared/leaderboard.css` and use their
   classes rather than building your own version.
5. Format and lint before calling it done: `npm run format && npm run lint`.
6. Smoke-test for real, not just by reading the code:
   - `PORT=3101 node server.js &` (never touch the default port something
     else might be using)
   - `curl -X POST localhost:3101/api/games -d '{"engine":"<slug>","config":{}}'`
     and drive the rest of the flow with curl against `/api/games/:id/...`
   - Open the three views in an actual browser for a visual pass —
     reading the CSS is not the same as seeing it rendered
   - Delete the test game's `data/games/<id>/` directory and kill the test
     server when done
7. If you add a genuinely new shared pattern, put it in `base.css` /
   `game-columns.css` / `leaderboard.css`, not just in your engine's own
   `style.css` — and consider whether an existing engine should adopt it
   too, the same way Trivia Bingo and the rest got migrated onto `.row-list`/
   `.btn-row`/the shared header after they were introduced.

## Development commands

```bash
npm start            # node server.js
npm run lint          # eslint .
npm run lint:fix
npm run format        # prettier --write .
npm run format:check
```

No test suite exists yet — verification is the manual curl + browser pass
described above. Run format and lint before considering any change done.

## Code style

- No build step, no framework, no TypeScript — plain CommonJS on the
  server, plain browser JS (ES2022, no bundler) on the client. Don't
  introduce one without discussing it first.
- Comments explain _why_, not _what_ — a hidden constraint, a subtle
  invariant, a workaround for a specific bug. Well-named code doesn't need
  a comment restating it.
- Prefer small, focused engine files over one big one; mirror whatever the
  closest existing engine already does structurally rather than inventing
  a new shape.
- Don't add a dependency, a database, or a build tool to solve something
  the existing file-based/vanilla-JS approach already handles.
