import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  doctor,
  followIndex,
  formatRun,
  listRuns,
  readRun,
  resolveRun,
  summarize,
} from '../src/backend/infrastructure/runRecorder/runStore';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, process.env.RUN_RECORDER_DIR || '.local/runs');
const USAGE = `Usage: npm run runs -- <command> [flags]
  doctor                 check that recording works
  list [--failed] [--since <N>m|<N>h] [--json]
  show <ref> [--full] [--json]   ref: last, run id, run id prefix, operation id
  tail [--failed]        follow index.log until interrupted`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const KNOWN_FLAGS = new Set(['--failed', '--full', '--json', '--since']);
const unknownFlag = args.find((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
if (unknownFlag) fail(`unknown flag ${unknownFlag}\n${USAGE}`);
const flags = new Set(args.filter((a) => a.startsWith('--') && a !== '--since'));
const sinceAt = args.indexOf('--since');
let sinceMs: number | undefined;
if (sinceAt >= 0) {
  const match = /^(\d+)([mh])$/.exec(args[sinceAt + 1] ?? '');
  if (!match) fail(`--since expects <N>m or <N>h\n${USAGE}`);
  sinceMs = Number(match[1]) * (match[2] === 'h' ? 3_600_000 : 60_000);
}
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(sinceAt >= 0 && i === sinceAt + 1)
);
const [command, ref] = positional;
const now = new Date();

if (command === 'doctor') {
  let health: { uptimeSeconds: number } | undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.APP_PORT ?? 3000}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as { uptime?: unknown };
    if (typeof body.uptime === 'number') health = { uptimeSeconds: body.uptime };
  } catch {
    health = undefined;
  }
  const result = doctor(dir, health);
  console.log(result.lines.join('\n'));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'list') {
  const runs = listRuns(dir, { failed: flags.has('--failed'), sinceMs, now });
  if (flags.has('--json')) console.log(JSON.stringify(runs));
  else {
    for (const r of runs) {
      const op = r.links.operationId ? ` op=${r.links.operationId}` : '';
      console.log(`${r.outcome.toUpperCase().padEnd(7)} ${r.runId} ${r.startedAt} ${r.title}${op}`);
    }
  }
} else if (command === 'show') {
  if (!ref) fail(USAGE);
  const runId = resolveRun(dir, ref, now);
  if (!runId) fail(`no run matches "${ref}"`);
  const events = readRun(dir, runId);
  if (flags.has('--json')) {
    console.log(JSON.stringify({ summary: summarize(events, now), events }));
  } else {
    console.log(formatRun(events, now, { full: flags.has('--full') }));
  }
} else if (command === 'tail') {
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  await followIndex(dir, (line) => console.log(line), {
    failed: flags.has('--failed'),
    signal: controller.signal,
  });
} else {
  fail(USAGE);
}
