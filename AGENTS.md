# Working agreements

The purpose of this app's design is to create an Apple-style product: clean, minimal, and e-ink-inspired, with rich functionality that remains exceptionally simple to use because most complexity stays behind the scenes. Every product and engineering decision should reflect this philosophy, and the `frontend-design` skill must be used whenever making a UI change.

- After completing and verifying a task, always create a git commit containing every file you created or edited for that task before sending the final response.
- Stage and commit only changes made for the current task. Never include unrelated or pre-existing worktree changes.
- If the task is related to a Linear issue, prefix the commit message with `QUI-X `, replacing `X` with the issue number (for example, `QUI-123 Fix book import`).
- Use a concise commit message that describes the completed work. If a commit cannot be created, explain why in the final response.
- After developing any feature, run `bun run lint` and `bun run typecheck`, then iterate on any existing or newly introduced errors until both commands pass.
