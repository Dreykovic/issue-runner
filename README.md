# issue-runner

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Auto-triggered Claude Code pipeline that industrializes the development workflow: on every non-trivial prompt, a suite of specialized agents analyzes, optimizes, implements, tests, opens a PR, and reviews it — with no manual intervention.

## Vision

> *"For every prompt, if an issue already exists for the work to do, the runner picks up the issue, creates the dedicated branch, and at the end opens a pull request and reviews it before merging. In between, before it even starts, one agent optimizes my prompt, another analyzes possible regression risks, after implementation an agent checks for regressions, an agent writes unit tests, another runs them, and if everything's green we move on to the PR."*

## Pipeline

```
User prompt
   │
   ▼
[Fast filter, Node.js hook, <100ms]
   ├── skip → normal Claude response
   └── candidate
       │
       ▼
[intent-classifier — Haiku LLM agent, ~1-2s]
   │
   ├── CONVERSATION    → normal response
   ├── NEW_ISSUE       → full pipeline
   ├── EXISTING_ISSUE_N → pipeline resumed on #N
   ├── MULTI           → N parallel pipelines
   └── UNCLEAR         → asks the user
       │
       ▼ (for pipeline cases)
[prompt-optimizer] → reformulates the prompt
       │
       ▼
[risk-analyzer] → upfront regression analysis
       │
       ▼
[issue-broker] → create/find issue + branch
       │
       ▼
[implementer] (worktree, can spawn sub-implementers for multi-feature work)
       │
       ▼
[regression-checker] → re-reads the diff
       │
       ▼
[test-writer] → unit tests
       │
       ▼
[test runner] → pnpm test / flutter test / etc.
       │
       ▼
[pr-reviewer] → reviews the PR
       │
       ▼
[merge if green]
```

## Plugin structure

```
issue-runner/
├── .claude-plugin/
│   └── plugin.json              manifest
├── hooks/
│   ├── hooks.json               declares UserPromptSubmit
│   └── user-prompt-submit.js    fast filter (no LLM, <100ms)
├── agents/
│   ├── intent-classifier.md     decides run/skip/ask
│   ├── prompt-optimizer.md      (Build-2)
│   ├── risk-analyzer.md         (Build-2)
│   ├── implementer.md           (Build-2)
│   ├── test-writer.md           (Build-2)
│   ├── regression-checker.md    (Build-3)
│   ├── pr-reviewer.md           (Build-3)
│   └── prompt-splitter.md       (Build-3)
├── commands/
│   └── run.md                   manual fallback slash command
├── skills/
│   └── issue-runner-orchestration/SKILL.md   complete orchestration doctrine
└── lib/
    ├── config.js                reads .claude/issue-runner.config.json
    ├── state.js                 manages .claude/runner-state/
    └── gh-broker.js             gh CLI wrapper
```

## Cross-platform

The plugin is written in **pure Node.js** (no npm dependency), not PowerShell: it runs identically on Linux, macOS, and Windows as soon as `node` and `gh` (authenticated) are on PATH. That's what makes it installable on any of your projects, regardless of the machine's OS.

## Per-project configuration

Optional: drop a `.claude/issue-runner.config.json` at the root of the target repo to adjust behavior without touching the plugin:

```json
{
  "baseBranch": "main",
  "issueLabels": ["issue-runner"],
  "mergeStrategy": "squash",
  "maxParallelFeatures": 3,
  "maxRetriesPerPhase": 2,
  "testCommand": null
}
```

`testCommand` lets you force the test command (useful in a monorepo) instead of letting the orchestrator auto-detect the stack (npm/pnpm/yarn/bun, pytest, cargo, go test, rspec, maven/gradle, dotnet, flutter…) — see Phase 6 of the skill.

## Installation

```bash
# Register the marketplace (once, globally)
claude plugin marketplace add https://github.com/Dreykovic/issue-runner.git

# Install the plugin in user scope so it's active across all your projects
claude plugin install issue-runner@issue-runner --scope user
```

To develop on the plugin locally, replace the URL with your clone's path:

```bash
claude plugin marketplace add /path/to/your/clone/issue-runner
claude plugin install issue-runner@issue-runner
```

## Build status

- [x] Build-1 — Foundations (fast-filter hook, intent-classifier agent, state/gh libs)
- [x] Build-2 — Core agents (optimizer, risk, implementer, test-writer)
- [x] Build-3 — Quality agents (regression-checker, pr-reviewer, prompt-splitter)
- [x] Build-4 — Orchestration & multi-feature parallelism (doctrine lives in SKILL.md, no separate orchestrator code)
- [x] Build-6 — Cross-platform port (PowerShell → Node.js) + per-project config + generalized stack detection for Phase 6
- [ ] Build-5 — Validation on a real project

## Issue backend

GitHub only for v1 (via the `gh` CLI). Linear/Jira addable later behind an `IssueBroker` abstraction.

## Design decisions

- **Auto-trigger via the `UserPromptSubmit` hook**: the only way to get a true automatic trigger without a manual command.
- **LLM-free fast filter in the hook**: <100ms per prompt, zero cost. The fine-grained decision is delegated to the `intent-classifier` agent.
- **Business-logic-aware**: the classifier reads MEMORY.md, CLAUDE.md, and open issues before deciding. No simple regex on action verbs.
- **Multi-feature: silent split** by default.
- **No automatic commit/merge in v1** without explicit user confirmation — safety first.

## Contributing

Contributions are welcome — issues, PRs, feedback from real-project usage (that's exactly what's missing in Build-5).

- **No build, no test suite**: this repo is plugin configuration (Markdown + JSON + small Node.js scripts), not an application. Before opening a PR, validate your changes with the commands listed in [CLAUDE.md](CLAUDE.md#validating-changes) (JSON manifest parsing, `node --check` on the scripts, exercising the `state.js`/`gh-broker.js` CLIs against a scratch directory).
- **Agent scope**: each agent under `plugins/issue-runner/agents/*.md` has a strict role and a JSON input/output contract — see [plugins/issue-runner/CLAUDE.md](plugins/issue-runner/CLAUDE.md) before touching an agent or the orchestration skill. Don't widen an agent's `tools:` list beyond what it needs.
- **Cross-platform is mandatory**: `hooks/` and `lib/` are pure Node.js (zero npm dependency) so they run unmodified on Linux/macOS/Windows. Don't reintroduce an OS-specific script (PowerShell, bash-only, etc.).
- **Test locally**: install your modified version with `claude plugin marketplace add /path/to/your/fork` then `claude plugin install issue-runner@issue-runner`, and run the pipeline on a real prompt in a test project before opening the PR.
- For a substantial change (new phase, new issue backend, etc.), open a discussion issue before the PR — it avoids wasted work.
