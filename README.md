# issue-runner

Pipeline Claude Code auto-déclenché qui industrialise le workflow de développement : à chaque prompt non-trivial, une suite d'agents spécialisés analyse, optimise, implémente, teste, ouvre une PR et review — sans intervention manuelle.

## Vision

> *"Pour chaque prompt, si une issue existe déjà pour le travail à faire, le runner attaque l'issue, crée la branche dédiée, et à la fin crée une pull request et fait la review avant de merger. Entre temps, avant même qu'il ne commence, un agent optimise mon prompt, un autre analyse les risques de régression possibles, après implémentation un agent check s'il n'y a pas de régressions, un agent écrit les tests unitaires, un autre les exécute, puis si tout va bien on passe au PR."*

## Pipeline

```
Prompt utilisateur
   │
   ▼
[Fast filter, hook PS1, <100ms]
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
│   └── user-prompt-submit.ps1   fast filter (sans LLM, <100ms)
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
├── lib/
│   ├── state.ps1                gestion de .claude/runner-state/
│   └── gh-broker.ps1            wrapper gh CLI
└── CLAUDE.md                    instructions pour Claude quand le plugin est actif
```

## Installation (locale, dev)

Le plugin n'est pas encore publié. Pour l'installer en local :

```powershell
# Clone (si pas déjà sur la machine)
cd C:\workspace
git clone https://github.com/<user>/issue-runner.git  # à créer

# Ajouter comme marketplace local Claude Code
claude /plugin marketplace add C:\workspace\issue-runner
claude /plugin install issue-runner
```

## État de construction

- [x] Build-1 — Fondations (hook fast filter, intent-classifier agent, lib state/gh)
- [ ] Build-2 — Agents core (optimizer, risk, implementer, test-writer)
- [ ] Build-3 — Agents qualité (regression-checker, pr-reviewer, prompt-splitter)
- [ ] Build-4 — Orchestration & parallélisme multi-feature
- [ ] Build-5 — Validation sur GSPORTS

## Backend issues

GitHub seul pour v1 (via `gh` CLI). Linear/Jira ajoutables ultérieurement derrière une abstraction `IssueBroker`.

## Décisions de design

- **Auto-déclenchement via hook `UserPromptSubmit`** : seule façon d'avoir un vrai trigger automatique sans commande manuelle.
- **Fast filter sans LLM dans le hook** : <100ms par prompt, coût zéro. La décision fine est déléguée à l'agent `intent-classifier`.
- **Business-logic-aware** : le classifier lit MEMORY.md, CLAUDE.md et les issues ouvertes avant de trancher. Pas de simples regex sur des verbes d'action.
- **Multi-feature : split silencieux** par défaut.
- **Pas de commit/merge automatique en v1** sans validation utilisateur explicite — sécurité d'abord.
