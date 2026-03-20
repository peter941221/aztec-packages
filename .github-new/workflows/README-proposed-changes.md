# Proposed Workflow Changes for Backport Fix

These files cannot be auto-merged by ClaudeBox (`.github/` is blocked).
Apply these diffs manually to the corresponding files in `.github/workflows/`.

## 1. `claudebox.yml` — Add `target_ref` input

Add a new input to the `workflow_dispatch` section:

```diff
   workflow_dispatch:
     inputs:
       prompt:
         description: 'Prompt / instructions for Claude'
         required: true
         type: string
       link:
         description: 'Context link (e.g., PR URL, issue URL, external reference)'
         required: false
         type: string
+      target_ref:
+        description: 'Git ref to checkout in the container (e.g., origin/backport-to-v4-next-staging)'
+        required: false
+        type: string
```

Then pass it through in the payload (in the "Run ClaudeBox" step):

```diff
        env:
          CLAUDEBOX_URL: ${{ vars.CLAUDEBOX_URL }}
          CLAUDEBOX_API_SECRET: ${{ secrets.CLAUDEBOX_API_SECRET }}
          CLAUDEBOX_PROMPT: ${{ steps.parse.outputs.prompt }}
          CLAUDEBOX_LINK: ${{ steps.parse.outputs.link }}
+         CLAUDEBOX_TARGET_REF: ${{ inputs.target_ref || '' }}
          COMMENT_ID: ${{ github.event.comment.id || '' }}
```

And in the jq payload construction:

```diff
          PAYLOAD=$(jq -n \
            --arg prompt "$CLAUDEBOX_PROMPT" \
            --arg user "$AUTHOR" \
            --arg comment_id "$COMMENT_ID" \
            --arg run_comment_id "$RUN_COMMENT_ID" \
            --arg repo "$REPO" \
            --arg run_url "$RUN_URL" \
            --arg link "$CLAUDEBOX_LINK" \
-           '{prompt: $prompt, user: $user, comment_id: $comment_id, run_comment_id: $run_comment_id, repo: $repo, run_url: $run_url, link: $link}')
+           --arg target_ref "$CLAUDEBOX_TARGET_REF" \
+           '{prompt: $prompt, user: $user, comment_id: $comment_id, run_comment_id: $run_comment_id, repo: $repo, run_url: $run_url, link: $link, target_ref: $target_ref}')
```

## 2. `backport.yml` — Pass `target_ref` when dispatching ClaudeBox

In the "Notify Slack and dispatch ClaudeBox on backport failure" step:

```diff
          gh workflow run claudebox.yml \
            -f prompt="Backport PR #$PR ($TITLE) to $BRANCH. The automatic cherry-pick failed due to conflicts. Follow the backport skill (.claude/skills/backport/SKILL.md) to resolve conflicts and create a PR targeting $BRANCH." \
-           -f link="${LINK:-$URL}"
+           -f link="${LINK:-$URL}" \
+           -f target_ref="origin/backport-to-${BRANCH}-staging"
```

This makes the ClaudeBox container start on the staging branch instead of `origin/next`,
so `create_pr` pushes from the correct base.
