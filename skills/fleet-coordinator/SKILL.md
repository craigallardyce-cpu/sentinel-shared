---
name: fleet-coordinator
description: Run a change that spans more than one Mariner Sentinel repository as a coordinator — decompose it, spawn one worker session per repo, review what comes back, hand the human-only steps to Craig, and close the roadmap item. Use for any roadmap initiative or fix touching two or more repos; not for a single-repo change, which one session does directly.
---

# Fleet coordinator

Written from the runs since 2026-09-04: a dress rehearsal on HarborSentinel, the
"no product names in NMEA copy" initiative across the website, admin-app and
docs-kb, and the single-repo runs since. Everything below is what actually worked
or actually went wrong, not a design. Update it after each run.

The shape: **you** are Tier 0, one session per initiative, not persistent. You
never edit app code yourself; you decide, delegate, review and close. Each
**worker** is a fresh cloud session on one repo that opens one pull request and
stops. Craig merges, applies migrations and releases. A worker sees nothing of
your conversation, so everything it needs travels in its brief.

## 0. Put the fleet in scope, before anything else

A cloud session starts with **one repository**: the one it was started from.
Every other fleet repo is refused by the GitHub tools with

```
Access denied: repository "craigallardyce-cpu/harborsentinel" is not configured
for this session. Allowed repositories: craigallardyce-cpu/sentinel-shared
```

and `/home/user` holds that one checkout and nothing else — so §1's "grep every
fleet repo", §4's diff reading and §5's merge all fail on their first call until
this is done. Do it as the first act of a coordinating run, before costing any
work. (This is the coordinator's own container. It is not the same as a worker's,
which §3 describes: do not assume either from the other.)

**`list_repos` enumerates what the workspace can reach.** All nine, with the
casing GitHub holds — `sentinel-shared`, `docs-kb`, `HarborSentinel`,
`OceanSentinel`, `VesselKeeper`, `MarinerSentinel-Website`, `admin-app`,
`WatchSchedule`, `NMEADataSimulator`.

### Attaching is cheap; cloning is not. They buy different things

| | `add_repo` alone | `add_repo` + clone |
|---|---|---|
| Cost | one call | minutes, and disk |
| GitHub API reads: `get_file_contents`, `list_commits`, `pull_request_read` (diff, checks, reviews), `list_pull_requests`, `merge_pull_request` | ✅ | ✅ |
| `git grep` across the tree, `git log -S`, reading history | ❌ | ✅ |

**Attach every repo at the start of the run. Clone only what §1's grep needs.**
Spawning a worker is `create_session` with a `source_url` (§3) and was not tested
from an unattached repo — but *reviewing what it opens* is `pull_request_read`,
and that is refused without the attach. So a session that attaches nothing can
still delegate and then cannot read what came back, which is the worse half of
the loop to lose. Attach first and the question does not arise.

Two things this buys immediately:

- **Fleet state in one call per repo, without cloning.** `get_file_contents`
  returns the head SHA it read from, so a handoff's SHA table can be checked
  against the live repos before trusting it. All six were confirmed that way on
  2026-09-08, four of them never cloned.
- **`search_code` is not a substitute for cloning.** It returns
  `{"total_count": 0, "incomplete_results": true}` for strings that are certainly
  present — these private repos are not indexed. Tried twice on HarborSentinel
  before giving up and cloning; a `total_count: 0` here means *not indexed*, never
  *not present*, and reading it as the latter would answer §1's question exactly
  backwards.

### Cloning, when a grep really needs it

```bash
# ONE at a time. The session's git proxy caps concurrency and a second
# concurrent clone 429s both. Give it ~10 minutes, not the default timeout.
git clone --depth 1 https://github.com/craigallardyce-cpu/<repo> /home/user/<repo>
```

**The clone path is lower-cased**, whatever the repo's own casing —
`/home/user/harborsentinel`, not `/home/user/HarborSentinel`. The drift checker
resolves the fleet from *capitalised* siblings, so it sees nothing until you add
them:

```bash
ln -sfn /home/user/harborsentinel /home/user/HarborSentinel
ln -sfn /home/user/oceansentinel /home/user/OceanSentinel
node /home/user/sentinel-shared/scripts/check-fleet-drift.mjs   # now full-fleet
```

