const path = require("path");

const { CompositeDisposable } = require("lumine");

const {
  openWorktree,
  repositoryWorkingDirectory,
  runWorktreeOperation,
  samePath,
  updateListPreservingScroll,
  worktreeBranchName,
  worktreePath,
} = require("./helpers");
const { statusChips, summarizeStatus } = require("./status-summary");
const TextDialog = require("./text-dialog");

const ACTIONS = [
  {
    id: "action:create",
    action: "create",
    name: "Create worktree...",
    icon: "icon-plus",
    crumb: "New worktree",
  },
  {
    id: "action:prune",
    action: "prune",
    name: "Prune worktrees",
    icon: "icon-trashcan",
  },
];

function detailForItem(item) {
  if (item.lockedReason) return `Locked: ${item.lockedReason}`;
  return item.path;
}

// Worktree picker for the active repository. Confirming a row opens that
// worktree in this window; everything else — the other two ways to open it,
// locking, moving and removing — is an item action (F12), so the common case
// stays one keystroke.
module.exports = class WorktreeListView {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = null;
    this.refreshRequested = false;
    this.refreshPromise = null;
    this.textDialog = new TextDialog({ className: "git-center-worktree-dialog" });
    this.selectListView = lumine.workspace.buildSelectList({
      className: "git-center-worktree-list",
      crumb: "Worktrees",
      items: [],
      separatorIds: [],
      emptyMessage: "No worktrees yet",
      filterKeyForItem: (item) =>
        item.action ? item.name : [item.name, item.branch, item.path].filter(Boolean).join(" "),
      elementForItem: (item, { highlight }) => {
        const className = ["git-center-item"];
        if (item.action) {
          className.push("git-center-worktree-action");
          if (item.action === "prune") className.push("git-center-worktree-action-last");
        }
        return {
          className,
          icon: [item.icon],
          primary: highlight(item.name),
          // Action rows stay one line; worktrees carry their location below.
          secondary: item.action ? undefined : detailForItem(item),
          trailing: item.action
            ? []
            : [
                ...statusChips(item.status),
                item.locked && { text: "locked", className: "badge git-center-worktree-locked" },
                item.prunable && {
                  text: "prunable",
                  className: "badge git-center-worktree-prunable",
                },
                item.bare && { text: "bare", className: "badge" },
                item.current && { text: "current", className: "badge" },
                item.branch
                  ? { text: item.branch, className: "badge badge-info" }
                  : { text: item.shortHead || "detached", className: "badge" },
              ],
        };
      },
      didConfirmSelection: (item) => {
        if (item.action) this.performAction(item.action);
        else this.confirmWorktree(item);
      },
      didCancelSelection: () => this.hide(),
    });

    this.subscriptions.add(
      this.registerItemActions(),
      this.selectListView.getPanel().onDidChangeVisible((visible) => {
        if (visible) {
          this.observeActiveRepository();
          this.requestRefresh().catch(() => {});
        } else {
          this.stopObservingActiveRepository();
        }
      }),
    );
  }

  // The item-actions list (F12) is derived from the commands registered on the
  // dialog itself, so each action only has to exist once, with a description.
  registerItemActions() {
    return lumine.commands.add(this.selectListView.element, {
      "git-center:open-worktree-in-new-window": {
        description: "Open the selected worktree in a new window.",
        didDispatch: () => this.withSelection((item) => this.openSelected(item, "new-window")),
      },
      "git-center:add-worktree-to-window": {
        description: "Add the selected worktree to this window's project.",
        didDispatch: () => this.withSelection((item) => this.openSelected(item, "add")),
      },
      "git-center:lock-worktree": {
        description: "Lock the selected worktree so it is never pruned.",
        didDispatch: () => this.withSelection((item) => this.lockSelected(item)),
      },
      "git-center:unlock-worktree": {
        description: "Unlock the selected worktree.",
        didDispatch: () => this.withSelection((item) => this.unlockSelected(item)),
      },
      "git-center:move-worktree": {
        description: "Move the selected worktree to another directory.",
        didDispatch: () => this.withSelection((item) => this.moveSelected(item)),
      },
      "git-center:remove-worktree": {
        description: "Remove the selected worktree and its checkout.",
        didDispatch: () => this.withSelection((item) => this.removeSelected(item)),
      },
    });
  }

  // Every item action needs a worktree row and the repository it came from.
  // Action rows and a torn-down repository both mean there is nothing to do.
  withSelection(callback) {
    const item = this.selectListView.getSelectedItem();
    if (!item || item.action || !item.repository) return;
    callback(item);
  }

  observeActiveRepository() {
    this.stopObservingActiveRepository();
    const subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = subscriptions;
    const repository = lumine.repositories.getActiveRepository();

    subscriptions.add(
      lumine.repositories.onDidChangeActiveRepository(() => {
        if (!this.selectListView.isVisible()) return;
        this.observeActiveRepository();
        this.requestRefresh().catch(() => {});
      }),
    );
    if (repository) {
      subscriptions.add(
        // A worktree operation resolves before its refs refresh lands, so the
        // list only ever repopulates from this event.
        repository.onDidChangeRefsSnapshot(() => {
          this.requestRefresh().catch(() => {});
        }),
        repository.onDidChangeStatusSnapshot(() => {
          this.requestRefresh().catch(() => {});
        }),
      );
    }
  }

  stopObservingActiveRepository() {
    this.repositorySubscriptions?.dispose();
    this.repositorySubscriptions = null;
    this.refreshRequested = false;
  }

  requestRefresh() {
    if (!this.selectListView.isVisible()) return Promise.resolve();
    this.refreshRequested = true;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshItems().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async refreshItems() {
    while (this.refreshRequested && this.selectListView.isVisible()) {
      this.refreshRequested = false;
      const repository = lumine.repositories.getActiveRepository();
      if (!repository) {
        this.hide();
        return;
      }
      const [refs, statusSnapshot] = await Promise.all([
        repository.ensureRefsSnapshot?.().catch(() => null),
        repository.ensureStatusSnapshot?.().catch(() => null),
      ]);
      const worktrees = this.buildWorktreeItems(repository, refs, summarizeStatus(statusSnapshot));
      const items = [...ACTIONS, ...worktrees];
      if (
        !this.selectListView.isVisible() ||
        lumine.repositories.getActiveRepository() !== repository
      ) {
        continue;
      }
      await updateListPreservingScroll(this.selectListView, {
        items,
        // A rule below the actions, as in the branch list.
        separatorIds: worktrees.length > 0 ? [worktrees[0].id] : [],
        loadingMessage: null,
      });
    }
  }

  buildWorktreeItems(repository, refs, status) {
    const workingDirectory = repositoryWorkingDirectory(repository);
    // Git lists the main worktree first, and only it may be bare.
    return (refs?.worktrees || []).map((worktree, index) => {
      const location = worktreePath(worktree);
      const current = samePath(location, workingDirectory);
      return {
        id: `worktree:${location}`,
        repository,
        path: location,
        name: path.basename(location) || location,
        branch: worktreeBranchName(worktree),
        shortHead: worktree.headOid ? worktree.headOid.slice(0, 7) : null,
        detached: worktree.detached,
        bare: worktree.bare,
        locked: worktree.locked,
        lockedReason: worktree.lockedReason,
        prunable: worktree.prunable,
        current,
        icon: worktree.locked ? "icon-lock" : index === 0 ? "icon-repo" : "icon-file-directory",
        status: current ? status : this.statusForWorktree(location),
      };
    });
  }

  // Only a worktree already open in this window can report its working-tree
  // state, and only once something has loaded its snapshot. Loading one per
  // worktree would cost a Git process each time the list refreshes.
  statusForWorktree(worktreePath) {
    const repository = lumine.repositories.getForPath(worktreePath);
    return repository ? summarizeStatus(repository.getStatusSnapshot?.()) : null;
  }

  confirmWorktree(item) {
    this.hide();
    openWorktree(item.path);
  }

  openSelected(item, mode) {
    this.hide();
    openWorktree(item.path, mode);
  }

  lockSelected(item) {
    this.textDialog.show({
      prompt: `Why is '${item.name}' locked? Leave empty for no reason.`,
      crumb: "Lock",
      placeholder: "Reason",
      value: item.lockedReason || "",
      allowEmpty: true,
      onConfirm: (reason) =>
        runWorktreeOperation(item.repository, "worktreeLock", `Could not lock '${item.name}'`, [
          item.path,
          { reason: reason || undefined },
        ]),
    });
  }

  unlockSelected(item) {
    return runWorktreeOperation(
      item.repository,
      "worktreeUnlock",
      `Could not unlock '${item.name}'`,
      [item.path],
    );
  }

  moveSelected(item) {
    this.textDialog.show({
      prompt: `Move '${item.name}' to which directory?`,
      crumb: "Move",
      placeholder: "Destination path",
      value: item.path,
      emptyMessage: "Enter a destination path.",
      onConfirm: (destination) =>
        runWorktreeOperation(item.repository, "worktreeMove", `Could not move '${item.name}'`, [
          item.path,
          destination,
        ]),
    });
  }

  // Removal runs unforced, so Git itself refuses a worktree with uncommitted
  // work. Forcing is offered from the failure rather than from the menu: it
  // discards a checkout, and that deserves a second, deliberate click.
  async removeSelected(item) {
    const operations = item.repository.getOperations?.();
    if (!operations?.worktreeRemove) {
      lumine.notifications.addError(`Could not remove '${item.name}'`, {
        description: "This repository does not support worktree operations.",
        dismissable: true,
      });
      return;
    }
    try {
      await operations.worktreeRemove(item.path);
    } catch (error) {
      lumine.notifications.addError(`Could not remove '${item.name}'`, {
        detail: error.stderr || error.message,
        dismissable: true,
        buttons: [
          {
            text: "Remove Anyway",
            className: "btn btn-error",
            onDidClick: () =>
              runWorktreeOperation(
                item.repository,
                "worktreeRemove",
                `Could not remove '${item.name}'`,
                [item.path, { force: true }],
              ),
          },
        ],
      });
    }
  }

  performAction(action) {
    const repository = lumine.repositories.getActiveRepository();
    if (!repository) return;

    if (action === "prune") {
      this.hide();
      runWorktreeOperation(repository, "worktreePrune", "Could not prune worktrees");
      return;
    }
    this.showCreateDialog(repository);
  }

  // The suggested location is a sibling of the repository named after it, which
  // is where a worktree conventionally goes and what makes this one Enter.
  suggestedWorktreePath(repository, reference) {
    const workingDirectory = repositoryWorkingDirectory(repository);
    if (!workingDirectory) return "";
    const suffix = String(reference).replace(/[\\/:]+/g, "-");
    return path.join(
      path.dirname(workingDirectory),
      `${path.basename(workingDirectory)}-${suffix}`,
    );
  }

  async showCreateDialog(repository) {
    const refs = await repository.ensureRefsSnapshot?.().catch(() => null);
    const reference = refs?.head?.name || "worktree";
    // The dialog shows itself as the next flow step, so the trail keeps this
    // list as the previous breadcrumb entry.
    this.textDialog.show({
      prompt:
        "Where should the new worktree go? Its branch is named after the folder — created if it does not exist yet, checked out if it does.",
      crumb: ACTIONS.find((entry) => entry.action === "create").crumb,
      placeholder: "Worktree path",
      value: this.suggestedWorktreePath(repository, reference),
      emptyMessage: "Enter a path for the worktree.",
      onConfirm: (worktreePath) => this.createWorktree(repository, worktreePath),
    });
  }

  // No branch option on purpose. Given only a path, Git names the branch after
  // the folder and creates it from HEAD — or, when a branch of that name already
  // exists and no worktree holds it, checks that one out instead. Passing `-b`
  // would turn the second case into `fatal: a branch named 'x' already exists`.
  async createWorktree(repository, worktreePath) {
    const branch = path.basename(worktreePath);
    const succeeded = await runWorktreeOperation(
      repository,
      "worktreeAdd",
      `Could not create a worktree at '${worktreePath}'`,
      [worktreePath],
    );
    if (!succeeded) return succeeded;

    lumine.notifications.addSuccess(`Created worktree '${branch}'`, {
      description: worktreePath,
      dismissable: true,
      buttons: [
        { text: "Open", onDidClick: () => openWorktree(worktreePath) },
        {
          text: "Open in New Window",
          onDidClick: () => openWorktree(worktreePath, "new-window"),
        },
      ],
    });
    return true;
  }

  async toggle() {
    if (this.selectListView.isVisible()) {
      this.hide();
      return;
    }
    if (!lumine.repositories.getActiveRepository()) return;

    await this.selectListView.update({ items: [], loadingMessage: "Loading worktrees…" });
    this.selectListView.show();

    await this.requestRefresh();
  }

  hide() {
    this.selectListView.hide();
  }

  destroy() {
    this.stopObservingActiveRepository();
    this.subscriptions.dispose();
    this.selectListView.destroy();
    this.textDialog.destroy();
  }
};
