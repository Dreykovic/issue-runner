# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This repo is a **Claude Code plugin marketplace** containing a single plugin, `issue-runner`. It ships no application code of its own — it is entirely plugin configuration: agent prompts (`.md`), a skill (`.md`), a hook script, and small Node.js CLI libraries the hook/skill shell out to. There is no package.json, no build step, no test runner. Most prose (README, agent/skill instructions) is written in **French**; keep new plugin-facing content in French to match.

The plugin itself builds a *separate* auto-triggered pipeline that runs in whatever project it's installed into: on every non-trivial user prompt, it runs intent-classification → prompt optimization → risk analysis → GitHub issue/branch creation → implementation (in a git worktree) → regression check → test writing/running → PR creation → PR review → merge, all via chained subagent invocations. Do not confuse "the pipeline this plugin implements" with "how to work in this repo" — you are almost always editing the plugin's *definition* files, not running the pipeline yourself.

The plugin is written in **Node.js, not PowerShell**, specifically so it works unmodified across Linux, macOS, and Windows, and on any target project regardless of that project's own language/stack. Its only runtime dependencies are `node` and an authenticated `gh` CLI on PATH in the target repo. Don't reintroduce OS-specific scripting (PowerShell, bash-only syntax, etc.) into `hooks/` or `lib/` — that would break the "works on all my projects" property this was built for.

## Repo layout

```
.claude-plugin/marketplace.json          marketplace manifest (points to ./plugins/issue-runner)
plugins/issue-runner/
├── .claude-plugin/plugin.json           plugin manifest (name/description/author)
├── skills/issue-runner-orchestration/SKILL.md   the orchestration doctrine — auto-discovered, this is
│                                                  what actually drives Claude when the plugin fires
├── agents/*.md                          8 subagent definitions invoked by the orchestration skill
├── commands/run.md                      /run — manual fallback trigger for the pipeline
├── hooks/hooks.json                     registers user-prompt-submit.js on UserPromptSubmit
├── hooks/user-prompt-submit.js          fast filter (no LLM call, must stay fast, must always exit 0)
└── lib/
    ├── config.js                        reads `.claude/issue-runner.config.json` from the TARGET repo (optional, has defaults)
    ├── state.js                         CLI: .claude/runner-state/issue-<N>/state.json read/write (init/get/update-phase/set-artifact/list-active)
    └── gh-broker.js                     CLI: gh wrapper (issues, branches, PRs, merges) — see `node lib/gh-broker.js` with no args for the command list
```

**Critical architectural fact**: a `CLAUDE.md` at a plugin's root is *not* auto-loaded by Claude Code. Only a project's own `CLAUDE.md`, plus a plugin's `skills/`, `commands/`, and `agents/` directories, are auto-discovered. That's why `plugins/issue-runner/CLAUDE.md` is documentation-only (explains this constraint) and the real "always active" instructions live in `skills/issue-runner-orchestration/SKILL.md` instead. When adding new always-on orchestration behavior, it goes in the skill, not in a plugin-root CLAUDE.md.

## Pipeline architecture (what the plugin does when installed elsewhere)

```
prompt → hooks/user-prompt-submit.js (fast filter, no LLM)
       → <issue-runner-active> systemMessage → Skill(issue-runner-orchestration)
       → Phase A: intent-classifier (Haiku)   — CONVERSATION / NEW_ISSUE / EXISTING_ISSUE_N / MULTI / UNCLEAR
       → Phase B: prompt-splitter (Haiku)     — only if MULTI, capped at config.maxParallelFeatures (default 3)
       → per feature, Phases 1-9:
           1 prompt-optimizer (Haiku)  → structured spec JSON
           2 risk-analyzer (Sonnet)    → risk report JSON, may gate on user confirmation
           3 setup: gh-broker.js creates issue + branch, state.js initializes state
           4 implementer (Sonnet, worktree isolation, never commits)
           5 regression-checker (Sonnet, read-only) — pass/concerns/block
           6 test-writer (Sonnet) + orchestrator runs the actual test command
              (config.testCommand override, else auto-detected from lockfiles/manifests — see SKILL.md Phase 6 table)
           7 PR creation (gh-broker.js, commits happen only inside the worktree)
           8 pr-reviewer (Sonnet) — approve/comment_only/request_changes
           9 merge — always gated behind explicit user confirmation
```

