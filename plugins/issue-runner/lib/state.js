#!/usr/bin/env node
/**
 * State management for the issue-runner pipeline. Node.js port of the
 * former state.ps1, kept CLI-compatible so any OS with `node` on PATH can
 * run it (invoked by the orchestrator via the Bash tool).
 *
 * State lives in the TARGET repo (cwd, or --repo-root) under:
 *   .claude/runner-state/issue-<N>/state.json
 *
 * state.json shape:
 * {
 *   "issueNumber": 42,
 *   "title": "...",
 *   "branch": "runner/issue-42-...",
 *   "phase": "intent" | "optimize" | "risk" | "implement" | "test" | "review" | "merge" | "done" | "failed" | "paused",
 *   "createdAt": "...", "updatedAt": "...",
 *   "history": [{ "phase", "agent", "result", "at" }],
 *   "artifacts": {}
 * }
 *
 * Usage:
 *   node state.js init          --issue 42 --title "..." --branch "runner/issue-42-x" [--repo-root .]
 *   node state.js get           --issue 42 [--repo-root .]
 *   node state.js update-phase  --issue 42 --phase implement --agent implementer [--result ok] [--repo-root .]
 *   node state.js set-artifact  --issue 42 --key spec --value '<json-or-string>' [--repo-root .]
 *   node state.js list-active   [--repo-root .]
 *
 * All commands print JSON to stdout and exit 0 on success. On failure they
 * print { "error": "..." } to stdout and exit 1 — never throw a raw stack
 * trace, since the caller is an LLM-driven orchestrator parsing stdout.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VALID_PHASES = [
  'intent', 'optimize', 'risk', 'implement', 'test', 'review', 'merge',
  'done', 'failed', 'paused',
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

function ok(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function stateRoot(repoRoot) {
  return path.join(repoRoot, '.claude', 'runner-state');
}

function stateDir(repoRoot, issueNumber) {
  return path.join(stateRoot(repoRoot), `issue-${issueNumber}`);
}

function statePath(repoRoot, issueNumber) {
  return path.join(stateDir(repoRoot, issueNumber), 'state.json');
}

function readState(repoRoot, issueNumber) {
  const p = statePath(repoRoot, issueNumber);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeState(repoRoot, issueNumber, state) {
  const dir = stateDir(repoRoot, issueNumber);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(repoRoot, issueNumber), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function cmdInit(args) {
  const issueNumber = Number(args.issue);
  if (!issueNumber) return fail('missing/invalid --issue');
  if (!args.title) return fail('missing --title');
  if (!args.branch) return fail('missing --branch');
  const repoRoot = args['repo-root'] || process.cwd();

  const now = new Date().toISOString();
  const state = {
    issueNumber,
    title: args.title,
    branch: args.branch,
    phase: 'intent',
    createdAt: now,
    updatedAt: now,
    history: [],
    artifacts: {},
  };
  writeState(repoRoot, issueNumber, state);
  ok(state);
}

function cmdGet(args) {
  const issueNumber = Number(args.issue);
  if (!issueNumber) return fail('missing/invalid --issue');
  const repoRoot = args['repo-root'] || process.cwd();
  const state = readState(repoRoot, issueNumber);
  if (!state) return fail(`no state found for issue #${issueNumber}`);
  ok(state);
}

function cmdUpdatePhase(args) {
  const issueNumber = Number(args.issue);
  if (!issueNumber) return fail('missing/invalid --issue');
  if (!args.phase) return fail('missing --phase');
  if (!VALID_PHASES.includes(args.phase)) {
    return fail(`invalid --phase "${args.phase}", must be one of: ${VALID_PHASES.join(', ')}`);
  }
  if (!args.agent) return fail('missing --agent');
  const repoRoot = args['repo-root'] || process.cwd();

  const state = readState(repoRoot, issueNumber);
  if (!state) return fail(`no state found for issue #${issueNumber}`);

  const now = new Date().toISOString();
  state.phase = args.phase;
  state.updatedAt = now;
  state.history.push({
    phase: args.phase,
    agent: args.agent,
    result: args.result || '',
    at: now,
  });
  writeState(repoRoot, issueNumber, state);
  ok(state);
}

function cmdSetArtifact(args) {
  const issueNumber = Number(args.issue);
  if (!issueNumber) return fail('missing/invalid --issue');
  if (!args.key) return fail('missing --key');
  if (args.value === undefined) return fail('missing --value');
  const repoRoot = args['repo-root'] || process.cwd();

  const state = readState(repoRoot, issueNumber);
  if (!state) return fail(`no state found for issue #${issueNumber}`);

  let value = args.value;
  try {
    value = JSON.parse(args.value);
  } catch {
    // not JSON, store as raw string — fine, artifacts are free-form
  }

  state.artifacts = state.artifacts || {};
  state.artifacts[args.key] = value;
  state.updatedAt = new Date().toISOString();
  writeState(repoRoot, issueNumber, state);
  ok(state);
}

function cmdListActive(args) {
  const repoRoot = args['repo-root'] || process.cwd();
  const root = stateRoot(repoRoot);
  if (!fs.existsSync(root)) return ok([]);

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('issue-'));

  const active = [];
  for (const d of dirs) {
    const p = path.join(root, d.name, 'state.json');
    if (!fs.existsSync(p)) continue;
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (s.phase !== 'done' && s.phase !== 'failed') active.push(s);
  }
  ok(active);
}

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (command) {
    case 'init': return cmdInit(args);
    case 'get': return cmdGet(args);
    case 'update-phase': return cmdUpdatePhase(args);
    case 'set-artifact': return cmdSetArtifact(args);
    case 'list-active': return cmdListActive(args);
    default:
      return fail(
        `unknown command "${command}". Use: init | get | update-phase | set-artifact | list-active`
      );
  }
}

if (require.main === module) main();

module.exports = { readState, writeState, stateDir, statePath };
