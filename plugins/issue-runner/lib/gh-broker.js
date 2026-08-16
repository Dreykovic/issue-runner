#!/usr/bin/env node
/**
 * GitHub CLI wrapper for issue-runner. Node.js port of gh-broker.ps1.
 *
 * Assumes `gh` is on PATH and authenticated (`gh auth status`). Never
 * throws on gh failures — returns { error } JSON and exit 1, so the
 * orchestrator (an LLM reading stdout) can branch on it.
 *
 * Usage:
 *   node gh-broker.js check
 *   node gh-broker.js list-issues [--limit 30]
 *   node gh-broker.js get-issue --number 42
 *   node gh-broker.js slug --title "Add venue field"
 *   node gh-broker.js create-issue --title "..." --body "..." [--labels issue-runner,bug]
 *   node gh-broker.js create-branch --issue 42 --slug add-venue-field [--base main]
 *   node gh-broker.js create-pr --issue 42 --title "..." --body "..." [--base main]
 *   node gh-broker.js pr-status --number 5
 *   node gh-broker.js merge-pr --number 5 [--strategy squash]
 */
'use strict';

const { spawnSync } = require('child_process');
const { loadConfig } = require('./config');

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

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error,
  };
}

function ghAvailable() {
  const which = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (which.error || which.status !== 0) return false;
  const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  return auth.status === 0;
}

function cmdCheck() {
  ok({ ghAvailable: ghAvailable() });
}

function cmdListIssues(args) {
  if (!ghAvailable()) return fail('gh not available or not authenticated');
  const limit = args.limit || '30';
  const res = run('gh', ['issue', 'list', '--state', 'open', '--limit', String(limit),
    '--json', 'number,title,labels,body,assignees,url']);
  if (!res.ok) return fail(`gh issue list failed: ${res.stderr || res.error}`);
  try {
    ok(JSON.parse(res.stdout || '[]'));
  } catch (e) {
    fail(`could not parse gh output: ${e.message}`);
  }
}

function cmdGetIssue(args) {
  if (!args.number) return fail('missing --number');
  if (!ghAvailable()) return fail('gh not available or not authenticated');
  const res = run('gh', ['issue', 'view', String(args.number),
    '--json', 'number,title,labels,body,state,assignees,url']);
  if (!res.ok) return fail(`gh issue view failed: ${res.stderr || res.error}`);
  try {
    ok(JSON.parse(res.stdout));
  } catch (e) {
    fail(`could not parse gh output: ${e.message}`);
  }
}

function slugify(title) {
  let s = title.toLowerCase();
  const accentMap = [
    [/[àâä]/g, 'a'], [/[éèêë]/g, 'e'], [/[ïî]/g, 'i'],
    [/[öôó]/g, 'o'], [/[üûù]/g, 'u'], [/ç/g, 'c'],
  ];
  for (const [re, repl] of accentMap) s = s.replace(re, repl);
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/, '');
  return s;
}

function cmdSlug(args) {
  if (!args.title) return fail('missing --title');
  ok({ slug: slugify(args.title) });
}

function cmdCreateIssue(args) {
  if (!args.title) return fail('missing --title');
  if (!args.body) return fail('missing --body');
  if (!ghAvailable()) return fail('gh not available or not authenticated');

  const config = loadConfig(args['repo-root'] || process.cwd());
  const labels = args.labels ? args.labels.split(',') : config.issueLabels;

  const ghArgs = ['issue', 'create', '--title', args.title, '--body', args.body];
  for (const label of labels) ghArgs.push('--label', label);

  const res = run('gh', ghArgs);
  if (!res.ok) return fail(`gh issue create failed: ${res.stderr || res.error}`);
  const match = res.stdout.match(/\/issues\/(\d+)/);
  if (!match) return fail(`could not parse issue number from gh output: ${res.stdout}`);
  ok({ number: Number(match[1]), url: res.stdout, title: args.title });
}

function cmdCreateBranch(args) {
  if (!args.issue) return fail('missing --issue');
  if (!args.slug) return fail('missing --slug');
  const config = loadConfig(args['repo-root'] || process.cwd());
  const base = args.base || config.baseBranch;
  const branchName = `runner/issue-${args.issue}-${args.slug}`;

  run('git', ['fetch', 'origin']);
  run('git', ['checkout', base]);
  run('git', ['pull', '--ff-only']);

  let res = run('git', ['checkout', '-b', branchName]);
  if (res.ok) return ok({ branch: branchName, created: true });

  // Branch may already exist — plain checkout.
  res = run('git', ['checkout', branchName]);
  if (res.ok) return ok({ branch: branchName, created: false });

  fail(`could not create or checkout branch ${branchName}: ${res.stderr}`);
}

function cmdCreatePr(args) {
  if (!args.issue) return fail('missing --issue');
  if (!args.title) return fail('missing --title');
  if (!args.body) return fail('missing --body');
  if (!ghAvailable()) return fail('gh not available or not authenticated');

  const config = loadConfig(args['repo-root'] || process.cwd());
  const base = args.base || config.baseBranch;
  const fullBody = `${args.body}\n\nCloses #${args.issue}`;

  const res = run('gh', ['pr', 'create', '--title', args.title, '--body', fullBody, '--base', base]);
  if (!res.ok) return fail(`gh pr create failed: ${res.stderr || res.error}`);
  const match = res.stdout.match(/\/pull\/(\d+)/);
  if (!match) return fail(`could not parse PR number from gh output: ${res.stdout}`);
  ok({ number: Number(match[1]), url: res.stdout });
}

function cmdPrStatus(args) {
  if (!args.number) return fail('missing --number');
  if (!ghAvailable()) return fail('gh not available or not authenticated');
  const res = run('gh', ['pr', 'view', String(args.number),
    '--json', 'number,state,mergeable,statusCheckRollup,reviews']);
  if (!res.ok) return fail(`gh pr view failed: ${res.stderr || res.error}`);
  try {
    ok(JSON.parse(res.stdout));
  } catch (e) {
    fail(`could not parse gh output: ${e.message}`);
  }
}

function cmdMergePr(args) {
  if (!args.number) return fail('missing --number');
  if (!ghAvailable()) return fail('gh not available or not authenticated');
  const config = loadConfig(args['repo-root'] || process.cwd());
  const strategy = args.strategy || config.mergeStrategy;
  if (!['merge', 'squash', 'rebase'].includes(strategy)) {
    return fail(`invalid --strategy "${strategy}", must be merge|squash|rebase`);
  }
  const res = run('gh', ['pr', 'merge', String(args.number), `--${strategy}`, '--delete-branch']);
  if (!res.ok) return fail(`gh pr merge failed: ${res.stderr || res.error}`);
  ok({ merged: true, number: Number(args.number), strategy });
}

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (command) {
    case 'check': return cmdCheck();
    case 'list-issues': return cmdListIssues(args);
    case 'get-issue': return cmdGetIssue(args);
    case 'slug': return cmdSlug(args);
    case 'create-issue': return cmdCreateIssue(args);
    case 'create-branch': return cmdCreateBranch(args);
    case 'create-pr': return cmdCreatePr(args);
    case 'pr-status': return cmdPrStatus(args);
    case 'merge-pr': return cmdMergePr(args);
    default:
      return fail(
        'unknown command. Use: check | list-issues | get-issue | slug | create-issue | create-branch | create-pr | pr-status | merge-pr'
      );
  }
}

if (require.main === module) main();

module.exports = { slugify, ghAvailable };
