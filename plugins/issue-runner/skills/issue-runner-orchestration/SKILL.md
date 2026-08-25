---
name: issue-runner-orchestration
description: Use this skill when you see `<issue-runner-active>` in a system message, OR when the user invokes `/run`, OR whenever you need to orchestrate the issue-runner pipeline (intent classification, prompt optimization, risk analysis, implementation in worktree, regression check, tests, PR creation, review, merge). This skill contains the complete orchestration doctrine for the issue-runner plugin.
version: 2.0.0
---

# issue-runner — orchestration

You are now in `issue-runner` orchestrator mode. You MUST follow this doctrine **before any other action on the user prompt** as soon as you see `<issue-runner-active>` in a system message, or when the user invokes `/run`.

> ⚠️ If you were NOT activated (no marker, no /run invocation), ignore this skill entirely.

This plugin is **cross-platform** (Node.js, no OS dependency) and **stack-agnostic** for the target project. It installs into any repo; the only prerequisites are `node` and `gh` (authenticated) on PATH.

---

## Pipeline overview

```
        user prompt
                │
        [fast-filter hook] (≤100 ms)
                │
        <issue-runner-active>
                │
                ▼
   ┌──────────────────────────┐
   │  Phase A: intent-classifier
   └──────────────────────────┘
                │
       CONVERSATION → normal response, STOP
       UNCLEAR → asks the user, then branches
       MULTI → split (Phase B) then N parallel pipelines
       NEW_ISSUE / EXISTING_ISSUE → sequential pipeline
                │
                ▼
   ┌──────────────────────────┐
   │  Phase B: prompt-splitter (MULTI only)
   └──────────────────────────┘
                │
                ▼  (for each feature, or the single feature)
   ┌──────────────────────────┐
   │  Phase 1: prompt-optimizer
   │  Phase 2: risk-analyzer
   │  Phase 3: setup issue + branch + worktree
   │  Phase 4: implementer
   │  Phase 5: regression-checker
   │  Phase 6: test-writer + run tests
   │  Phase 7: create PR
   │  Phase 8: pr-reviewer
   │  Phase 9: merge (with user confirmation)
   └──────────────────────────┘
```

Persist state after every phase in `.claude/runner-state/issue-<N>/state.json` in the **target repo**, via `node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" <command> ...` (Bash tool). Every output of `state.js` and `gh-broker.js` is JSON on stdout — parse it to branch.

---

## Per-project configuration (optional)

