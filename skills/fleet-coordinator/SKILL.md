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
| `permission_mode` | omit; it inherits. Never `plan` — nobody is there to approve |

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
API rates: about $1–1.5 each, most of it fixed start-up cost, under three
minutes wall-clock each. A large initiative with several workers draws the
window down faster than doing the work in one session would; batch by repo,
not by file, and don't spawn a worker for something a grep could settle.

## What has gone wrong so far

- The `@../sentinel-shared/CLAUDE.md` import is *external* and never loads in
  an unattended session; the hook now copies the file into `.claude/rules/`.
  A repo without the hook gets nothing.
- Merged on a stale review (above).
- The first closing PR asserted the knowledge base needed no change without
  checking; it did.
- The website worker had no `CLAUDE.md` to read; the brief carried everything.
