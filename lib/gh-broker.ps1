#Requires -Version 5.1
<#
.SYNOPSIS
  Wrapper PowerShell autour du CLI gh pour les besoins du pipeline issue-runner.

.DESCRIPTION
  Toutes les fonctions assument que :
   - `gh` est dans le PATH
   - L'utilisateur est authentifié (`gh auth status` doit fonctionner)
   - Le CWD est un repo GitHub clone

  Les fonctions retournent des objets PowerShell parsés depuis le JSON gh,
  ou $null si l'opération échoue. Aucune ne lance d'exception fatale —
  l'orchestrateur décide quoi faire en cas de $null.
#>

function Test-GhAvailable {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { return $false }
    try {
        $null = & gh auth status 2>&1
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-OpenIssues {
    param([int]$Limit = 30)
    if (-not (Test-GhAvailable)) { return @() }
    try {
        $json = & gh issue list --state open --limit $Limit --json number,title,labels,body,assignees,url 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { return @() }
        return $json | ConvertFrom-Json
    } catch {
        return @()
    }
}

function Get-IssueByNumber {
    param([Parameter(Mandatory)][int]$Number)
    if (-not (Test-GhAvailable)) { return $null }
    try {
        $json = & gh issue view $Number --json number,title,labels,body,state,assignees,url 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { return $null }
        return $json | ConvertFrom-Json
    } catch {
        return $null
    }
}

function New-RunnerIssue {
    param(
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Body,
        [string[]]$Labels = @('issue-runner')
    )
    if (-not (Test-GhAvailable)) { return $null }
    try {
        $args = @('issue', 'create', '--title', $Title, '--body', $Body)
        foreach ($label in $Labels) { $args += @('--label', $label) }
        $url = & gh @args 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        # gh issue create retourne l'URL sur stdout ; on extrait le numéro
        if ($url -match '/issues/(\d+)') {
            return [PSCustomObject]@{
                number = [int]$matches[1]
                url    = $url.Trim()
                title  = $Title
            }
        }
        return $null
    } catch {
        return $null
    }
}

function New-RunnerBranch {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [Parameter(Mandatory)][string]$Slug,
        [string]$BaseBranch = 'main'
    )
    $branchName = "runner/issue-$IssueNumber-$Slug"
    try {
        # Update local main first
        & git fetch origin 2>$null
        & git checkout $BaseBranch 2>$null
        & git pull --ff-only 2>$null
        & git checkout -b $branchName 2>$null
        if ($LASTEXITCODE -eq 0) {
            return $branchName
        }
        # Branch existe déjà : checkout simple
        & git checkout $branchName 2>$null
        if ($LASTEXITCODE -eq 0) { return $branchName }
        return $null
    } catch {
        return $null
    }
}

function New-RunnerPullRequest {
    param(
        [Parameter(Mandatory)][int]$IssueNumber,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Body,
        [string]$BaseBranch = 'main'
    )
    if (-not (Test-GhAvailable)) { return $null }
    try {
        $fullBody = "$Body`n`nCloses #$IssueNumber"
        $url = & gh pr create --title $Title --body $fullBody --base $BaseBranch 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($url)) { return $null }
        if ($url -match '/pull/(\d+)') {
            return [PSCustomObject]@{
                number = [int]$matches[1]
                url    = $url.Trim()
            }
        }
        return $null
    } catch {
        return $null
    }
}

function Get-PullRequestStatus {
    param([Parameter(Mandatory)][int]$Number)
    if (-not (Test-GhAvailable)) { return $null }
    try {
        $json = & gh pr view $Number --json number,state,mergeable,statusCheckRollup,reviews 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { return $null }
        return $json | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Merge-RunnerPullRequest {
    param(
        [Parameter(Mandatory)][int]$Number,
        [ValidateSet('merge','squash','rebase')][string]$Strategy = 'squash'
    )
    if (-not (Test-GhAvailable)) { return $false }
    try {
        $arg = "--$Strategy"
        & gh pr merge $Number $arg --delete-branch 2>$null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function ConvertTo-IssueSlug {
    param([Parameter(Mandatory)][string]$Title)
    $slug = $Title.ToLower()
    $slug = $slug -replace '[àâä]', 'a'
    $slug = $slug -replace '[éèêë]', 'e'
    $slug = $slug -replace '[ïî]', 'i'
    $slug = $slug -replace '[öôó]', 'o'
    $slug = $slug -replace '[üûù]', 'u'
    $slug = $slug -replace 'ç', 'c'
    $slug = $slug -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).TrimEnd('-') }
    return $slug
}
