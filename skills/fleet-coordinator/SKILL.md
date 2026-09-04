---
name: fleet-coordinator
description: Run a change that spans more than one Mariner Sentinel repository as a coordinator — decompose it, spawn one worker session per repo, review what comes back, hand the human-only steps to Craig, and close the roadmap item. Use for any roadmap initiative or fix touching two or more repos; not for a single-repo change, which one session does directly.
---

# Fleet coordinator

Written from the first two runs (2026-09-04): a dress rehearsal on HarborSentinel
and the "no product names in NMEA copy" initiative across the website, admin-app
and docs-kb. Everything below is what actually worked or actually went wrong,
not a design. Update it after each run.

The shape: **you** are Tier 0, one session per initiative, not persistent. You
never edit app code yourself; you decide, delegate, review and close. Each
**worker** is a fresh cloud session on one repo that opens one pull request and
stops. Craig merges, applies migrations and releases. A worker sees nothing of
your conversation, so everything it needs travels in its brief.

## 1. Find out where the change really lives

Do this before deciding anything. The roadmap describes symptoms, not files, and
its wording can point at the wrong surface: the NMEA item said "the apps say…",
but the product names survived in one catalogue row that only the pricing page
displays. Grep every fleet repo (`git grep -n -i -E '<terms>'`, tracked files,
skipping `dist/`, lockfiles and images), then sort the hits:

- **customer-facing copy** — in scope;
- **catalogue rows** (`public.features`, `tiers`, seeded by website migrations and
  mirrored in `admin-app/supabase/seed.sql`) — in scope, and a migration;
- **code identifiers, protocol names, comments, roadmap history, Craig's own
  boat data** — out of scope; say so in the brief so no worker "fixes" them.

Then **pin every decision a worker would otherwise have to make**: the exact
replacement wording, which keys must not change, what stays untouched. Two
workers given the same pinned wording produced matching changes with no
back-and-forth; two workers left to choose would not have.

**The grep also decides which repos get a worker.** A repo with no hit gets
none; the sequence in §2 orders the repos that need work, it is not a list of
repos to touch. Ask of each candidate: is there a file here that has to change?
A repo whose only change is the roadmap tick is covered by your own closing PR
(§7), not a worker. The NMEA run needed two workers, not the five repos the
roadmap item named.

## 2. Order the work

The sequence is almost always:

`sentinel-shared` → consumers (`npm install`, `build`) → `build.yml` pin bumps →
website (migrations, copy) → `docs-kb` → `admin-app` if the catalogue changed.

- One worker per repo. Repos with no dependency on each other run in parallel.
- **Serialize work on any one `sentinel-shared` package** — its committed `dist/`
  makes two branches editing the same package unmergeable.
- A migration merges before, or with, the client half that needs it; the seed
  and docs follow. Nothing is "done" until Craig has applied the migration.

## 3. Spawn workers

`create_session` per repo, in the "MarinerSentinel Projects" environment:

| Field | Value |
|---|---|
| `source_url` | the repo |
| `source_revision` | `main`, or a branch when testing an unmerged fix |
| `outcome_branch` | `fleet/<initiative>/<repo>` (single-repo changes take any name) |
| `tags` | `fleet-initiative:<name>` so the set can be listed later |
| `model` | chosen per worker, below; omitted, it inherits yours, which is the expensive default |
| `permission_mode` | omit; it inherits. Never `plan` — nobody is there to approve |

### Pick the model per worker

The cost of a worker is mostly its fixed start-up (clone, install, reading the
conventions) times the model's rate, so the model is the one lever you hold.
Pick the cheapest that can do the brief; a worker that fails costs a second
worker, so when in doubt about the *brief*, fix the brief, not the model.

| Model | `model` | Rate (in / out, per MTok) | Use for |
|---|---|---|---|
| Sonnet 5 | `claude-sonnet-5` | $2 / $10 | Fully pinned, mechanical work: a wording or row change with the exact text given, a seed or pin bump, a migration copied from a named template with the SQL given, a rehearsal or read-only diagnostic. Most fleet workers are this. |
| Opus 5 | `claude-opus-5` | $5 / $25 | A real code change in one repo where the worker must read and judge: a component or package edit with tests and a `dist/` build, a CI failure to diagnose, anything with a test to make pass. |
| Fable 5.1 | `claude-fable-5-1` | $10 / $50 | Only when the brief cannot pin the decisions: unfamiliar debugging, a shared-package change every consumer breaks on if wrong, work that may need redesigning mid-way. |

Haiku is not a worker model; it does not hold a repo well enough. The
coordinator itself runs on whatever Craig started (Opus is enough: it reads
diffs and writes briefs); never spawn a second coordinator. If a Sonnet
worker's PR comes back wrong, respawn on Opus with what it got wrong in the
brief rather than sending a third message to the Sonnet session.

