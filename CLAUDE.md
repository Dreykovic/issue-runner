# issue-runner — instructions Claude

Ce fichier est chargé dans le contexte de Claude Code quand le plugin `issue-runner` est actif. Il décrit comment interpréter les sorties du hook et orchestrer les agents.

## Quand tu vois `<issue-runner-active>` dans un system message

Le hook `UserPromptSubmit` a déterminé que le prompt mérite l'attention du runner. **AVANT toute autre action** sur ce prompt, tu dois :

1. **Invoquer l'agent `intent-classifier`** via le tool Agent.
   - `subagent_type` : `general-purpose` (l'agent est défini dans `${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md` — relais ses instructions au sous-agent)
   - `prompt` : transmets le prompt utilisateur ainsi que l'instruction "Lis MEMORY.md, CLAUDE.md du repo courant, exécute `gh issue list --state open --limit 30 --json number,title,labels,body`, et produis ta décision JSON conforme à `agents/intent-classifier.md`."

2. **Lire sa réponse JSON** et la parser.

3. **Brancher selon `decision`** :

| `decision` | Ton comportement |
|---|---|
| `CONVERSATION` | Ignore le runner, réponds normalement au prompt utilisateur |
| `NEW_ISSUE` | Lance le pipeline complet (voir ci-dessous) |
| `EXISTING_ISSUE_N` | Checkout sur la branche `runner/issue-N-*` (la créer depuis main si elle n'existe pas), reprendre le pipeline à la phase de l'état |
| `MULTI` | Spawn N pipelines en parallèle via Agent, un par entrée de `features[]` |
| `UNCLEAR` | Demande explicitement à l'utilisateur via AskUserQuestion : "S'agit-il d'une nouvelle issue à gérer ?" |

## Le pipeline complet (NEW_ISSUE / EXISTING_ISSUE)

Pour chacune des phases, mets à jour `.claude/runner-state/issue-<N>/state.json` via `Update-RunnerStatePhase` (lib/state.ps1).

**Phase 0 — Setup** *(NEW_ISSUE uniquement)*
- Créer l'issue GitHub : `New-RunnerIssue -Title ... -Body ...` (lib/gh-broker.ps1)
- Créer la branche : `New-RunnerBranch -IssueNumber N -Slug ...`
- Initialiser l'état : `Initialize-RunnerState`

**Phase 1 — Optimize**
- Invoquer agent `prompt-optimizer` (Build-2)
- Stocker le prompt optimisé en artifact

**Phase 2 — Risk analysis**
- Invoquer agent `risk-analyzer` (Build-2)
- Si risque élevé → demander confirmation utilisateur avant de continuer

**Phase 3 — Implementation**
- Invoquer agent `implementer` (Build-2) avec `isolation: worktree`
- Récupérer le diff en artifact

**Phase 4 — Regression check**
- Invoquer agent `regression-checker` (Build-3)
- Si régression détectée → renvoyer à implementer avec les findings

**Phase 5 — Tests**
- Invoquer agent `test-writer` (Build-2) pour écrire les tests
- Exécuter `pnpm test` ou `flutter test` selon le contexte (détecté via fichiers du repo)
- Si tests rouges → renvoyer à implementer

**Phase 6 — PR**
- `New-RunnerPullRequest -IssueNumber N -Title ... -Body ...`
- Stocker l'URL PR en artifact

**Phase 7 — Review**
- Invoquer agent `pr-reviewer` (Build-3, peut réutiliser plugin `code-review`)
- Si review négative → renvoyer à implementer

**Phase 8 — Merge**
- **Toujours demander confirmation utilisateur** avant `Merge-RunnerPullRequest` en v1
- Marquer l'état comme `done`

## Règles d'or

1. **Une seule étape à la fois** dans le state.json (sauf MULTI où c'est N pipelines indépendants).
2. **Aucun commit automatique** sans validation utilisateur — toute écriture passe par worktree, l'utilisateur valide le diff.
3. **Si une phase échoue**, ne pas boucler indéfiniment — au bout de 2 tentatives, marquer l'état `failed` et remonter à l'utilisateur.
4. **Si l'utilisateur interrompt** avec un nouveau prompt, sauvegarder l'état courant avant de basculer.

## Quand tu NE vois PAS `<issue-runner-active>`

Le hook a écarté le prompt par fast filter. Comporte-toi normalement, ignore tout ce fichier.