**A shallow clone degrades history-dependent work silently, and both failures
look like answers.** `git log -S'<string>'` finds nothing, and the drift
checker's pin rule falls back to *"pins sentinel-shared@X, which this checkout
cannot verify is on the remote"* instead of saying whether the pin is actually
stale. Both were hit on 2026-09-08, and the second reads like a real finding.

```bash
git -C /home/user/<repo> fetch --depth=200 origin main   # then re-run
```

Prefer a bounded `--depth` over `--unshallow`: some repos' policy hooks block the
latter.

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
roadmap item named; the no-harness run needed one, because that item's "and any
in-app copy" described a surface that does not exist. An item's wording overstates
the spread as often as it points at the wrong surface, so grep before counting
repos — and correct the item's wording in the closing PR either way.

**Check the item's premise, not just its surface.** Three items in the week of
2026-09-06 had premises that had expired between filing and pickup: the
downloads page said "fleet is at 2.10.1" when it was at 2.11.0, half of Q27 was
already fixed, and `readEntitlements` had been filed as having no consumer on
the morning its third consumer was written. That last one was the dangerous
shape — actioned as written, the fix was to delete an export all three apps
import. A roadmap entry is a claim about the code as it stood on the day
somebody typed it. Verify it before costing the work, and close it as
already-done or wrongly-premised where that is the honest answer; that is a
result, not a wasted run.

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

Haiku is not a worker model; it does not hold a repo well enough.

**The coordinator itself runs on Opus 5.** It greps, writes briefs and reads
diffs, and its context is the one that grows over a run, so it is the session
where the rate matters most; Fable adds nothing to that work at twice the
price. Craig picks Opus when he starts the session. A session cannot change its
own model, so if you find yourself coordinating on Fable, say so in your first
reply and let Craig switch with `/model opus` before you spawn anything. Never
spawn a second coordinator. If a Sonnet worker's PR comes back wrong, respawn
on Opus with what it got wrong in the brief rather than sending a third message
to the Sonnet session.

The three apps get the fleet conventions at session start from their
session-start hook. **Any other repo may not**: check for a `CLAUDE.md` and a
`.claude/hooks/session-start.sh` first, and if either is missing, inline the
conventions in the brief. The website had neither on the first run and gained both
the same day; `admin-app` and `docs-kb` have not been checked.

Check for them **at the commit the worker actually starts from, not at `main`**. A
session created with `source_revision: main` can still come up on a stale checkout:
the no-harness worker started two merges behind, so it had neither file, and its
brief told it both were there. It said so under Worker notes, and it was right.
Nothing in `create_session` reports the resolved SHA, so the branch's merge-base is
where you find this out.

**Check the merge-base the moment the branch exists — not at review, and not at
merge.** It has happened twice. The second time, HarborSentinel's plan-visibility
worker came up three commits behind and its branch still carried a function `main`
had deleted, so the PR conflicted; the coordinator had read the diff, called it
correct, and told Craig `main` had not moved — all true of the diff, all wrong
about the base. The check is two commands and it decides how you read everything
after it:

```bash
git fetch --depth=200 origin main && git fetch origin <branch>
git merge-base origin/main <head-sha>       # equal to main's tip, or behind?
git log --oneline <merge-base>..origin/main # what the worker never saw
```

If it is behind, say so in your review before anything else: the diff you are
about to read was written against a tree that no longer exists, and a clean-looking
diff can still conflict or, worse, silently undo something merged since.


### The siblings are stale too, and that is a build failure

The branch is only half of it. Every fleet repo is present in a worker's
container as a sibling — shallow, lower-case, with capitalised symlinks so
`check-fleet-drift.mjs` finds them — but **only the repo named in `source_url`
is cloned at session start.** The rest are a snapshot, refreshed when somebody
last thought to refresh them and not otherwise. The reflogs say so plainly: the
ones in this session were last moved by a `pull --ff-only` that a coordinator ran
by hand.

