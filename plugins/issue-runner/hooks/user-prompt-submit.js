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
Le plugin issue-runner s'est déclenché sur ce prompt parce qu'il n'a pas été
écarté par les fast filters (longueur >= 20, pas de slash command, pas une
question pure, pas un mot de transition).

AVANT TOUTE AUTRE ACTION sur ce prompt, invoque le skill
\`issue-runner-orchestration\` via le tool Skill. Ce skill contient la doctrine
complète d'orchestration (Phase A -> Phase 9). Suis-la strictement.

Si pour une raison technique le skill n'est pas disponible, repli sur :
  - Tool Agent avec \`\${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md\`
  - Brancher selon la decision JSON retournee.
</issue-runner-active>`;

    writeOutput({ continue: true, systemMessage: msg });
  } catch (err) {
    writeOutput({ continue: true, systemMessage: `issue-runner hook error: ${err.message}` });
  }
}

main();
process.exit(0);