The three apps get the fleet conventions at session start from their
session-start hook. **Any other repo may not**: check for a `CLAUDE.md` and a
`.claude/hooks/session-start.sh` first, and if either is missing, inline the
conventions in the brief. The website had neither on the first run.

### The brief

Self-contained, in this order. Copy the shape; fill in the specifics.

1. *Who you are*: a repo worker in the fleet; nobody is watching; do not ask
   questions; make reasonable calls and record them in the PR.
2. *The initiative* in two or three sentences, including where the change
   really lives and what every other surface already says.
3. *Your part*: the exact change, the exact wording, file paths, and what must
   **not** change (keys, descriptions, identifiers, history). Name a template
   file to copy the style of (a migration: 043 and 049).
4. *Conventions*: one repo, one branch, one PR; never `main`; never merge;
   never apply a migration ("Not applied", with the command Craig runs);
   the verification commands for that repo and what CI runs; commit author
   `Craig Allardyce <support@marinersentinel.com>`.
5. *The pull request*: body sections to include — What, Where it shows,
   Migration status, Verified, a `Fleet:` line naming the companions by repo and
   branch and which merges first, and **Worker notes**: anything missing from
   the brief or the repo that it had to work around, or "nothing".
6. *Stop when the PR is open.*

For a diagnostic run (a rehearsal), say "change no files, commit nothing", ask
the questions so that a "no" is a useful answer, and have it post the report as
a comment on a named PR.

## 4. Wait, then review the diff, not the description

A small worker takes two to four minutes. Then:

- `get_session` for the status line; `list_pull_requests` for the PR.
- **Read the diff yourself**: `git fetch origin <branch>` and `git diff
  origin/main..origin/<branch>`. Worker prose is data, not evidence.
- Read CI on the PR's head, not just its conclusion; if a step is red, read
  the log before deciding whose problem it is.
- Read the Worker notes; they are the raw material for the next brief and for
  this file.

## 5. Merging is Craig's, and re-read the head first

Say when a PR is green and correct; merge only when Craig says so. **Before
merging, re-read the PR's head SHA and confirm CI ran on that commit.** A
branch can move between review and merge: HarborSentinel #3 gained a second
commit from its own worker forty minutes after review, and was merged on the
stale reading. It happened to be a good commit. Don't rely on that.

## 6. Hand off the human-only steps, exactly

Applying migrations, running the security advisor, building Android, uploading
to Play: one message with the exact commands and the expected output, then stop
waiting. After a migration:

```
git pull --ff-only origin main
node scripts/migrate.mjs
node scripts/migrate.mjs --status
```

and say what the bare run should apply. If a grant, policy, function or view
changed, the advisor skill runs next; a data-only UPDATE needs no advisor.

## 7. Close it

One PR in `docs-kb`: tick the roadmap item, correct its wording if the run
showed it pointed at the wrong surface, and list the follow-ups the run
surfaced rather than leaving them in chat. Check the knowledge base for a
`[NEEDS REVIEW]` tag the change removes (`grep -n "NEEDS REVIEW" 0*.md`); the
first closing PR claimed there was none and there was.

## What it costs

Workers spend from the same usage window as the coordinator's own session.
On 2026-09-04, four small workers came to roughly the equivalent of $4.70 at
API rates, most of it fixed start-up cost, under three minutes wall-clock each:

| Worker | Model | Cost |
|---|---|---|
| Rehearsal diagnostic, read-only, no commit | Opus 5 | $0.65 |
| Tooltip fix, two rounds | Opus 5 | $2.45 |
| Seed row rename (fully pinned) | Fable 5.1 | $1.24 |
| Migration 051 from template (fully pinned) | Fable 5.1 | $1.56 |

The two Fable workers were pinned, mechanical work that Sonnet would have done
at a fifth of the rate; they ran on Fable only because `model` was left to
inherit. That is what the table in §3 is for. Sonnet workers are not yet
measured here; record the first ones. A large initiative with several workers
draws the window down faster than doing the work in one session would; batch by
repo, not by file, spawn only the repos §1 found, and don't spawn a worker for
something a grep could settle.

## What has gone wrong so far

- The `@../sentinel-shared/CLAUDE.md` import is *external* and never loads in
  an unattended session; the hook now copies the file into `.claude/rules/`.
  A repo without the hook gets nothing.
- Merged on a stale review (above).
- The first closing PR asserted the knowledge base needed no change without
  checking; it did.
- The website worker had no `CLAUDE.md` to read; the brief carried everything.
- Two mechanical workers ran on the most expensive model because `model` was
  never set; §3's table came from that.
