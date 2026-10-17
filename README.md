# Pool

A small web app for running an office pool: sports picks, an awards ballot, a baby pool, anything with a set of questions and a right answer.

1. **Create a pool.** Add questions with options and point values. Optionally set an entry fee (the pot is shown), a lock time and a numeric tiebreaker. Templates are included for weekly football picks, an awards ballot and a baby pool.
2. **Share the invite link.** Everyone enters a name and makes their picks. They can change picks until the pool locks. Nobody sees other people's picks until then.
3. **Enter results.** The organizer locks the pool (or it locks itself at the set time), marks winners as they happen, and the leaderboard updates for everyone. Ties go to the closest tiebreaker guess.

**Roll the dice.** On the picks form, 🎲 *Roll the dice* fills in every pick at random. When games have odds, the roll is weighted by them, so favorites come up more often but upsets still happen. *Pick all favorites* takes the favorite in every game.

**Weekly NFL slates with Claude's picks.** Each week's games and researched moneyline odds live in `public/weeks/`. On *New pool*, tap the 🏈 week button to load them. Leave *Add Claude's picks as an entry* checked and Claude joins the pool as a player. Claude takes the favorite when the odds give it at least a 60% chance, and rolls a die weighted by the odds for closer games.

No sign-up needed. The organizer and each entrant get a private key that's saved in their browser. The organizer can copy a private link to manage the pool from another device.

## Running it

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
npm start          # http://localhost:3000
npm run dev        # restart on file changes
npm test           # unit and API tests
```

Environment variables:

| Variable    | Default           | Purpose                       |
|-------------|-------------------|-------------------------------|
| `PORT`      | `3000`            | Port to listen on             |
| `DATA_FILE` | `data/pools.json` | Where pools are saved on disk |

## Adding a new week

1. Copy last week's file in `public/weeks/` and update `week`, `title`, `oddsAsOf`, `lockAt` (first kickoff, UTC), each game's `teams` and `odds` (American moneylines, same order as `teams`), the tiebreaker `line` and `sources`. Remove the `claude` block.
2. Roll Claude's picks: `node scripts/claude-picks.js public/weeks/<file>.json`
3. Add the file to the top of `public/weeks/index.json` and run `npm run check-weeks`.

Odds are a snapshot from when the file was made. The app doesn't take or place bets.

## How it's built

```
src/pool.js     validation, scoring, leaderboard, what the public can see
public/odds.js  moneyline → win chance, weighted dice rolls
public/slate.js weekly slates and Claude's picks
public/weeks/   one JSON file per week of games and odds
scripts/        roll Claude's picks, validate slates
src/store.js    JSON-file storage with atomic writes
src/server.js   HTTP server: JSON API under /api plus the static app
public/         single-page app (vanilla JS, no build step)
test/           node:test suites
```

### API

| Method & path                            | Who                     | Does                                        |
|------------------------------------------|-------------------------|---------------------------------------------|
| `POST /api/pools`                        | anyone                  | Create a pool; returns `adminToken`         |
| `GET /api/pools/:id`                     | anyone                  | Pool, entries and leaderboard               |
| `PATCH /api/pools/:id`                   | organizer               | Set `results`, `tiebreakerAnswer`, `locked` |
| `DELETE /api/pools/:id`                  | organizer               | Delete the pool                             |
| `POST /api/pools/:id/entries`            | anyone, while open      | Enter; returns `entryId` and `editToken`    |
| `PUT /api/pools/:id/entries/:entryId`    | the entrant, while open | Change picks                                |
| `DELETE /api/pools/:id/entries/:entryId` | organizer               | Remove an entry                             |

The organizer sends `X-Admin-Token`. An entrant sends `X-Entry-Id` and `X-Edit-Token`, which also lets them see their own picks before the pool locks.

Entry fees are only displayed to show the pot. The app doesn't collect or pay out money.
