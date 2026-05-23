---
description: Lance manuellement le pipeline issue-runner sur le prompt fourni (fallback si le hook a été désactivé ou n'a pas détecté le besoin).
---

Tu invoques le pipeline `issue-runner` manuellement. Ignore le hook fast-filter et passe directement à l'étape d'intent classification, en traitant les arguments comme le prompt utilisateur effectif.

Étapes :

1. **Intent classification** : invoque l'agent `intent-classifier` (subagent_type général-purpose) avec les arguments comme prompt. Récupère sa décision JSON.

2. **Selon la décision** :
   - `CONVERSATION` : informe l'utilisateur que le runner n'a pas trouvé d'action implémentation et arrête.
   - `NEW_ISSUE` : passe à l'étape pipeline complète (optim → risk → issue creation → branch → implement → test → review → PR).
   - `EXISTING_ISSUE_<N>` : checkout sur la branche de l'issue, passe au pipeline.
   - `MULTI` : lance N pipelines parallèles via le tool Agent (un par feature).
   - `UNCLEAR` : demande à l'utilisateur de préciser.

3. **À chaque étape**, mets à jour l'état avec `Update-RunnerStatePhase` (via lib/state.ps1) et notifie l'utilisateur en une phrase.

Tu peux invoquer cette commande via : `/run <description du travail>`