That matters more than a stale branch does, because the apps consume
`@sentinel/*` through `file:` symlinks into the sibling. A stale
`sentinel-shared` does not produce a subtle wrong answer; it produces a build
that cannot resolve an import that exists on `main`. The HUD worker came up on a
HarborSentinel seven commits behind whose sibling predated `PlanPill`, so
`main` **would not build at all** before it had touched anything — a red build
that was nobody's fault and told it nothing about its own change.

So make the first act of every worker a pre-flight, and put it in the brief:

```bash
# Checkouts sit at /home/user/<Repo>, spelled as GitHub spells the repo --
# /home/user/HarborSentinel, /home/user/sentinel-shared. NOT ~/<repo>.
ls -d /home/user/*/                       # confirm before trusting either form
cd /home/user/<Repo>            && git fetch origin main -q && git pull --ff-only origin main -q
cd /home/user/sentinel-shared  && git fetch origin main -q && git pull --ff-only origin main -q
git -C /home/user/<Repo> log --oneline -1 && git -C /home/user/sentinel-shared log --oneline -1
cd /home/user/<Repo> && npm install --legacy-peer-deps && npm run build   # must pass BEFORE any edit
```

This block gave `~/<repo>`, lower-cased, until 2026-09-06, when the
alarm-display worker reported the paths as its first Worker note. It found the
checkout anyway, so the cost was small — but a brief that is wrong about where
the repo is spends the worker's first minutes teaching it not to trust the
brief. The `ls` line is there so the next one settles it in one command
instead. Note the capitalisation is the repo's own, not a convention: the app
repos are capitalised and `sentinel-shared` is not.

A green build here is the baseline the worker's own verification is measured
against. A red one is a finding, not a task: it means the container is behind or
the fleet is broken, and either way the worker should say so in its first reply
and in Worker notes rather than starting to fix code it did not break. Pull the
siblings a change depends on — `sentinel-shared` for any app, and the website
for a client half whose migration lives there.

The coordinator has the same problem. Your own siblings go stale under you while
you review, so `git fetch` before you read anything off one, and never quote a
sibling's file as current without it.

**And your own container usually has no siblings at all**, which is a different
thing from stale: a coordinating session started on `sentinel-shared` holds that
one checkout, so `check-fleet-drift.mjs` exits before any rule runs rather than
reporting a scope. Do not read that as the fleet being clean, and do not clone
three apps to get around it — say in the PR that the checker was not run here and
name what did exercise the change (its own tests, and the workers' runs in
containers that do have the siblings). Claiming a green drift check you did not
get is the §4 mistake in its most quotable form.
### The brief

Self-contained, in this order. Copy the shape; fill in the specifics.

1. *Who you are*: a repo worker in the fleet; nobody is watching; do not ask
   questions; make reasonable calls and record them in the PR.
2. *The initiative* in two or three sentences, including where the change
   really lives and what every other surface already says.
3. *Pre-flight, before any edit*: fast-forward this repo and the siblings the
   change depends on, then build. The commands are above; give them verbatim,
   with the sibling list filled in. Say that a red build here is a finding to
   report, not a task to start on.
4. *Your part*: the exact change, the exact wording, file paths, and what must
   **not** change (keys, descriptions, identifiers, history). Name a template
   file to copy the style of (a migration: 043 and 049).
5. *Conventions*: one repo, one branch, one PR; never `main`; never merge;
   never apply a migration ("Not applied", with the command Craig runs);
   the verification commands for that repo and what CI runs; commit author
   `Craig Allardyce <support@marinersentinel.com>`.
6. *The pull request*: body sections to include — What, Where it shows,
   Migration status, Verified, a `Fleet:` line naming the companions by repo and
   branch and which merges first, and **Worker notes**: anything missing from
   the brief or the repo that it had to work around, or "nothing" — including
   the two pre-flight SHAs, so the base it worked from is on the record rather
   than inferred.
7. *Stop when the PR is open.*

For a diagnostic run (a rehearsal), say "change no files, commit nothing", ask
the questions so that a "no" is a useful answer, and have it post the report as
a comment on a named PR.

## 4. Wait, then review the diff, not the description

A small worker takes two to four minutes. Then:

