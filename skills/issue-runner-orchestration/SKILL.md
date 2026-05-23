---
name: issue-runner-orchestration
description: Use this skill when you see `<issue-runner-active>` in a system message, OR when the user invokes `/run`, OR whenever you need to orchestrate the issue-runner pipeline (intent classification, prompt optimization, risk analysis, implementation in worktree, regression check, tests, PR creation, review, merge). This skill contains the complete orchestration doctrine for the issue-runner plugin.
version: 1.0.0
---

# issue-runner — orchestration

Tu es maintenant en mode orchestrateur `issue-runner`. Tu DOIS suivre cette doctrine **avant toute autre action sur le prompt utilisateur** dès que tu vois `<issue-runner-active>` dans un system message, ou quand l'utilisateur invoque `/run`.

> ⚠️ Si tu N'AS PAS été activé (pas de marqueur, pas d'invocation /run), ignore complètement ce skill.

---

## Vue d'ensemble du pipeline

```
        prompt utilisateur
                │
        [hook fast filter] (≤100 ms)
                │
        <issue-runner-active>
                │
                ▼
   ┌──────────────────────────┐
   │  Phase A : intent-classifier
   └──────────────────────────┘
                │
       CONVERSATION → réponse normale, STOP
       UNCLEAR → demande à l'utilisateur, puis branche
       MULTI → split (Phase B) puis N pipelines parallèles
       NEW_ISSUE / EXISTING_ISSUE → pipeline séquentiel
                │
                ▼
   ┌──────────────────────────┐
   │  Phase B : prompt-splitter (si MULTI uniquement)
   └──────────────────────────┘
                │
                ▼  (pour chaque feature OU pour la feature unique)
   ┌──────────────────────────┐
   │  Phase 1 : prompt-optimizer
   │  Phase 2 : risk-analyzer
   │  Phase 3 : setup issue + branch + worktree
   │  Phase 4 : implementer
   │  Phase 5 : regression-checker
   │  Phase 6 : test-writer + run tests
   │  Phase 7 : create PR
   │  Phase 8 : pr-reviewer
   │  Phase 9 : merge (avec confirmation utilisateur)
   └──────────────────────────┘
```

Persiste l'état après chaque phase dans `.claude/runner-state/issue-<N>/state.json` via les fonctions de `${CLAUDE_PLUGIN_ROOT}/lib/state.ps1`.

---

## Phase A — intent-classifier

**Quand** : immédiatement après avoir vu `<issue-runner-active>`.

**Comment l'invoquer** :
```
Agent(
  subagent_type: "general-purpose",
  description: "Classify user intent for issue-runner",
  prompt: """
Tu es l'agent `intent-classifier` du plugin issue-runner. Suis strictement les
instructions de ${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md.

PROMPT UTILISATEUR À CLASSIFIER :
\"\"\"
<le prompt utilisateur original, verbatim>
\"\"\"

Lis MEMORY.md (chemin auto-memory), CLAUDE.md du repo courant (si présent),
puis exécute `gh issue list --state open --limit 30 --json number,title,labels,body`.

Liste également les états runner actifs avec `Get-ActiveRunnerStates` (lib/state.ps1)
pour détecter les issues en cours.

Produis EXCLUSIVEMENT le bloc JSON conforme au schéma défini dans ton agent .md.
"""
)
```

**Output** : JSON `{decision, matched_issue, features, reasoning, confidence}`.

