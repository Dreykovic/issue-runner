# issue-runner — technical README

> ℹ️ **This file is documentation, not orchestrator code.**
> The orchestration doctrine lives in `skills/issue-runner-orchestration/SKILL.md` —
> that's the skill Claude Code auto-discovers, and it contains the complete
> pipeline instructions.

## Why a skill and not a plugin CLAUDE.md

Claude Code only auto-loads:
- The **project**'s own `CLAUDE.md` (cwd)
- Installed plugins' **skills** (auto-discovery under `skills/<name>/SKILL.md`)
- Plugins' **commands** (auto-discovery under `commands/<name>.md`)
- Plugins' **agents** (auto-discovery under `agents/<name>.md`)

A `CLAUDE.md` placed at a plugin's root is NOT loaded. To get "always available"
instructions that drive Claude proper, you need a Skill.

## Plugin architecture

```
issue-runner/
├── .claude-plugin/
│   └── plugin.json                manifest (name, description, author)
├── hooks/
│   ├── hooks.json                 declares the UserPromptSubmit hook
│   └── user-prompt-submit.js      fast filter (<100ms, no LLM, Node.js)
├── skills/
│   └── issue-runner-orchestration/
│       └── SKILL.md               COMPLETE orchestration doctrine
├── agents/                        8 agent .md files, invocable via the Agent tool
│   ├── intent-classifier.md
│   ├── prompt-optimizer.md
│   ├── prompt-splitter.md
│   ├── risk-analyzer.md
│   ├── implementer.md
│   ├── regression-checker.md
│   ├── test-writer.md
│   └── pr-reviewer.md
├── commands/
│   └── run.md                     slash /run (manual fallback)
├── lib/
│   ├── config.js                  reads .claude/issue-runner.config.json (target repo)
│   ├── state.js                   manages .claude/runner-state/ (Node CLI)
│   └── gh-broker.js               gh CLI wrapper (Node CLI)
└── README.md
```

The plugin is written in pure Node.js (no npm dependency) so it's installable as-is on any project, regardless of OS — only `node` and `gh` (authenticated) need to be on the target repo's PATH.

## How it activates

1. **The user types a prompt** → Claude Code fires the `UserPromptSubmit` event.
2. **The `user-prompt-submit.js` hook runs** (≤100 ms, no-LLM fast filter):
   - Either it dismisses (prompt too short, slash command, pure question…) → `{continue: true}`
   - Or it injects `<issue-runner-active>` as a `systemMessage`
3. **Claude proper receives the `systemMessage`**. The `issue-runner-orchestration` skill is in
   its list of available skills; it invokes it via the Skill tool to load the doctrine.
4. **Claude proper follows the doctrine**: Phase A → B → 1 → … → 9, spawning the plugin's
   agents and calling the Node.js libs (`lib/*.js`) via the Bash tool.

## See also

- `skills/issue-runner-orchestration/SKILL.md` — the full pipeline, invocations, user gates
- `agents/*.md` — each of the 8 agents with its role, I/O schema, anti-patterns
- `hooks/user-prompt-submit.js` — fast-filter logic
- `lib/*.js` — config, state management, gh CLI wrapper (Node CLI, JSON on stdout)

## Order-of-magnitude cost (v1)

~$0.20–$0.50 per full pipeline run (Haiku for light phases, Sonnet for
heavy phases). User-gate phases cost nothing (just waiting time).