- `get_session` for the status line; `list_pull_requests` for the PR.
- **The `post_turn_summary` a worker writes about itself is unreliable, and on
  2026-09-09 both workers in one batch got it wrong.** The HarborSentinel worker
  reported *"PR #26 merged"*; the PR was open, unmerged, exactly as its brief
  required. The OceanSentinel worker reported editing `SessionView.tsx` and adding
  a prop named `clearWarningsOnEmpty`; neither exists — the real diff was
  `frontend/src/components/Weather.jsx` and `hasWarningCoverage`, exactly as
  briefed. **Both had done the work correctly and described it wrongly**, which is
  the dangerous shape: the diff is fine, so nothing fails, and only the coordinator's
  report to Craig carries the error. Repeating *"merged"* would have told him a PR
  was landed that was not.
  So: `status_detail` and `recent_action` are a hint that a worker *finished*, never
  evidence of *what it did*. Take the state from `list_pull_requests` (`merged`,
  `state`, `head.sha`) and the content from the diff. Never quote a worker's summary
  onward as fact, and never let one stand in for reading the PR.
- **Read the diff yourself**, and read the *right* diff. Two dots against a
  shallow clone is a trap: `git diff origin/main..origin/<branch>` compares the two
  trees, so everything `main` gained since the branch point reads as the worker
  having deleted it. The no-harness PR was three lines and looked, for a minute,
  like it had also deleted `CLAUDE.md`, the session-start hook and migration 051.
  Take the diff GitHub computed from the merge base — which is what a reviewer
  sees — or use three dots after deepening:
  ```bash
  git fetch --depth=200 origin main && git fetch origin <branch>
  git merge-base origin/main <head-sha>       # behind main? by how much?
  git log --oneline <merge-base>..origin/main # what the worker never saw
  git diff origin/main...origin/<branch>      # three dots
  ```
  Worker prose is data, not evidence — and so is your own two-dot diff.
- **Check what the branch is based on.** A merge-base behind `main` means the
  worker built on a tree missing recent fleet work: decide whether the diff still
  holds against current `main`, and whether the base needs merging in before the
  PR is reviewable. It is not automatically a re-spawn. The no-harness PR touched
  a file `main` had not changed, so it was correct and conflict-free, and CI on a
  `pull_request` event tests the merge result rather than the stale head anyway.
