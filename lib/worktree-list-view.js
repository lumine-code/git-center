const path = require("path");

const { CompositeDisposable } = require("lumine");

const {
  openWorktree,
  repositoryWorkingDirectory,
  runWorktreeOperation,
  samePath,
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
// locking, moving and removing — is an item action, so the common case
// stays one keystroke.
module.exports = class WorktreeListView {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = null;
    this.textDialog = new TextDialog({ className: "git-center-worktree-dialog" });
    this.selectListView = lumine.workspace.buildSelectList({
      className: "git-center-worktree-list",
      crumb: "Worktrees",
      items: [],
      emptyMessage: "No worktrees yet",
      getItemId: (item) => item.id,
      search: {
        getFilterText: (item) =>
          item.action ? item.name : [item.name, item.branch, item.path].filter(Boolean).join(" "),
      },
      renderItem: (item, { highlight }) => {
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
      source: {
        mode: "snapshot",
        loadingMessage: "Loading worktrees…",
        load: () => this.loadItems(),
      },
      commands: {
        "git-center:open-worktree-in-this-window": {
          description: "Replace this window's project with the selected worktree.",
          didDispatch: ({ detail }) => this.confirmWorktree(detail.item),
        },
        "git-center:create-worktree": {
          description: "Open a path prompt for a new worktree in the active repository.",
          didDispatch: ({ detail }) => this.performAction(detail.item.action),
        },
        "git-center:prune-worktrees": {
          description: "Remove stale worktree records whose directories no longer exist.",
          didDispatch: ({ detail }) => this.performAction(detail.item.action),
        },
        "git-center:open-worktree-in-new-window": {
          description: "Open the selected worktree in a new window.",
          didDispatch: ({ detail }) => this.openSelected(detail.item, "new-window"),
        },
        "git-center:add-worktree-to-window": {
          description: "Add the selected worktree to this window's project.",
          didDispatch: ({ detail }) => this.openSelected(detail.item, "add"),
        },
        "git-center:lock-worktree": {
          description: "Lock the selected worktree so it is never pruned.",
          didDispatch: ({ detail }) => this.lockSelected(detail.item),
        },
        "git-center:unlock-worktree": {
          description: "Unlock the selected worktree.",
          didDispatch: ({ detail }) => this.unlockSelected(detail.item),
        },
        "git-center:move-worktree": {
          description: "Move the selected worktree to another directory.",
          didDispatch: ({ detail }) => this.moveSelected(detail.item),
        },
        "git-center:remove-worktree": {
          description: "Remove the selected worktree and its checkout.",
          didDispatch: ({ detail }) => this.removeSelected(detail.item),
        },
      },
      actions: this.actions(),
    });

    this.subscriptions.add(
      this.selectListView.onDidOpen(() => this.observeActiveRepository()),
      this.selectListView.onDidHide(() => this.stopObservingActiveRepository()),
    );
  }

  actions() {
    const ordinary = ({ item }) => Boolean(item && !item.action && item.repository);
    return [
      {
        command: "git-center:open-worktree-in-this-window",
        context: "item",
        when: ordinary,
        primary: true,
        disposition: "close",
      },
      {
        command: "git-center:create-worktree",
        context: "item",
        when: ({ item }) => item?.action === "create",
        primary: true,
        disposition: "push",
      },
      {
        command: "git-center:prune-worktrees",
        context: "item",
        when: ({ item }) => item?.action === "prune",
        primary: true,
        disposition: "close",
      },
      {
        command: "git-center:open-worktree-in-new-window",
        context: "item",
        when: ordinary,
        disposition: "close",
      },
      {
        command: "git-center:add-worktree-to-window",
        context: "item",
        when: ordinary,
        disposition: "close",
      },
      {
        command: "git-center:lock-worktree",
        context: "item",
        when: ({ item }) => ordinary({ item }) && !item.locked,
        disposition: "push",
      },
      {
        command: "git-center:unlock-worktree",
        context: "item",
        when: ({ item }) => ordinary({ item }) && Boolean(item.locked),
        disposition: "stay",
      },
      {
        command: "git-center:move-worktree",
        context: "item",
        when: ordinary,
        disposition: "push",
      },
      {
        command: "git-center:remove-worktree",
        context: "item",
        when: ordinary,
        disposition: "stay",
      },
    ];
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
  }

  async requestRefresh() {
    if (!this.selectListView.isVisible()) return Promise.resolve();
    const scrollTop = this.selectListView.getScrollTop();
    await this.selectListView.reload();
    await this.selectListView.update({});
    this.selectListView.setScrollTop(scrollTop);
  }

  async loadItems() {
    const repository = lumine.repositories.getActiveRepository();
    if (!repository) return [];
    const [refs, statusSnapshot] = await Promise.all([
      repository.ensureRefsSnapshot?.().catch(() => null),
      repository.ensureStatusSnapshot?.().catch(() => null),
    ]);
    const worktrees = this.buildWorktreeItems(repository, refs, summarizeStatus(statusSnapshot));
    return {
      sections: [
        { id: "actions", items: ACTIONS },
        ...(worktrees.length > 0 ? [{ id: "worktrees", items: worktrees }] : []),
      ],
    };
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
    openWorktree(item.path);
  }

  openSelected(item, mode) {
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
      return runWorktreeOperation(repository, "worktreePrune", "Could not prune worktrees");
    }
    return this.showCreateDialog(repository);
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
      this.selectListView.cancel();
      return;
    }
    if (!lumine.repositories.getActiveRepository()) return;

    await this.selectListView.show();
    await this.selectListView.update({});
  }

  destroy() {
    this.stopObservingActiveRepository();
    this.subscriptions.dispose();
    this.selectListView.destroy();
    this.textDialog.destroy();
  }
};
