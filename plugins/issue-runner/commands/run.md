---
description: Manually launches the issue-runner pipeline on the given prompt. Serves as a fallback when the auto-trigger hook is disabled, didn't detect the need, or when the user explicitly wants to force the pipeline.
---

The user invokes you via `/run <description of the work>`. You manually trigger the issue-runner pipeline.

## Procedure

1. **Grab the arguments**: everything after `/run` is the effective user prompt. If empty, ask the user "What work do you want to run the runner on?" and use their reply.

2. **Simulate the hook trigger**: mentally add `<issue-runner-active>` to the context, invoke the `issue-runner-orchestration` skill via the Skill tool, and **follow its doctrine exactly**, starting at Phase A (intent-classifier).

3. **Differences from automatic triggering**:
   - You can **force the intent-classifier's decision** if the user specified the type in their `/run`. Examples:
     - `/run --new "add the venue field"` → forces `decision: NEW_ISSUE`
     - `/run --issue 42 "fix the bug"` → forces `decision: EXISTING_ISSUE_42`
     - `/run --multi "add X and fix Y"` → forces `decision: MULTI`
   - Without a flag → let the intent-classifier decide normally.

4. **Notify the user** that the runner was launched manually and is now in pipeline mode.

## Notes

- The flag is optional; without one, behavior is identical to automatic triggering.
- If the user calls `/run` while a pipeline is already active (see `node "${CLAUDE_PLUGIN_ROOT}/lib/state.js" list-active`), ask "A pipeline is already running for issue #N (phase: X). Do you want to: (a) start another one in parallel, (b) resume this one, (c) cancel?"