Each agent's `.md` file is a strict I/O contract: a fixed input (prior agents' JSON outputs) and **one JSON block as the only output**, no prose. When editing an agent, preserve this contract — downstream agents and the orchestrator skill parse the JSON directly.

State persists per-issue in the *target* repo at `.claude/runner-state/issue-<N>/state.json` (schema documented at the top of `lib/state.js`), written exclusively via `node lib/state.js <command> ...` (never edited by hand — the orchestrator shells out to it via the Bash tool and parses its JSON stdout).

## Per-project configuration

Any target repo can drop a `.claude/issue-runner.config.json` to override defaults without touching the plugin: `baseBranch`, `issueLabels`, `mergeStrategy`, `maxParallelFeatures`, `maxRetriesPerPhase`, `testCommand`. See `lib/config.js` for the full default object — it's the single source of truth for what's configurable. Missing or invalid config silently falls back to defaults; never make the pipeline hard-fail on a bad config file.

## Editing conventions

- **Agents** (`plugins/issue-runner/agents/*.md`): frontmatter needs `name`, `description`, `model`, `color`, `tools`. Keep each agent's scope narrow — e.g. `regression-checker` never runs tests, `test-writer` never touches production code, `implementer` never commits. Don't widen an agent's `tools:` list beyond what its one job needs.
- **The skill** (`skills/issue-runner-orchestration/SKILL.md`): this is the orchestration source of truth (Phase A, B, 1-9). Its "Règles d'or" and "Anti-patterns" sections at the bottom encode hard constraints (retries capped at `config.maxRetriesPerPhase`, no auto-commit/merge without user confirmation, parallel MULTI cycles capped at `config.maxParallelFeatures`, must persist state between phases, never guess a test command) — respect them when modifying phase logic.
- **Hook** (`hooks/user-prompt-submit.js`): must always exit 0 and always emit valid JSON on stdout (`{ continue, systemMessage? }`), even on internal error — Claude Code blocks the prompt otherwise. Keep it LLM-free and fast; any semantic classification belongs in `intent-classifier`, not the hook.
- **Node libs** (`lib/*.js`): each is both a CLI (`if (require.main === module)`) and an importable module. CLI commands print JSON to stdout and `process.exit(1)` on failure (never throw a raw stack trace) — the caller is an LLM parsing stdout, not a human reading a traceback. `gh-broker.js` never throws on a failed `gh` call either; it returns `{ error }` so the orchestrator can branch.

## Validating changes

No test suite exists. Sanity-check edits with:

```bash
# JSON manifests parse
python3 -m json.tool .claude-plugin/marketplace.json > /dev/null
python3 -m json.tool plugins/issue-runner/.claude-plugin/plugin.json > /dev/null
python3 -m json.tool plugins/issue-runner/hooks/hooks.json > /dev/null

# Node scripts at least parse/load
node --check plugins/issue-runner/hooks/user-prompt-submit.js
node --check plugins/issue-runner/lib/state.js
node --check plugins/issue-runner/lib/gh-broker.js
node --check plugins/issue-runner/lib/config.js

# Exercise the CLI against a scratch dir
tmp=$(mktemp -d)
node plugins/issue-runner/lib/state.js init --issue 1 --title "test" --branch "runner/issue-1-test" --repo-root "$tmp"
node plugins/issue-runner/lib/state.js list-active --repo-root "$tmp"
echo '{"prompt":"a very short prompt over twenty chars for testing"}' | node plugins/issue-runner/hooks/user-prompt-submit.js
```

For local install/manual testing of the plugin itself:

```bash
claude /plugin marketplace add .
claude /plugin install issue-runner
```

## Project state

Per the README's "État de construction": Build-1 through Build-4 (fast filter, all 8 agents, orchestration skill — no separate orchestrator code, orchestration is entirely skill-driven) and Build-6 (PowerShell → Node.js port, per-project config, generalized test-stack detection) are done. Build-5 (validation on a real project) is outstanding. GitHub (`gh` CLI) is the only issue backend in v1; a Linear/Jira `IssueBroker` abstraction is a stated future extension point, not yet built.