Before Phase A, if a `.claude/issue-runner.config.json` file exists in the target repo, load it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/config.js"
```

Supported fields (all optional, defaults in parentheses):

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

- `baseBranch`: branch to create runner branches from and target PRs at.
- `issueLabels`: labels applied to issues created by the runner.
- `mergeStrategy`: `merge` | `squash` | `rebase`, used by default in Phase 9.
- `maxParallelFeatures`: cap on the number of parallel MULTI cycles.
- `maxRetriesPerPhase`: number of retries before `failed`.
- `testCommand`: if set, **overrides** the automatic stack detection in Phase 6 (useful for a monorepo or a non-standard command, e.g. `"pnpm --filter api test"`).

If the file doesn't exist or is invalid, the defaults above apply silently — the plugin works with zero config.

---

## Phase A — intent-classifier

**When**: immediately after seeing `<issue-runner-active>`.

**How to invoke it**:
```
Agent(
  subagent_type: "general-purpose",
  description: "Classify user intent for issue-runner",
  prompt: """
You are the `intent-classifier` agent of the issue-runner plugin. Strictly follow
the instructions in ${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md.

USER PROMPT TO CLASSIFY:
\"\"\"
<the original user prompt, verbatim>
\"\"\"

Read MEMORY.md (auto-memory path), the current repo's CLAUDE.md (if present),
then run `gh issue list --state open --limit 30 --json number,title,labels,body`.

Also list active runner states with:
  node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" list-active
to detect work already in progress.

Produce ONLY the JSON block matching the schema defined in your agent .md.
"""
)
```

**Output**: JSON `{decision, matched_issue, features, reasoning, confidence}`.

**Immediate branching**:
- `CONVERSATION` → ignore the runner, handle the prompt normally. STOP.
- `UNCLEAR` → `AskUserQuestion`: "The runner is unsure: is this a new issue to handle?" with options {Yes, new one, Yes, existing issue #N, No, just discussion}. Force the decision based on the answer.
- `MULTI` → go to Phase B.
- `NEW_ISSUE` → go to Phase 1 with a single cycle.
- `EXISTING_ISSUE_<N>` → go to Phase 3-bis (resume), see below.

---

## Phase B — prompt-splitter (if MULTI)

**How to invoke it**:
```
Agent(
  subagent_type: "general-purpose",
  description: "Split multi-feature prompt",
  prompt: """
You are the `prompt-splitter` agent (see ${CLAUDE_PLUGIN_ROOT}/agents/prompt-splitter.md).

USER PROMPT:
\"\"\"
<the original prompt>
\"\"\"

INTENT-CLASSIFIER DECISION:
<intent-classifier JSON pasted here>

Produce the JSON matching your schema.
"""
)
```

**If** `is_multi_feature: false` (the splitter changed its mind) → treat as a single NEW_ISSUE.

**Otherwise**: for each entry in `features[]`, launch a full Phases 1→9 cycle **in parallel** (one Agent tool call per feature, in parallel) if `split_strategy: parallel`. If `sequential`, run in series respecting `depends_on`.

> ⚠️ Cap the number of simultaneous parallel cycles at the config's `maxParallelFeatures` (3 by default) to avoid saturating context. If N exceeds the cap, batch in groups.

---

## Phase 1 — prompt-optimizer

**Invocation**:
```
Agent(
  subagent_type: "general-purpose",
  description: "Optimize prompt into spec",
  prompt: """
You are the `prompt-optimizer` agent (see ${CLAUDE_PLUGIN_ROOT}/agents/prompt-optimizer.md).

PROMPT (raw, or prompt_subset if MULTI):
\"\"\"
<...>
\"\"\"

Produce the JSON spec matching your schema.
"""
)
```

**Persistence**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" set-artifact --issue <N> --key spec --value '<spec_json>'
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" update-phase --issue <N> --phase optimize --agent prompt-optimizer --result ok
```

**User gate**: if the spec has non-empty `open_questions[]` AND `estimated_complexity` ≥ `medium`, **ask the user** to answer the questions before Phase 2.

---

## Phase 2 — risk-analyzer

**Invocation**: same pattern, pass Phase 1's `spec` as input.

