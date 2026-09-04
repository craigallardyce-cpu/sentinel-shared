---
name: fleet-schema-change
description: Change the fleet's shared Supabase schema — a migration in the MarinerSentinel Website repo plus the client half in an app. Use when adding or altering a table, column, function, policy or grant, when a client write fails silently at the PostgREST boundary, or when repairing a database whose migrations were replayed out of order.
---

# Changing the fleet's schema

One Supabase project serves HarborSentinel, OceanSentinel, VesselKeeper, the
website and admin-app. Its schema of record is the live database plus
`migrations/*.sql` in the **MarinerSentinel Website** repository. A schema change
is therefore always at least two repositories, and always ends with a step only
Craig can take.

## 1. Before writing anything, read the live schema

The failure this project produces most is client code naming a table or column
the database does not have. PostgREST rejects it, nothing in the app surfaces the
error, and it looks like a feature that silently does nothing. VesselKeeper PR #4
called it "the fifth bug of the same shape this session".

Check the payload against the live schema, not against what the client used to
send, and not against another migration's prose. The `supabase` MCP server or a
`psql` session against `DATABASE_URL` both answer it.

## 2. Write the migration

Next number in sequence in `migrations/`; `--status` (below) shows the highest.

- **Idempotent, and say so in the header.** Guard an `UPDATE` by the old value as
  well as the id, so a re-run matches nothing. `CREATE TABLE IF NOT EXISTS`,
  `DROP POLICY IF EXISTS` then `CREATE POLICY`, `ADD COLUMN IF NOT EXISTS`.
- **A header that explains itself.** Every migration here opens with why it
  exists, what it was found by, what reads the thing being changed, and what is
  deliberately not changed. That prose is the only record of intent; the next
  person to touch the object reads it before deciding anything.
- **Grants follow 026's template.** This project has
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
  authenticated, service_role`, so a new table arrives with everything granted to
  both client roles — including TRUNCATE, which bypasses RLS. `REVOKE ALL` from
  both, then `GRANT` back exactly what the client does. RLS alone is not enough.
- **A new table is deny-by-default unless something reads it.** Enable RLS, and
  write a policy only for a caller that genuinely exists.

## 3. The client half, in the app repo

Its own PR, in its own repository. The website PR is the one that states whether
the migration has been applied — that sentence is what tells a reviewer whether
the client half will work when merged.

Client code that is inert until the migration lands is fine and normal (see
VesselKeeper's maintenance tabs, which show an empty state without the table).
Client code that *breaks* without it is not: gate it.

## 4. Apply it

Only from a machine holding `DATABASE_URL` — an agent cannot, and should not try.
Say so in the PR and hand over the exact command.

```bash
node scripts/migrate.mjs --status      # what is applied, what is pending
node scripts/migrate.mjs               # apply everything pending, in order
node scripts/migrate.mjs --only 051    # apply one file
```

`public.schema_migrations` (migration 050) records every applied file, so a bare
run applies only what is pending and a re-run of a recorded file is skipped.
`--status` is the authoritative answer to "has this been applied?" — PR prose is
not.

## 5. Then run the security advisor

After any change to functions, views, tables, policies, grants or roles, run the
`supabase-security-advisor` skill as the last step. It knows which findings are
accepted and flags only new ones. A new table you deliberately locked down will
show as an INFO lint; record it as an accepted residual rather than "fixing" it.

## Repairing a database that was migrated out of order

**Re-applying an old migration silently undoes every later one that touches the
same object.** `CREATE OR REPLACE FUNCTION`, `GRANT`, `REVOKE` and an unguarded
`UPDATE` all overwrite whatever is there now with what was true when that file
was written.

This is not hypothetical. On 2026-09-04 a bare `migrate.mjs` — which then
re-applied every file from 001 — reverted five function definitions to their
August versions before failing at 016. The repair reverted two more things,
because the files chosen for replay were older than the files that had last set
a grant (049) and a price (046).

The rule:

1. **List the objects the replayed files touch** — tables, functions, policies,
   grants, and the specific rows any `UPDATE` writes.
2. **Find every later migration touching any of them.** `grep -l` for the table
   and function names across all higher-numbered files, and read every
   `UPDATE`/`INSERT`/`DELETE`/`GRANT`/`REVOKE` in them.
3. **Re-apply that whole set in ascending order**, with `--only NNN --force`.
   Ascending order matters: 041 sets a price that 046 later changes, so 041 then
   046 is right and the reverse is not.
4. **Let CI check the result.** The website's pricing-drift check compares
   `pricing.ts` against the live catalog and caught both regressions that day.
5. **Then the security advisor**, because grants moved.

Never repair by editing the database by hand: the next `--status` would be a lie.