- **Resolving a stale base is yours, and it is not mechanical.** Merge `main` into
  the branch (never rebase or force-push a worker's branch) and read what git did
  *outside* the conflict markers as carefully as inside them. HarborSentinel's
  conflict was the new `planState` against `main`'s deletion of `planLabel` —
  obvious. What was not obvious: git auto-merged the import line to `main`'s
  version, which had dropped `readEntitlements` when `planLabel` went, and
  `planState` needs it. Clearing the markers alone would have produced a branch
  that does not compile. Build and test the resolved tree before pushing, never
  just the resolution.
- **Verify with the repo's own tooling, in the repo.** Two false alarms came from
  the coordinator's own checkout, not the worker's code: a committed `dist/` read
  as stale because `tsc` ran with no `node_modules` and degraded declarations for
  files the PR never touched, and a lint count that differed because it was
  measured in a throwaway worktree with a symlinked `node_modules`. Both were
  reported before being understood. If your own measurement disagrees with a green
  CI run on the same commit, suspect your measurement first — and do not go
  spelunking with `git stash` and `git checkout <ref> -- .` in a tree that holds an
  in-progress merge, which destroyed one and needed the merge redone.
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

**This check is the only thing keeping the knowledge base honest, so do it
properly.** It was done thinly for a week and left six tags describing work that
had already shipped — the swept-up pass on 2026-09-08 took the file from 19 real
tags to 12 in one sitting. There is no scheduled sweep and deliberately so: a tag
goes stale at the moment the work lands, which is here, and a weekly job is a
slower version of this same check that also has to be maintained. Four things
that pass make it wrong, all found the hard way:

- **Six of the matches are not tags.** Each file's header carries a legend line
  explaining the convention (*"`[NEEDS REVIEW]` is decided behaviour the app does
  not do yet"*). Count those and every number you report is wrong.
- **Tags come in pairs.** The same fact is stated in the product file and again in
  `05-troubleshooting.md` — the pairing token, the alarm wording, the share-link
  check. Resolve both copies together or the docs end up contradicting themselves.
- **A string in the source is not necessarily a string a customer can see.**
  VesselKeeper's `handleFetchDocumentContent` still returns a message, is
  re-exported twice, and is called by nothing. It was one step from being filed
  into the KB's string list, which would have taught the support agent to
  recognise a message the app cannot produce.
- **The roadmap narrows the reading; it does not decide it.** Check it first,
  because most tags map to an open item and that is cheap. Then read the code
  anyway for anything whose item is closed, absent or ambiguous — in the week of
  2026-09-08 the roadmap was wrong in both directions, including items closed as
  wrongly premised while the code stayed as it was.

Cite `file:line` for every verdict. This feeds customer-facing copy and the
support agent, so a verdict without evidence is a guess with consequences.

### Archive the workers

**Archiving spent workers is the coordinator's job, not Craig's** (his instruction,
2026-09-05). A worker is spent when its PR is merged or closed *and* the session
is idle — not when the PR merely opens, because a review can still send you back
to that session, and not while anything is queued against it.

`list_sessions` with `mine: true` gives every session and its status in one call;
read the status there rather than assuming, then `archive_session` each spent
worker. Archiving releases the container and is reversible — `unarchive_session`
brings one back — so the cost of archiving too early is a re-open, and the cost
of never archiving is a drawer of dead containers nobody can tell from live ones.

Three you never archive:

- **Yourself.** You are the running session.
- **The session that spawned you.** It is Craig's, and it is where the next
  coordinator is started from.
- **Anything you did not spawn as a worker.** Craig's own CLI and phone sessions
  appear in the same list, tagged `remote-control-sdk` or with a `bridge`
  environment. They are not yours to close, whatever their status says.

A worker that failed to initialise, or whose PR you closed unmerged, is spent
too: it has nothing left to give and archiving it is how the list stays honest.

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

The first Sonnet worker, 2026-09-05:

| Worker | Model | Cost | Wall-clock |
|---|---|---|---|
| Three pinned copy strings in one file, lint + build | Sonnet 5 | $0.47 | 1m 40s |

Three Sonnet workers in parallel, 2026-09-09 — the same two-line lockfile change
in each app, spawned together and all three idle inside four minutes:

| Worker | Model | Cost | Wall-clock |
|---|---|---|---|
| HarborSentinel lockfile version, lint + test + build + drift | Sonnet 5 | $0.53 | 2m 35s |
| VesselKeeper lockfile version, lint + test + build + drift | Sonnet 5 | $0.44 | 2m 17s |
| OceanSentinel lockfile version, three package roots, build + drift | Sonnet 5 | $0.70 | 3m 32s |

Three more Sonnet workers the same day, on pinned copy and one-prop changes:

| Worker | Model | Cost | Wall-clock |
|---|---|---|---|
| Website terms-page copy, one file, lint + build | Sonnet 5 | $0.56 | 1m 47s |
| HarborSentinel one prop + theme key, lint + test + build + drift | Sonnet 5 | $0.71 | 3m 24s |
| OceanSentinel one prop, frontend only, lint + test + build + drift | Sonnet 5 | $0.68 | 3m 39s |

All three diffs came back exactly as briefed — and two of the three described
themselves wrongly afterwards; see §4. The lesson is not to stop using Sonnet for
pinned work, which it does well and cheaply. It is that the saving is in the
typing, never in the reviewing.

$1.67 for the set, and all three diffs came back byte-identical in shape: one
file, two lines, nothing else moved. That is what a fully pinned brief buys, and
it is the shape §3's table means by mechanical. OceanSentinel costs half again as
much as the other two for the same edit, because its three package roots have to
be installed and its brief has to say which of them is out of scope.

The first Opus worker at real scope, 2026-09-06:

| Worker | Model | Cost | Wall-clock |
|---|---|---|---|
| Four display fixes in one app, two new test files, lint + tests + build + drift | Opus 5 | $3.72 | 9m |

Five times the Sonnet worker, for four items rather than three pinned strings —
and it earned the rate twice over. The brief left item 2's implementation open
and it chose a testable one; then it found a hole the brief had not seen, where
a second alarm inside the same sticky window would have inherited the first
one's acknowledgement. Neither is work a pinned copy change needs, which is the
whole of the choice: pay Opus where the worker must decide something, not
where it must type something.

Which is §3's table working: a third of the cheapest Fable worker for the same kind
of fully-pinned change, and no second round.

The two Fable workers were pinned, mechanical work that Sonnet would have done
at a fifth of the rate; they ran on Fable only because `model` was left to
inherit. That is what the table in §3 is for. Sonnet workers are not yet
measured here; record the first ones. A large initiative with several workers
draws the window down faster than doing the work in one session would; batch by
repo, not by file, spawn only the repos §1 found, and don't spawn a worker for
something a grep could settle.

## What has gone wrong so far

- **A coordinating session spent its first calls discovering it could see one
  repository.** 2026-09-08: `list_commits` on the three apps and the website all
  came back "not configured for this session", so the fleet-state table in the
  handoff could not be checked and §1's grep could not run. Recovered with
  `add_repo`, but only after the run had already been planned around what could
  be reached. §0 exists so the next session does this in its first minute instead
  of its tenth. The same run then read `search_code`'s `total_count: 0` on a
  private repo as "the string is not there" for a moment before noticing
  `incomplete_results: true` — the answer that looks most like a finished search
  is the one this tool gives when it has not searched at all.

- The `@../sentinel-shared/CLAUDE.md` import is *external* and never loads in
  an unattended session; the hook now copies the file into `.claude/rules/`.
  A repo without the hook gets nothing.
- Merged on a stale review (above).
- The first closing PR asserted the knowledge base needed no change without
  checking; it did.
- The website worker had no `CLAUDE.md` to read; the brief carried everything.
- Two mechanical workers ran on the most expensive model because `model` was
  never set; §3's table came from that.
- **Three stale checkouts in one day, and the third would not build.** The
  no-harness worker came up two merges behind, so its brief's claim that the repo
  had a `CLAUDE.md` was false. The plan-visibility worker came up three commits
  behind and carried a function `main` had deleted, so its PR conflicted. The HUD
  worker came up seven commits behind with a `sentinel-shared` sibling older than
  `PlanPill`, so `HarborSentinel`'s own `main` did not compile before it had
  changed a line. Each cost the worker real time before it worked out that the
  ground was wrong rather than its own change, and the third could as easily have
  been read as a bug it had introduced. §3's pre-flight came from these: the fix
  is two fetches and a build at the top of the brief, not sharper reviewing at
  the bottom. The first of the three is also where the standing rule comes from:
  when a worker's notes contradict the brief you wrote it, believe the notes.
- A two-dot diff against a shallow clone made a three-line PR look as though it
  had deleted five files. Confirm against GitHub's computed diff before saying
  anything to anyone about what a worker changed.
- **A conflicted PR gets no `pull_request` checks, and that is the signal.**
  HarborSentinel's plan-visibility PR produced no run at all on creation, while
  its two siblings fired within seconds. Not a broken repo: a `pull_request`
  workflow checks out `refs/pull/N/merge`, and GitHub cannot compute that ref
  while the PR conflicts, so nothing runs. Missing checks therefore mean *the
  branch does not merge* far more often than they mean a broken pipeline —
  invert the usual reading, and go look at the merge-base (§3) rather than at
  the workflow file. The runs appeared by themselves within seconds of the merge
  commit that resolved the conflict being pushed.
  `workflow_dispatch` is the honest way to exercise a branch meanwhile — an
  empty commit or a close-and-reopen is never it — but it tests the branch, not
  the merge result, so it is only equivalent once the branch is not behind
  `main`.
- **Do not call a missing run a failure until you have waited for one.** The
  same PR was reported a second time as "the trigger did not fire on a push
  either". It had: the `pull_request` runs landed about forty seconds after that
  push, seven seconds before a `workflow_dispatch` fired at them impatiently.
  The first report was right and the second was noise, and both went to Craig
  as fact. A run that has not appeared yet looks exactly like one that never
  will; only elapsed time tells them apart.