**Persistence**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" set-artifact --issue <N> --key risk_analysis --value '<risk_json>'
```

**User gate**: if `needs_user_confirmation: true` in the report → `AskUserQuestion` showing `overall_risk_level`, `confirmation_reason`, and the list of `high+` risks. Options: {Continue, Revise the spec, Abort}.

---

## Phase 3 — setup (issue + branch + worktree)

**If NEW_ISSUE**:
```bash
slug=$(node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" slug --title "<spec.objective>" | jq -r .slug)
issue=$(node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" create-issue --title "<spec.objective>" --body "<spec + risks summary>")
issueNumber=$(echo "$issue" | jq -r .number)
branch=$(node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" create-branch --issue "$issueNumber" --slug "$slug" | jq -r .branch)
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" init --issue "$issueNumber" --title "<spec.objective>" --branch "$branch"
```

(If `jq` isn't available on the machine, parse the JSON yourself from the command's stdout — it's always a single JSON object.)

**If EXISTING_ISSUE_<N>**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" get-issue --number <N>
# If a runner/issue-<N>-* branch already exists (git branch --list) → check it out
# Otherwise → node lib/gh-broker.js create-branch --issue <N> --slug <slug> (from base branch)
```

**Worktree creation**: use `Agent(isolation: worktree)` later, in Phase 4. The worktree created by the Agent is ephemeral and tied to one particular agent run.

---

## Phase 4 — implementer

**Invocation**:
```
Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",
  description: "Implement feature #<N>",
  prompt: """
You are the `implementer` agent (see ${CLAUDE_PLUGIN_ROOT}/agents/implementer.md).

ISSUE: #<N> — <title>
BRANCH: <runner/issue-N-slug>

SPEC (prompt-optimizer):
<JSON>

RISK ANALYSIS (risk-analyzer):
<JSON>

Implement the work. Respect the mitigations. Do not commit. Produce the report
JSON matching your schema.
"""
)
```

**Diff retrieval**: at the end of the worktree run, capture `git diff <baseBranch>...HEAD` from the worktree and store it as the `diff` artifact.

**Retry**: if the report is `status: failed`, retry up to `maxRetriesPerPhase` times (2 by default) with the `blockers` injected into the prompt. Beyond that → `failed` state, escalate to the user.

**Persistence**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" set-artifact --issue <N> --key implementer_report --value '<json>'
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" set-artifact --issue <N> --key diff --value "$(git diff <base>...HEAD)"
```

---

## Phase 5 — regression-checker

**Invocation**: pass spec + risk + implementer_report + diff as input. No worktree (read-only).

**Branch on verdict**:
- `pass` → Phase 6
- `concerns` → `AskUserQuestion` to the user with the list of major findings. If confirmed → Phase 6. Otherwise → back to Phase 4 with the findings injected.
- `block` → mandatory return to Phase 4 with the `blocker` findings. Retry counter +1.

---

## Phase 6 — test-writer + execution

**`test-writer` invocation**: pass spec + implementer_report + regression_check_report.

The agent writes tests **inside the worktree** (reuses the Phase 4 worktree via `Agent(isolation: worktree)` at the same path if possible).

**Determining the test command**:

1. If `testCommand` is set in `.claude/issue-runner.config.json` → use it as-is.
2. Otherwise, detect the stack by inspecting files at the root of the target repo (worktree), in this order:

| Files present | Command |
|---|---|
| `pnpm-lock.yaml` | `pnpm test` |
| `yarn.lock` | `yarn test` |
| `bun.lockb` / `bun.lock` | `bun test` |
| `package-lock.json` or `package.json` (fallback) | `npm test` |
| `pubspec.yaml` | `flutter test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pytest.ini` / `pyproject.toml` with `[tool.pytest...]` / `setup.cfg` with `pytest` | `pytest` |
| `requirements.txt` without explicit pytest config | `python -m pytest` (best-effort) |
| `Gemfile` with `rspec` as a dependency | `bundle exec rspec` |
| `pom.xml` | `mvn test` |
| `build.gradle` / `build.gradle.kts` | `./gradlew test` |
| `*.csproj` / `*.sln` | `dotnet test` |

3. If no pattern matches, or in case of ambiguity (several lockfiles at the same level, monorepo), **ask the user** which command to use rather than guessing, and offer to save it to `testCommand` for next time.

**Execution**: the orchestrator runs the chosen command itself (Bash tool, inside the worktree), not the agent.

**If red**: back to Phase 4 with the failed_tests injected. Retry counter +1, up to `maxRetriesPerPhase` → `failed` state.

---

## Phase 7 — PR creation

**Invocation**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" create-pr \
  --issue <N> \
  --title "<spec.objective>" \
  --body "## Summary
<implementer's diff_summary>

## Changes
<implementer's files_modified>

## Tests
<test-writer's coverage_summary>

## Known risks
<risk-analyzer's risks, summarized>

## Notable decisions
<implementer's decisions + deviations_from_spec>"
```

**Before creating the PR**: commit the worktree's diff from the worktree (the user hasn't validated yet — that's fine, it's on a dedicated, unmerged branch). Conventional commit message: `feat:`/`fix:`/`refactor:` depending on scope.

**Persistence**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" set-artifact --issue <N> --key pr_url --value "<url>"
```

---

## Phase 8 — pr-reviewer

**Invocation**: pass all upstream artifacts + the PR number.

**Branch on verdict**:
- `approve` → Phase 9
- `comment_only` → post the inline comments, proceed to Phase 9
- `request_changes` → back to Phase 4 with the blockers. Retry counter +1.

**Posting inline comments**:
```bash
# For each inline_comment:
gh api repos/:owner/:repo/pulls/<N>/comments \
  -f path="<path>" -F line=<line> -f body="<body>" -f commit_id="<HEAD sha>"
```

---

## Phase 9 — merge

**Always** ask for user confirmation via `AskUserQuestion`:
> "PR #<N> approved by the runner. Verdict: <pr-reviewer summary>. Merge now using `<mergeStrategy>`?"
> Options: {Merge now, View the diff first, Not now}.

If "View the diff" → show `gh pr diff <N>` + ask the question again.
If "Not now" → `done_unmerged` state, the user will merge by hand.

If "Merge now":
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.js" merge-pr --number <N> --strategy <mergeStrategy>
```

**Final persistence**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" update-phase --issue <N> --phase done --agent orchestrator --result merged
```
The branch is deleted automatically by `gh pr merge --delete-branch`.

---

## Resume — EXISTING_ISSUE_<N>

When intent-classifier decides `EXISTING_ISSUE_<N>`:
1. `node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" get --issue <N>` to retrieve the persisted state
2. If a state is found → resume at `state.phase + 1`. Retrieve the artifacts from state.json so you do NOT rerun phases already done.
3. If no state exists (issue created outside the runner) → treat as NEW_ISSUE but without recreating the issue or the branch (reuse the existing ones).

---

## Orchestrator golden rules

1. **Only one active phase at a time** per pipeline. Except in MULTI, where it's N pipelines in parallel (capped at `maxParallelFeatures`).
2. **No automatic commit/merge** without explicit user confirmation in v1.
3. **Retry cap of `maxRetriesPerPhase`** (2 by default) per phase. Beyond that → `failed` state, escalate to the user with full context.
4. **If the user interrupts** with a new prompt (intent-classifier fires on the new prompt), save the current state (`update-phase --phase paused`) before switching over.
5. **Always notify the user** with a 1-line update at every phase transition. E.g.: "Phase 4: implementer started in worktree…"
6. **Cost**: ~$0.20-$0.50 per full pipeline (Haiku for intent/optimize/split, Sonnet for the rest). Keep an eye on it.
7. **Timeout per phase**: 5 min Haiku, 15 min Sonnet, 30 min implementer (worktree). Beyond that → kill + retry.
8. **Never guess a missing prerequisite**: if `gh` isn't authenticated (`node lib/gh-broker.js check` → `ghAvailable: false`) or if `node` isn't on PATH on the hook side (unlikely since you're Claude Code yourself, but check if `lib/*.js` commands fail), stop and inform the user instead of attempting a workaround.

## Anti-patterns to avoid

- ❌ Launching Phase 1 without having seen `<issue-runner-active>` (= violating the hook contract)
- ❌ Skipping a phase because it "seems easy" — every phase has its role
- ❌ Committing or pushing from Claude proper (only from the implementer's worktree)
- ❌ Merging without user confirmation
- ❌ Looping indefinitely on retry — respect `maxRetriesPerPhase`
- ❌ Ignoring `needs_user_confirmation: true` from risk-analyzer
- ❌ Mixing up pipelines in MULTI (each feature has ITS OWN state, branch, PR)
- ❌ Forgetting to persist state between phases — continuing is forbidden if the previous phase isn't marked complete in state.json
- ❌ Guessing the test command without consulting the config's `testCommand` or detecting the stack — and without asking in case of ambiguity
