# Workflow Changes Applied — ClaudeBox `target_ref` Support

All changes below have been applied directly to the repo (CI file modification is permitted).

## Problem

When ClaudeBox is dispatched for backports or merge-train fixes, it clones the repo at `origin/next` (default). For backports, if `create_pr` is called while HEAD is on the wrong branch (e.g., the target branch instead of the staging branch), unrelated commits leak into the PR. For merge-train fixes, the container must switch to the correct merge-train branch before making changes.

## Solution: `target_ref` Input

A new `target_ref` input flows through the entire dispatch chain, telling the ClaudeBox container which git ref to checkout at startup. This ensures the container begins on the correct branch before any work starts.

## Changes Made

### 1. `.github/workflows/claudebox.yml`

- Added `target_ref` input to `workflow_dispatch`
- Added `CLAUDEBOX_TARGET_REF` env var in the "Run ClaudeBox" step
- Included `target_ref` in the jq payload sent to the ClaudeBox API

### 2. `.github/workflows/backport.yml`

- Updated prompt to reference `.claude/claudebox/backport.md` (automation doc) instead of `.claude/skills/backport/SKILL.md` (interactive skill)
- Added `-f target_ref="origin/backport-to-${BRANCH}-staging"` so the container starts on the staging branch

### 3. `ci3/merge_train_failure_slack_notify`

- Both dispatch paths (dequeued + CI failure) now pass `target_ref: "origin/$REF_NAME"` so the container starts on the merge-train branch (e.g., `origin/merge-train/spartan`)

### 4. `.claude/claudebox/backport.md`

- New automation doc with MCP-only workflow (no `gh` CLI, no `git push`)
- Step 3 explicitly checks out the staging branch before cherry-picking
- Step 7 verifies HEAD before calling `create_pr`

## Why This Fixes the Rebase Problem

The root cause was: ClaudeBox starts at `origin/next`, the prompt says "backport to v4-next", Claude checks out `v4-next` (the target), cherry-picks there, then calls `create_pr`. But the PR should target `backport-to-v4-next-staging`, and HEAD has all of `v4-next`'s history — which differs from the staging branch. Result: unrelated commits in the PR.

With `target_ref=origin/backport-to-v4-next-staging`:
1. Container starts on the staging branch
2. Cherry-pick happens on the staging branch
3. `create_pr` pushes from staging branch HEAD
4. PR targets the staging branch
5. Only the cherry-picked commit(s) appear in the diff
