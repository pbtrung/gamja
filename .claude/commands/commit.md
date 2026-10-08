---
description: Commit staged/modified changes with a detailed message and push, no AI co-author attribution
---

# Commit and Push

## Steps

1. Run `git status` and `git diff` (and `git diff --staged` if anything is already staged) to see all changes.
2. Lint and build whatever's actually touched, before staging anything:
   - Any `*.js` or `*.css` changed: `npm run -- lint --max-warnings 0` . There is no separate formatter — ESLint's
     `@stylistic` rules enforce the style (tabs, double quotes, etc.), so fix
     warnings too, not just errors. `npx eslint --fix <files>` is fine for
     mechanical style fixes on the files you touched.
   - Any change to `index.html`, `manifest.json`, `package.json`, or imports
     between modules: also run `npm run build` to make sure Vite still bundles.
   - If any check reports an error or warning, fix it and re-run before continuing.
   - Don't lint or commit `dist/` or `node_modules/` (ignored by `eslint.config.js`
     and `.gitignore`).
3. If nothing is staged, stage all relevant modified/new files with `git add`. Never stage `.claude/settings.local.json` or `config.json`.
4. Write a **detailed** commit message following this repo's convention:
   - Subject line: `<area>: <lowercase imperative summary>`, no trailing period,
     where `<area>` is the file/module path without extension, e.g.
     `state: simplify RPL_ENDOFWHO offline update`,
     `lib/irc: simplify createIterator()`,
     `components/buffer: add host to irc:// message URLs`,
     `components/{buffer-list,switcher-form}: ...` for several siblings.
     Use the bare file name (`state`, `store`, `commands`, `keybindings`,
     `style`, `main`) for root files. For repo-wide changes
     (dependencies, build setup) omit the prefix and capitalize instead, e.g.
     `Upgrade dependencies`.
   - Body (optional for trivial changes): explain _what_ changed and _why_, as bullet points if there are multiple distinct changes. Wrap at ~72 columns.
   - Base the message only on the actual diff — do not include conversational back-and-forth, dead ends, or trial-and-error from the session.
5. Create the commit using a HEREDOC so formatting is preserved, e.g.:
   ```bash
   git commit -m "$(cat <<'EOF'
   lib/client: short summary of the change

   - Detail one
   - Detail two
   - Why this change was made
   EOF
   )"
   ```
6. **Do not** add any AI attribution — no `🤖 Generated with Claude Code` line, no `Co-Authored-By: Claude` trailer, no mention of Claude/AI anywhere in the message.
7. Push to the `github` remote (`git@github.com:pbtrung/gamja.git`): `git push`,
   or `git push -u github <branch>` if the branch has no upstream yet.
   **Never push to `origin`** — that's upstream (codeberg.org/emersion/gamja),
   kept only for fetching.
8. Confirm success by showing `git log -1` and `git status` after pushing.

## Rules

- Never include Claude/AI co-authorship or attribution in the commit message.
- Always push after committing — don't stop at just the local commit.
- Only push to the `github` remote, never `origin`.
- If the push fails (e.g. diverged branch), report the error and ask before force-pushing or rebasing.
