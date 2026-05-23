---
description: Lance manuellement le pipeline issue-runner sur le prompt fourni. Sert de fallback quand le hook auto-déclencheur est désactivé, n'a pas détecté le besoin, ou quand l'utilisateur veut explicitement forcer le pipeline.
---

L'utilisateur t'invoque via `/run <description du travail>`. Tu déclenches manuellement le pipeline issue-runner.

## Procédure

1. **Récupère les arguments** : tout ce qui suit `/run` est le prompt utilisateur effectif. Si vide, demande à l'utilisateur "Sur quel travail veux-tu lancer le runner ?" et utilise sa réponse.

2. **Simule le déclencheur du hook** : ajoute mentalement `<issue-runner-active>` au contexte et **suis exactement** la doctrine de `${CLAUDE_PLUGIN_ROOT}/CLAUDE.md`, en commençant par Phase A (intent-classifier).

3. **Différences avec le déclenchement automatique** :
   - Tu peux **forcer la décision** de l'intent-classifier si l'utilisateur a précisé le type dans son `/run`. Exemples :
     - `/run --new "ajoute le champ venue"` → force `decision: NEW_ISSUE`
     - `/run --issue 42 "corrige le bug"` → force `decision: EXISTING_ISSUE_42`
     - `/run --multi "ajoute X et corrige Y"` → force `decision: MULTI`
   - Sans flag → laisse l'intent-classifier décider normalement.

4. **Notifie l'utilisateur** que le runner est lancé manuellement et passe en mode pipeline.

## Notes

- Le flag est optionnel ; sans flag, le comportement est identique à l'auto-déclenchement.
- Si l'utilisateur appelle `/run` alors qu'un pipeline est déjà actif (voir `Get-ActiveRunnerStates`), demande "Un pipeline est déjà en cours pour l'issue #N (phase: X). Veux-tu : (a) en lancer un autre en parallèle, (b) reprendre celui-ci, (c) annuler ?"
