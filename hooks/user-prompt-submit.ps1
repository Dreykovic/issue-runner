#Requires -Version 5.1
<#
.SYNOPSIS
  Hook UserPromptSubmit pour issue-runner.

.DESCRIPTION
  Fast filter (sans appel LLM, <100ms) qui décide si le prompt mérite que le
  pipeline issue-runner s'active. Si oui, injecte un systemMessage qui demande
  à Claude d'invoquer l'agent intent-classifier avant tout autre traitement.

  Input  (stdin)  : JSON Claude Code hook event { prompt, session_id, cwd, ... }
  Output (stdout) : JSON { continue, systemMessage? }

.NOTES
  Ce script DOIT toujours exit 0 (sinon Claude Code bloque le prompt).
  Toute erreur interne est avalée et émise comme systemMessage facultatif.
#>

$ErrorActionPreference = 'Stop'

function Write-Hook-Output {
    param([hashtable]$Payload)
    $json = $Payload | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.Write($json)
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    $input = $raw | ConvertFrom-Json
    $prompt = [string]$input.prompt
    if ([string]::IsNullOrWhiteSpace($prompt)) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    $trimmed = $prompt.Trim()
    $len = $trimmed.Length

    # ── Fast filters : skip sans appel LLM ──────────────────────────────────

    # Très court → pas un travail d'impl
    if ($len -lt 20) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    # Slash command Claude Code → laisser passer
    if ($trimmed.StartsWith('/')) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    # Mots de transition / confirmation → pas un nouvel intent
    $transitionWords = @(
        'oui', 'non', 'ok', 'okay', 'continue', 'continuer', 'retry',
        'merci', 'parfait', 'super', 'd''accord', 'stop', 'attend', 'attends',
        'yes', 'no', 'go', 'proceed', 'wait', 'pause'
    )
    if ($transitionWords -contains $trimmed.ToLower()) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    # Question pure (commence par mot interrogatif ET finit par ?)
    $questionStarters = @('quoi', 'qui', 'comment', 'pourquoi', 'quand', 'où',
                          'what', 'who', 'how', 'why', 'when', 'where', 'est-ce', 'peux-tu')
    $endsWithQuestion = $trimmed.EndsWith('?')
    $firstWord = ($trimmed -split '\s+', 2)[0].ToLower().TrimEnd(',', ':', ';')
    if ($endsWithQuestion -and ($questionStarters -contains $firstWord)) {
        Write-Hook-Output @{ continue = $true }
        exit 0
    }

    # ── Pas écarté par fast filter → demander à Claude d'invoquer le classifier ──

    $msg = @"
<issue-runner-active>
Le plugin issue-runner s'est déclenché sur ce prompt parce qu'il n'a pas été
écarté par les fast filters (longueur >= 20, pas de slash command, pas une
question pure, pas un mot de transition).

AVANT TOUTE AUTRE ACTION sur ce prompt, invoque le skill
``issue-runner-orchestration`` via le tool Skill. Ce skill contient la doctrine
complète d'orchestration (Phase A → Phase 9). Suis-la strictement.

Si pour une raison technique le skill n'est pas disponible, repli sur :
  - Tool Agent avec ``\${CLAUDE_PLUGIN_ROOT}/agents/intent-classifier.md``
  - Brancher selon la décision JSON retournée.
</issue-runner-active>
"@

    Write-Hook-Output @{
        continue      = $true
        systemMessage = $msg
    }
    exit 0
}
catch {
    # Toute erreur est silencieuse côté pipeline ; on n'empêche jamais le prompt
    Write-Hook-Output @{ continue = $true; systemMessage = "issue-runner hook error: $($_.Exception.Message)" }
    exit 0
}