**Branchement immédiat** :
- `CONVERSATION` → ignore le runner, traite le prompt normalement. STOP.
- `UNCLEAR` → `AskUserQuestion` : "Le runner hésite : s'agit-il d'une nouvelle issue à gérer ?" avec options {Oui nouvelle, Oui issue #N existante, Non discussion}. Selon réponse, force la décision.
- `MULTI` → passe à Phase B.
- `NEW_ISSUE` → passe à Phase 1 avec un seul cycle.
- `EXISTING_ISSUE_<N>` → passe à Phase 3-bis (resume), voir plus bas.

---

## Phase B — prompt-splitter (si MULTI)

**Comment l'invoquer** :
```
Agent(
  subagent_type: "general-purpose",
  description: "Split multi-feature prompt",
  prompt: """
Tu es l'agent `prompt-splitter` (cf. ${CLAUDE_PLUGIN_ROOT}/agents/prompt-splitter.md).

PROMPT UTILISATEUR :
\"\"\"
<le prompt original>
\"\"\"

DÉCISION INTENT-CLASSIFIER :
<JSON intent-classifier collé ici>

Produis le JSON conforme à ton schéma.
"""
)
```

**Si** `is_multi_feature: false` (le splitter a changé d'avis) → traite comme NEW_ISSUE unique.

**Sinon** : pour chaque entrée de `features[]`, lance un cycle complet Phases 1→9 **en parallèle** (un tool Agent call par feature en parallèle) si `split_strategy: parallel`. Si `sequential`, en série en respectant `depends_on`.

> ⚠️ Limite à **3 cycles parallèles maximum** simultanément pour éviter de saturer le contexte. Si N > 3, batche par groupes de 3.

---

## Phase 1 — prompt-optimizer

**Invocation** :
```
Agent(
  subagent_type: "general-purpose",
  description: "Optimize prompt into spec",
  prompt: """
Tu es l'agent `prompt-optimizer` (cf. ${CLAUDE_PLUGIN_ROOT}/agents/prompt-optimizer.md).

PROMPT (brut ou prompt_subset si MULTI) :
\"\"\"
<...>
\"\"\"

Produis le JSON spec conforme à ton schéma.
"""
)
```

**Persistance** :
```powershell
. ${CLAUDE_PLUGIN_ROOT}/lib/state.ps1
Set-RunnerStateArtifact -IssueNumber <N> -Key "spec" -Value <spec_json>
Update-RunnerStatePhase -IssueNumber <N> -Phase "optimize" -Agent "prompt-optimizer" -Result "ok"
```

**Gate utilisateur** : si la spec a des `open_questions[]` non-vides ET `estimated_complexity` ≥ `medium`, **demande à l'utilisateur** de répondre aux questions avant Phase 2.

---

## Phase 2 — risk-analyzer

**Invocation** : même pattern, passer `spec` du Phase 1 en input.

**Persistance** : `Set-RunnerStateArtifact ... -Key "risk_analysis"`.

**Gate utilisateur** : si `needs_user_confirmation: true` dans le rapport → `AskUserQuestion` montrant `overall_risk_level`, `confirmation_reason` et la liste des risques `high+`. Options : {Continue, Modifier la spec, Abandon}.

---

## Phase 3 — setup (issue + branch + worktree)

**Si NEW_ISSUE** :
```powershell
. ${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.ps1
$slug = ConvertTo-IssueSlug -Title <spec.objective>
$issue = New-RunnerIssue -Title <spec.objective> -Body <résumé spec + risks>
$branch = New-RunnerBranch -IssueNumber $issue.number -Slug $slug
. ${CLAUDE_PLUGIN_ROOT}/lib/state.ps1
Initialize-RunnerState -IssueNumber $issue.number -Title <spec.objective> -Branch $branch
```

**Si EXISTING_ISSUE_<N>** :
```powershell
$issue = Get-IssueByNumber -Number <N>
# Si une branche runner/issue-<N>-* existe déjà → checkout dessus
# Sinon → créer depuis main
```

**Création du worktree** : utilise `Agent(isolation: worktree)` plus tard en Phase 4. Le worktree créé par l'Agent est éphémère et lié à un agent particulier.

---

## Phase 4 — implementer

**Invocation** :
```
Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",
  description: "Implement feature #<N>",
  prompt: """
Tu es l'agent `implementer` (cf. ${CLAUDE_PLUGIN_ROOT}/agents/implementer.md).

ISSUE : #<N> — <title>
BRANCH : <runner/issue-N-slug>

SPEC (prompt-optimizer) :
<JSON>

ANALYSE DE RISQUE (risk-analyzer) :
<JSON>

Implémente le travail. Respecte les mitigations. Ne commit pas. Produis le rapport
JSON conforme à ton schéma.
"""
)
```

**Récupération du diff** : à la fin du worktree, capturer `git diff main...HEAD` du worktree et le stocker en artifact `diff`.

**Retry** : si le rapport est `status: failed`, relance UNE fois avec les `blockers` injectés dans le prompt. Si la 2ème tentative échoue → état `failed`, escalate à l'utilisateur.

**Persistance** : `Set-RunnerStateArtifact ... -Key "implementer_report"` + diff.

---

## Phase 5 — regression-checker

**Invocation** : passer spec + risk + implementer_report + diff en input. Pas de worktree (lecture seule).

**Branchement sur verdict** :
- `pass` → Phase 6
- `concerns` → `AskUserQuestion` à l'utilisateur avec la liste des findings major. Si valide → Phase 6. Sinon → retour Phase 4 avec findings injectés.
- `block` → retour Phase 4 obligatoire avec les findings `blocker`. Compteur retry = +1.

---

## Phase 6 — test-writer + exécution

**Invocation `test-writer`** : passer spec + implementer_report + regression_check_report.

L'agent écrit les tests **dans le worktree** (réutilise le worktree de Phase 4 via `Agent(isolation: worktree)` avec le même chemin si possible).

**Exécution des tests** (l'orchestrateur lance les commandes, pas l'agent) :
```bash
# détection du stack via fichiers du repo :
# package.json + pnpm → pnpm --filter <app> test
# pubspec.yaml → flutter test
# (autres patterns à étendre)
```

**Si rouge** : retour Phase 4 avec les failed_tests injectés. Compteur retry +1. Maximum 2 retries → état `failed`.

---

## Phase 7 — PR creation

**Invocation** :
```powershell
. ${CLAUDE_PLUGIN_ROOT}/lib/gh-broker.ps1
$pr = New-RunnerPullRequest `
  -IssueNumber <N> `
  -Title <spec.objective> `
  -Body @"
## Résumé
<diff_summary de l'implementer>

## Changements
<files_modified de l'implementer>

## Tests
<coverage_summary de test-writer>

## Risques connus
<risks de risk-analyzer en synthèse>

## Décisions notables
<decisions + deviations_from_spec de l'implementer>
"@
```

**Avant de créer la PR** : commiter le diff du worktree depuis le worktree (utilisateur n'a PAS encore validé — c'est ok, c'est sur une branche dédiée non-mergée). Commit message conventional : `feat:`/`fix:`/`refactor:` selon le scope.

**Persistance** : `Set-RunnerStateArtifact ... -Key "pr_url" ...`

---

## Phase 8 — pr-reviewer

**Invocation** : passer tous les artifacts amont + numéro de PR.

**Branchement sur verdict** :
- `approve` → Phase 9
- `comment_only` → poster les commentaires inline, passer Phase 9
- `request_changes` → retour Phase 4 avec les blockers. Compteur retry +1.

**Poster les commentaires inline** :
```bash
# Pour chaque inline_comment :
gh api repos/:owner/:repo/pulls/<N>/comments \
  -f path="<path>" -F line=<line> -f body="<body>" -f commit_id="<HEAD sha>"
```

---

## Phase 9 — merge

**Toujours** demander confirmation utilisateur via `AskUserQuestion` :
> "PR #<N> approuvée par le runner. Verdict : <résumé pr-reviewer>. Merger maintenant en `<strategy>` ?"
> Options : {Merger maintenant, Voir le diff d'abord, Pas maintenant}.

Si "Voir le diff" → afficher `gh pr diff <N>` + reposer la question.
Si "Pas maintenant" → état `done_unmerged`, l'utilisateur mergera à la main.

Si "Merger maintenant" :
```powershell
Merge-RunnerPullRequest -Number <N> -Strategy <strategy_recommandée>
```

**Persistance finale** : `Update-RunnerStatePhase -Phase "done"`. La branche est supprimée automatiquement par `gh pr merge --delete-branch`.

---

## Reprise (resume) — EXISTING_ISSUE_<N>

Quand intent-classifier décide `EXISTING_ISSUE_<N>` :
1. `Get-RunnerState -IssueNumber <N>` pour récupérer l'état persisté
2. Si état trouvé → reprendre à `state.phase + 1`. Récupérer les artifacts du state.json pour ne PAS rerun les phases déjà faites.
3. Si pas d'état (issue créée hors du runner) → traiter comme NEW_ISSUE mais sans recréer l'issue ni la branche (réutiliser celles existantes).

---

## Règles d'or de l'orchestrateur

1. **Une seule phase active à la fois** par pipeline. Sauf en MULTI où c'est N pipelines en parallèle.
2. **Aucun commit/merge automatique** sans validation utilisateur explicite en v1.
3. **Retry maximum 2 fois** par phase. Au 3ème échec → état `failed`, remonter à l'utilisateur avec le contexte complet.
4. **Si l'utilisateur interrompt** avec un nouveau prompt (intent-classifier sur le nouveau prompt déclenche), sauvegarder l'état courant (`Update-RunnerStatePhase -Phase "paused"`) avant de basculer.
5. **Toujours notifier l'utilisateur** en 1 ligne à chaque transition de phase. Ex: "Phase 4 : implementer démarré dans worktree…"
6. **Coût** : ~$0.20-$0.50 par pipeline complet (Haiku pour intent/optim/split, Sonnet pour le reste). À surveiller.
7. **Timeout par phase** : 5 min Haiku, 15 min Sonnet, 30 min implementer (worktree). Au-delà → kill + retry.

## Anti-patterns à éviter

- ❌ Lancer Phase 1 sans avoir vu `<issue-runner-active>` (= violer le contrat hook)
- ❌ Skipper une phase parce qu'elle "semble facile" — chaque phase a son rôle
- ❌ Commiter ou push depuis Claude main (uniquement depuis le worktree de l'implementer)
- ❌ Mergez sans confirmation utilisateur
- ❌ Boucler indéfiniment sur retry — respecter le seuil de 2
- ❌ Ignorer `needs_user_confirmation: true` du risk-analyzer
- ❌ Mélanger les pipelines en MULTI (chaque feature a SON état, SA branche, SA PR)
- ❌ Oublier de persister l'état entre phases — interdit de continuer si la phase précédente n'est pas marquée complete dans state.json
