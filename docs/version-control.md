# Version control guide

Lumine has built-in repository support and bundles `git-diff`; additional Git interfaces are optional packages.

## Diff markers in the gutter

The **`git-diff`** package marks lines in the editor gutter that have been added, edited, or deleted since the last commit. You can:

- move between changes with `git-diff:move-to-next-diff` and `git-diff:move-to-previous-diff`, and
- open a searchable list of every change in the file with `git-diff:toggle-diff-list`.

The markers can be shown as colored icons or colored gutter marks — choose in the package's settings. Added, edited and deleted changes keep their usual colors; staged changes use muted colors with readable contrast in One Night and One Day. The scrollbar and minimap use the same staging colors.

Unstaged markers compare the current editor buffer, including unsaved edits, with the staged version. Staged markers compare the buffer with the last commit and appear where no unstaged block overlaps or touches them. An unstaged block takes priority over the whole overlapping staged block. Navigation and the diff list follow the visible markers, and each list entry identifies its staging status. Use the staged diff in `git-panel` or `git-command` to inspect the exact snapshot prepared for the next commit.

## Reverting changes

The editor can revert an uncommitted change back to what is committed: `editor:checkout-head-revision` restores the block at the cursor to its `HEAD` revision.

## Status indicators

The tree view and tabs color file names by Git status. `git:colorize-toggle` switches the coloring for the current window. The bundled `language-git` grammar highlights Git files such as commit messages and rebase todo lists.

## The repository, branch, and worktree tiles

Install **`git-center`** to show the active repository, working-tree counts, and branch in the status bar. On the left side, the repository and branch appear before the linter counters. Its filterable pickers are also available through `git-center:select-repository` and `git-center:select-branch`.

The active repository normally follows whatever you are editing. `git-center:toggle-lock` pins it in place so it stops following, and the repository picker's `Auto` row hands it back.

### Initialize and clone repositories

Use **Git → Create Repository → Initialize Repository…** to initialize a local repository. A command invoked from Tree View uses the selected folder, or the parent folder of a selected file. Elsewhere it uses the center document's folder, including notebook and other file-backed views. Several selected folders require a choice; the form always lets you edit the destination. These commands remain available without an existing repository.

**Clone Repository…** asks for the remote URL, destination directory and remote name. The destination follows the repository name and selected parent folder until you edit it. Both workflows add the resulting folder to the project and use the editor's shared Git operations.

GitHub Panel separately offers **Create Repository…**, which creates a repository on GitHub and clones it locally, and **Publish Repository…**, which connects an existing local folder or repository to a new repository on GitHub. Publishing does not stage files or create the first commit.

### Worktrees

A Git worktree is another checkout of the repository. `git-center:select-worktree` lists worktrees and opens one in this window; its actions can open one elsewhere, create, move, lock, unlock, or remove it. The branch picker marks branches checked out in another worktree and offers to open that checkout.

## Commit attribution

Install **`git-blame`** and run `git-blame:toggle` to show who last changed the lines in the current file. Consecutive lines from the same commit share one gutter block, with the hash, date and author shown once; its label stays visible while scrolling through a long block. Wrapped lines stay inside their block, and uncommitted lines are grouped and marked as such. Hover over a block for the commit message, or click anywhere in it to open the commit on its Git host; when no host link is available, the click copies its hash.

## Opening on your Git host

The **`open-repository`** package opens the current file or repository on its Git host's website. Install it from the Install pane in **Settings**, or with `lumine --install lumine-code/open-repository`. It supports GitHub, GitLab, and Bitbucket (and falls back to GitHub-style URLs for other hosts). Run `open-repository:file` to open the file, its blame or history, the repository, its issues or pull/merge requests, or the branch compare page; run `open-repository:copy-url` to copy a URL for the current file and selected lines.

## Going further

