#Requires -Version 5.1
<#
.SYNOPSIS
  Gestion de l'état du pipeline issue-runner.

.DESCRIPTION
  L'état vit dans le repo courant sous .claude/runner-state/<issue-number>/state.json.
  Chaque issue traitée par le runner a son propre dossier d'état.

  Format state.json :
  {
    "issueNumber": 42,
    "title": "...",
    "branch": "runner/issue-42-...",
    "phase": "intent" | "optimize" | "risk" | "implement" | "test" | "review" | "merge" | "done",
    "createdAt": "2026-05-23T12:34:56Z",
    "updatedAt": "...",
    "history": [
      { "phase": "intent", "agent": "intent-classifier", "result": "NEW_ISSUE", "at": "..." }
    ],
    "artifacts": {
      "diff": "...",
      "testResults": "...",
      "prUrl": "..."
    }
  }
#>

function Get-RunnerStateRoot {
    param([string]$RepoRoot = (Get-Location).Path)
    return Join-Path $RepoRoot '.claude/runner-state'
}

function Get-RunnerStateDir {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [string]$RepoRoot = (Get-Location).Path
    )
    return Join-Path (Get-RunnerStateRoot -RepoRoot $RepoRoot) "issue-$IssueNumber"
}

function Initialize-RunnerState {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Branch,
        [string]$RepoRoot = (Get-Location).Path
    )
    $dir = Get-RunnerStateDir -IssueNumber $IssueNumber -RepoRoot $RepoRoot
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $now = (Get-Date).ToString('o')
    $state = [ordered]@{
        issueNumber = $IssueNumber
        title       = $Title
        branch      = $Branch
        phase       = 'intent'
        createdAt   = $now
        updatedAt   = $now
        history     = @()
        artifacts   = @{}
    }
    $statePath = Join-Path $dir 'state.json'
    $state | ConvertTo-Json -Depth 10 | Out-File -FilePath $statePath -Encoding utf8 -Force
    return $statePath
}

function Get-RunnerState {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [string]$RepoRoot = (Get-Location).Path
    )
    $statePath = Join-Path (Get-RunnerStateDir -IssueNumber $IssueNumber -RepoRoot $RepoRoot) 'state.json'
    if (-not (Test-Path $statePath)) { return $null }
    return Get-Content $statePath -Raw | ConvertFrom-Json
}

function Update-RunnerStatePhase {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [Parameter(Mandatory)][ValidateSet('intent','optimize','risk','implement','test','review','merge','done','failed')][string]$Phase,
        [Parameter(Mandatory)][string]$Agent,
        [string]$Result = '',
        [string]$RepoRoot = (Get-Location).Path
    )
    $state = Get-RunnerState -IssueNumber $IssueNumber -RepoRoot $RepoRoot
    if ($null -eq $state) {
        throw "Aucun état trouvé pour l'issue #$IssueNumber"
    }
    $now = (Get-Date).ToString('o')
    $state.phase = $Phase
    $state.updatedAt = $now
    $entry = [ordered]@{
        phase  = $Phase
        agent  = $Agent
        result = $Result
        at     = $now
    }
    $state.history = @($state.history) + $entry
    $statePath = Join-Path (Get-RunnerStateDir -IssueNumber $IssueNumber -RepoRoot $RepoRoot) 'state.json'
    $state | ConvertTo-Json -Depth 10 | Out-File -FilePath $statePath -Encoding utf8 -Force
    return $state
}

function Set-RunnerStateArtifact {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)]$Value,
        [string]$RepoRoot = (Get-Location).Path
    )
    $state = Get-RunnerState -IssueNumber $IssueNumber -RepoRoot $RepoRoot
    if ($null -eq $state) {
        throw "Aucun état trouvé pour l'issue #$IssueNumber"
    }
    if ($null -eq $state.artifacts) {
        $state | Add-Member -NotePropertyName 'artifacts' -NotePropertyValue @{} -Force
    }
    $state.artifacts | Add-Member -NotePropertyName $Key -NotePropertyValue $Value -Force
    $state.updatedAt = (Get-Date).ToString('o')
    $statePath = Join-Path (Get-RunnerStateDir -IssueNumber $IssueNumber -RepoRoot $RepoRoot) 'state.json'
    $state | ConvertTo-Json -Depth 10 | Out-File -FilePath $statePath -Encoding utf8 -Force
}

function Get-ActiveRunnerStates {
    param([string]$RepoRoot = (Get-Location).Path)
    $root = Get-RunnerStateRoot -RepoRoot $RepoRoot
    if (-not (Test-Path $root)) { return @() }
    $dirs = Get-ChildItem $root -Directory -Filter 'issue-*'
    $active = foreach ($d in $dirs) {
        $statePath = Join-Path $d.FullName 'state.json'
        if (Test-Path $statePath) {
            $s = Get-Content $statePath -Raw | ConvertFrom-Json
            if ($s.phase -ne 'done' -and $s.phase -ne 'failed') { $s }
        }
    }
    return $active
}
