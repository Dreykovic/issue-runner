# issue-runner — README technique

> ℹ️ **Ce fichier est de la documentation, pas du code orchestrateur.**
> La doctrine d'orchestration vit dans `skills/issue-runner-orchestration/SKILL.md` —
> c'est ce skill qui est auto-découvert par Claude Code et qui contient les
> instructions complètes du pipeline.

## Pourquoi un skill et pas un CLAUDE.md plugin

Claude Code ne charge automatiquement que :
- Le `CLAUDE.md` du **projet** dans lequel tu travailles (cwd)
- Les **skills** des plugins installés (auto-discovery dans `skills/<name>/SKILL.md`)
- Les **commands** des plugins (auto-discovery dans `commands/<name>.md`)
- Les **agents** des plugins (auto-discovery dans `agents/<name>.md`)

Un `CLAUDE.md` placé à la racine d'un plugin n'est PAS chargé. Pour avoir des
instructions "always available" qui pilotent Claude main, il faut un Skill.

## Architecture du plugin

```
issue-runner/
├── .claude-plugin/
│   └── plugin.json                manifeste (name, description, author)
├── hooks/
│   ├── hooks.json                 déclare le hook UserPromptSubmit
│   └── user-prompt-submit.js      fast filter (<100ms, sans LLM, Node.js)
├── skills/
│   └── issue-runner-orchestration/
│       └── SKILL.md               doctrine d'orchestration COMPLÈTE
├── agents/                        8 agents .md, invocables via Agent tool
│   ├── intent-classifier.md
│   ├── prompt-optimizer.md
│   ├── prompt-splitter.md
│   ├── risk-analyzer.md
│   ├── implementer.md
│   ├── regression-checker.md
│   ├── test-writer.md
│   └── pr-reviewer.md
├── commands/
│   └── run.md                     slash /run (fallback manuel)
├── lib/
│   ├── config.js                  lecture .claude/issue-runner.config.json (repo cible)
│   ├── state.js                   gestion .claude/runner-state/ (CLI Node)
│   └── gh-broker.js               wrapper gh CLI (CLI Node)
└── README.md
```

Le plugin est écrit en Node.js pur (aucune dépendance npm) pour être installable tel quel sur n'importe quel projet, indépendamment de l'OS — seuls `node` et `gh` (authentifié) doivent être sur le PATH du repo cible.

## Comment ça s'active

1. **L'utilisateur tape un prompt** → Claude Code transmet l'événement `UserPromptSubmit`.
2. **Le hook `user-prompt-submit.js` tourne** (≤100 ms, fast filter sans LLM) :
   - Soit il écarte (prompt trop court, slash command, question pure…) → `{continue: true}`
   - Soit il injecte `<issue-runner-active>` en `systemMessage`
3. **Claude main reçoit le `systemMessage`**. Le skill `issue-runner-orchestration` est dans
   sa liste de skills disponibles ; il l'invoque via le tool Skill pour charger la doctrine.
4. **Claude main suit la doctrine** : Phase A → B → 1 → … → 9, en spawnant les agents
   du plugin et en appelant les libs Node.js (`lib/*.js`) via le tool Bash.

## Voir aussi

- `skills/issue-runner-orchestration/SKILL.md` — pipeline complet, invocations, gates utilisateur
- `agents/*.md` — chacun des 8 agents avec son rôle, son schéma I/O, ses anti-patterns
- `hooks/user-prompt-submit.js` — logique du fast filter
- `lib/*.js` — config, gestion d'état, wrapper gh CLI (CLI Node, JSON sur stdout)

## Coût ordre de grandeur (v1)

~$0.20–$0.50 par pipeline complet (Haiku pour les phases légères, Sonnet pour
les phases lourdes). Les phases gates utilisateur ne coûtent rien (juste de l'attente).