For richer workflows, install these `lumine-code` packages from the Install tab (see [The package system](https://lumine-code.github.io/docs.html#packages-and-themes/managing-packages)):

- **[git-command](https://github.com/lumine-code/git-command)** — searchable modal workflows for staging, commits, branches, remotes, history, and stashes.
- **[git-panel](https://github.com/lumine-code/git-panel)** — a full panel for changes, commits, branches, remotes, diffs, and conflicts.
- **[github-panel](https://github.com/lumine-code/github-panel)** — pull requests, reviews, issues, and repository publishing using the editor's repository system.

In `git-panel`'s changes list, select one or more files and use **Split Up**, **Split Down**, **Split Left**, or **Split Right** in the context menu to open their working-tree contents in one new pane. The same actions are available as `git-panel:split-up`, `git-panel:split-down`, `git-panel:split-left`, and `git-panel:split-right` while the changes list has focus.

The `git-panel` diff viewer uses **Unified** by default, with removed and added lines shown together. Select **Side by Side** in the commit or changes header to compare the before and after versions in two aligned columns, with shared file headers and one scrollbar on the right; **Unified** returns to the original view. Switching layouts keeps the same location in the diff and the selected lines. Side by Side omits the caret's current-line highlight while retaining diff colors and explicit selections. File and hunk headers span the viewer width with matching margins and styling in both layouts. Both views are available for committed, unstaged, and staged changes. Long lines wrap by default, and toggling soft wrap in either column updates both columns. Both layouts follow **Scroll Past End**, including changes made while the diff is open.

Use the clipboard icon in a hunk header to copy its changes as a unified diff with file paths and context. When selected lines belong to that hunk, it copies all selected changes instead, including selections across multiple hunks or files, using the same scope as Stage and Discard. Copying preserves the selection and works for committed, staged, and unstaged changes in both layouts. A temporary "Copied" tooltip confirms that the diff reached the clipboard.

Staging or discarding a hunk updates the open diff in place and preserves its scroll position and wrapping. Changes made outside the panel use the same refresh behavior. If the remaining diff is shorter, scrolling stops at its new end; when all changes are gone, the viewer shows **No changes to display**.

The shared pending diff tab, asynchronous loading and promoted tabs are described in the [Git Panel README](https://github.com/lumine-code/git-panel#readme).

With **Navigation Panel** enabled, the current `git-panel` patch appears as a tree of files and their hunks. This works for a single file, all staged changes, and commits in both layouts. Select a file to reveal its header or a hunk to jump to that part of the diff. The navigation list's scroll action previews the selection while keeping the list focused. The tree updates when the patch changes. Collapsed and deferred large files keep their hunk entries available; choosing a hunk loads and expands only that file.

With **Scrollmap** enabled, file and hunk headers appear as short, centered markers in different colors on the diff's right scrollbar. The current file and hunk have stronger opacity. Markers follow wrapping, collapsed files, patch refreshes, and layout changes; Side by Side uses the single scrollbar on the right.

`github-panel` and `git-command` use the diff renderer supplied by the active `git-panel` package through its `git-panel.diff` service. Its scrolling, wrapping, and layout behavior applies to all three interfaces.

`github-panel` provides the same layout switch in a pull request's **Files** tab and in diff previews beside review comments. Review previews keep the surrounding context limited to the comment's location and preserve source line numbering in either layout. Refreshing the same pull request keeps the current diff visible while it loads the latest changes.

`git-command` provides the switch in **Diff Current File**, **Diff All**, and commit previews. Select **Staged Changes** or **Unstaged Changes** to compare the index and working-tree snapshots separately, even when the same file appears in both. The chosen snapshot and layout stay selected when an output pane is refreshed. Untracked files have a separate text preview. Keep `git-panel` enabled to use visual diffs; when it is unavailable, the report explains why and shows the text patch.

Type `lumine-code/git-command`, `lumine-code/git-panel`, or `lumine-code/github-panel` directly into the Install tab's search box to find them.

## Shared Git behavior

Repository actions in Git Center, Git Command and the Git panels follow the selected repository, including a pinned selection. File actions follow the editor that invoked them. Commit and push guards, force-push confirmation, and the default pull strategy are configured in Settings → Git and apply across the interfaces.

Staging and committing together and package publication run as complete workflows. Writes to linked worktrees are coordinated through their shared metadata directory. If a write is interrupted and its result cannot be established, inspect the refreshed repository before repeating it.

Git Panel supplies native patch rendering through its `git-panel.diff` service. GitHub reviews and Git Command previews consume the same renderer while keeping their own drafts, selections and snapshots.
