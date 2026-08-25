# issue-runner

Pipeline Claude Code auto-déclenché qui industrialise le workflow de développement : à chaque prompt non-trivial, une suite d'agents spécialisés analyse, optimise, implémente, teste, ouvre une PR et review — sans intervention manuelle.

## Vision

> *"Pour chaque prompt, si une issue existe déjà pour le travail à faire, le runner attaque l'issue, crée la branche dédiée, et à la fin crée une pull request et fait la review avant de merger. Entre temps, avant même qu'il ne commence, un agent optimise mon prompt, un autre analyse les risques de régression possibles, après implémentation un agent check s'il n'y a pas de régressions, un agent écrit les tests unitaires, un autre les exécute, puis si tout va bien on passe au PR."*

## Pipeline

```
Prompt utilisateur
   │
   ▼
[Fast filter, hook Node.js, <100ms]
   ├── skip → réponse normale Claude
   └── candidat
       │
       ▼
[intent-classifier — agent LLM Haiku, ~1-2s]
   │
   ├── CONVERSATION    → réponse normale
   ├── NEW_ISSUE       → pipeline complet
   ├── EXISTING_ISSUE_N → pipeline branché sur #N
   ├── MULTI           → N pipelines parallèles
   └── UNCLEAR         → demande à l'utilisateur
       │
       ▼ (pour les cas pipeline)
[prompt-optimizer] → reformule le prompt
       │
       ▼
[risk-analyzer] → analyse régression amont
       │
       ▼
[issue-broker] → create/find issue + branch
       │
       ▼
[implementer] (worktree, peut spawn sous-implementers pour multi-feature)
       │
       ▼
[regression-checker] → relit le diff
       │
       ▼
[test-writer] → unit tests
       │
       ▼
[test runner] → pnpm test / flutter test / etc.
       │
       ▼
[pr-reviewer] → review de la PR
       │
       ▼
[merge si vert]
```

## Structure du plugin

```
issue-runner/
├── .claude-plugin/
│   └── plugin.json              manifeste
├── hooks/
│   ├── hooks.json               déclare UserPromptSubmit
│   └── user-prompt-submit.js    fast filter (sans LLM, <100ms)
├── agents/
│   ├── intent-classifier.md     décide run/skip/ask
│   ├── prompt-optimizer.md      (Build-2)
│   ├── risk-analyzer.md         (Build-2)
│   ├── implementer.md           (Build-2)
│   ├── test-writer.md           (Build-2)
│   ├── regression-checker.md    (Build-3)
│   ├── pr-reviewer.md           (Build-3)
│   └── prompt-splitter.md       (Build-3)
├── commands/
│   └── run.md                   slash command de secours
├── skills/
│   └── issue-runner-orchestration/SKILL.md   doctrine d'orchestration complète
└── lib/
    ├── config.js                lecture de .claude/issue-runner.config.json
    ├── state.js                 gestion de .claude/runner-state/
    └── gh-broker.js             wrapper gh CLI
```

## Cross-platform

Le plugin est écrit en **Node.js pur** (aucune dépendance npm), pas en PowerShell : il tourne à l'identique sur Linux, macOS et Windows dès que `node` et `gh` (authentifié) sont sur le PATH. C'est ce qui le rend installable sur n'importe lequel de tes projets, quel que soit l'OS de la machine.

## Configuration par projet

Optionnel : dépose un `.claude/issue-runner.config.json` à la racine du repo cible pour ajuster le comportement sans toucher au plugin :

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

`testCommand` permet de forcer la commande de test (utile en monorepo) au lieu de laisser l'orchestrateur détecter le stack (npm/pnpm/yarn/bun, pytest, cargo, go test, rspec, maven/gradle, dotnet, flutter…) — voir Phase 6 du skill.

## Installation (locale, dev)

Le plugin n'est pas encore publié. Pour l'installer en local sur n'importe quel projet :

```bash
# Ajouter comme marketplace local Claude Code (une seule fois)
claude /plugin marketplace add /chemin/vers/issue-runner

# Dans chaque projet où tu veux l'utiliser :
claude /plugin install issue-runner
```

## État de construction

- [x] Build-1 — Fondations (hook fast filter, intent-classifier agent, lib state/gh)
- [x] Build-2 — Agents core (optimizer, risk, implementer, test-writer)
- [x] Build-3 — Agents qualité (regression-checker, pr-reviewer, prompt-splitter)
- [x] Build-4 — Orchestration & parallélisme multi-feature (doctrine dans SKILL.md, pas de code orchestrateur séparé)
- [x] Build-6 — Portage cross-platform (PowerShell → Node.js) + config par projet + détection de stack généralisée pour Phase 6
- [ ] Build-5 — Validation sur un projet réel

## Backend issues

GitHub seul pour v1 (via `gh` CLI). Linear/Jira ajoutables ultérieurement derrière une abstraction `IssueBroker`.

## Décisions de design

- **Auto-déclenchement via hook `UserPromptSubmit`** : seule façon d'avoir un vrai trigger automatique sans commande manuelle.
- **Fast filter sans LLM dans le hook** : <100ms par prompt, coût zéro. La décision fine est déléguée à l'agent `intent-classifier`.
- **Business-logic-aware** : le classifier lit MEMORY.md, CLAUDE.md et les issues ouvertes avant de trancher. Pas de simples regex sur des verbes d'action.
- **Multi-feature : split silencieux** par défaut.
- **Pas de commit/merge automatique en v1** sans validation utilisateur explicite — sécurité d'abord.
