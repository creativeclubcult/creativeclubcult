// CLI: snapshot JSON (+ optional stored state) → the public.sheets_commit payload, using the same diff.ts as
// the Edge Functions. Used for the first import (seeding from Sheets-connector reads) and for debugging.
//
//   deno run --allow-read supabase/tools/commit_payload.ts <snapshot.json> [stored.json] [--trigger manual]
//            [--expect-sheet <id>] [--expect-env dev|prod] [--plan]
//
// <snapshot.json> is the snapshot (or the whole doPost reply). Without stored.json the state is "empty
// database" (first import: every row is new).
// Prints the payload as JSON (or {skip, plan, warnings} with --plan, or when the diff skips the snapshot).
import { buildSnapshotCommit, type Stored } from '../functions/_shared/diff.ts';
import type { Snapshot } from '../functions/_shared/snapshot.ts';

const args = [...Deno.args];
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const showPlan = args.includes('--plan');
if (showPlan) args.splice(args.indexOf('--plan'), 1);
const trigger = (flag('--trigger') ?? 'manual') as 'cron' | 'manual' | 'bridge';
const expectSheet = flag('--expect-sheet');
const expectEnv = flag('--expect-env');
const [snapPath, storedPath] = args;
if (!snapPath) {
  console.error('usage: commit_payload.ts <snapshot.json> [stored.json] [--plan] [--trigger cron|manual|bridge]');
  Deno.exit(2);
}

const raw = JSON.parse(Deno.readTextFileSync(snapPath));
// accepts the snapshot itself or the whole doPost reply {ok, data, v, ms}
const snap = (raw && raw.ok === true && raw.data ? raw.data : raw) as Snapshot;
const empty: Stored = { last_snapshot_seq: null, digests: {}, projects: [], kas: [], open_issues: [], values: {} };
const stored = storedPath ? { ...empty, ...JSON.parse(Deno.readTextFileSync(storedPath)) as Partial<Stored> } : empty;
const r = buildSnapshotCommit(snap, stored, { trigger, expect_sheet: expectSheet, expect_env: expectEnv });
if (showPlan || !r.payload || r.skip) {
  console.log(JSON.stringify({ skip: r.skip ?? null, plan: r.plan, warnings: r.warnings }, null, 2));
  if (r.skip && r.skip !== 'idle') Deno.exit(1);
} else {
  console.log(JSON.stringify(r.payload));
}
