#!/usr/bin/env node
/**
 * Config loader for issue-runner.
 *
 * Reads optional `.claude/issue-runner.config.json` from the target repo and
 * merges it over defaults. Every field is optional; the plugin works with
 * zero config. Used by state.js, gh-broker.js, and referenced by the
 * orchestration skill for things it decides directly (test command, base
 * branch, labels, merge strategy, parallelism cap).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  baseBranch: 'main',
  issueLabels: ['issue-runner'],
  mergeStrategy: 'squash', // merge | squash | rebase
  maxParallelFeatures: 3,
  maxRetriesPerPhase: 2,
  // Explicit override. If null, the orchestrator auto-detects from repo files
  // (see docs/test-detection.md).
  testCommand: null,
};

function getConfigPath(repoRoot) {
  return path.join(repoRoot, '.claude', 'issue-runner.config.json');
}

function loadConfig(repoRoot = process.cwd()) {
  const configPath = getConfigPath(repoRoot);
  let userConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      // Invalid config must never crash the pipeline; fall back to defaults.
      process.stderr.write(
        `issue-runner: warning, could not parse ${configPath}: ${err.message}\n`
      );
      userConfig = {};
    }
  }
  return { ...DEFAULTS, ...userConfig };
}

module.exports = { loadConfig, getConfigPath, DEFAULTS };

if (require.main === module) {
  const repoRoot = process.argv[2] || process.cwd();
  process.stdout.write(JSON.stringify(loadConfig(repoRoot), null, 2) + '\n');
}
