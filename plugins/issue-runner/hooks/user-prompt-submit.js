#!/usr/bin/env node
/**
 * UserPromptSubmit hook for issue-runner.
 *
 * Fast filter (no LLM call, must stay well under a second) that decides
 * whether a prompt is worth triggering the issue-runner pipeline. If so,
 * injects a systemMessage telling Claude to invoke the
 * issue-runner-orchestration skill before doing anything else.
 *
 * Input  (stdin)  : JSON Claude Code hook event { prompt, session_id, cwd, ... }
 * Output (stdout) : JSON { continue, systemMessage? }
 *
 * This script MUST always exit 0 — a non-zero exit blocks the user's
 * prompt. Any internal error is swallowed and surfaced as an optional
 * systemMessage instead.
 */
'use strict';

function writeOutput(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function readStdin() {
  try {
    const fs = require('fs');
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const TRANSITION_WORDS = new Set([
  'oui', 'non', 'ok', 'okay', 'continue', 'continuer', 'retry',
  'merci', 'parfait', 'super', "d'accord", 'stop', 'attend', 'attends',
  'yes', 'no', 'go', 'proceed', 'wait', 'pause',
]);

const QUESTION_STARTERS = new Set([
  'quoi', 'qui', 'comment', 'pourquoi', 'quand', 'où',
  'what', 'who', 'how', 'why', 'when', 'where', 'est-ce', 'peux-tu',
]);

function main() {
  try {
    const raw = readStdin();
    if (!raw || !raw.trim()) {
      writeOutput({ continue: true });
      return;
    }

    const input = JSON.parse(raw);
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!prompt.trim()) {
      writeOutput({ continue: true });
      return;
    }

    const trimmed = prompt.trim();
    const len = trimmed.length;

    // ── Fast filters: skip without an LLM call ──────────────────────────

    if (len < 20) {
      writeOutput({ continue: true });
      return;
    }

    if (trimmed.startsWith('/')) {
      writeOutput({ continue: true });
      return;
    }

    if (TRANSITION_WORDS.has(trimmed.toLowerCase())) {
      writeOutput({ continue: true });
      return;
    }

    const endsWithQuestion = trimmed.endsWith('?');
    const firstWord = trimmed.split(/\s+/, 1)[0].toLowerCase().replace(/[,:;]+$/, '');
    if (endsWithQuestion && QUESTION_STARTERS.has(firstWord)) {
      writeOutput({ continue: true });
      return;
    }

    // ── Not filtered out → ask Claude to invoke the classifier ──────────

    const msg = `<issue-runner-active>
The issue-runner plugin triggered on this prompt because it wasn't dismissed
by the fast filters (length >= 20, not a slash command, not a pure question,
not a transition word).

BEFORE ANY OTHER ACTION on this prompt, invoke the
\`issue-runner-orchestration\` skill via the Skill tool. That skill contains
the complete orchestration doctrine (Phase A -> Phase 9). Follow it strictly.

If for some technical reason the skill isn't available, fall back to:
  - The Agent tool with \`\${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md\`
  - Branch based on the returned JSON decision.
</issue-runner-active>`;

    writeOutput({ continue: true, systemMessage: msg });
  } catch (err) {
    writeOutput({ continue: true, systemMessage: `issue-runner hook error: ${err.message}` });
  }
}

main();
process.exit(0);
