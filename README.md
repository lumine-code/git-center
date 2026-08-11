# git-center

Show the active Git repository, branch, and working-tree status in the status bar.

Ahead and behind counts compare local refs only; nothing here fetches on your behalf, so they move when you do.

## Features

- **Repository tile**: shows the window's active repository and how many files are added, modified, deleted, or conflicted, or the focused folder dimmed when it is not part of a repository; choosing a repository locks it, while `Auto` follows the active workspace item.
- **Branch tile**: shows the active repository's branch and how far it has drifted from its upstream, and offers branch creation, start-point selection, and detached checkout; its picker groups local branches, remote branches, and tags with each ref's latest commit author, age, short hash, and subject.
- **Worktree picker**: lists every worktree of the active repository with its branch, working-tree counts, and lock or prune state, and opens one in this window, alongside it, or in a new window; worktrees can also be created, moved, locked, removed, and pruned from the same list.
- **Cross-worktree branches**: a branch already checked out in another worktree is marked as such and offers to open that worktree, since Git allows one worktree per branch and would refuse the checkout.
- **Filterable pickers**: clicking a tile opens a list for switching repositories or checking out branches, with working-tree counts and upstream drift on the rows that have them.
- **Quick switching**: the mouse wheel over the repository tile cycles through repositories, middle click locks or unlocks the current selection, and the repository picker's rescan item scans the project roots again.

## Installation

To install `git-center` search for _git-center_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/git-center`.

## Commands

Commands available in `lumine-workspace`:

- `git-center:select-repository`: pick the active repository,
- `git-center:select-branch`: pick a branch of the active repository to check out,
- `git-center:select-worktree`: pick a worktree of the active repository to open,
- `git-center:toggle-lock`: pin or unpin the active repository so it stops or resumes following the active editor.

Commands available in the worktree picker:

- `git-center:open-worktree-in-new-window`: open the selected worktree in a new window,
- `git-center:add-worktree-to-window`: add the selected worktree to this window's project,
- `git-center:lock-worktree`: lock the selected worktree so it is never pruned,
- `git-center:unlock-worktree`: unlock the selected worktree,
- `git-center:move-worktree`: move the selected worktree to another directory,
- `git-center:remove-worktree`: remove the selected worktree and its checkout.

## Services

- **status-bar** (`^1.0.0`): consumed to display the repository and branch tiles.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
