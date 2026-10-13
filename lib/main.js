const { CompositeDisposable, Disposable } = require("lumine");
const { fetchRemote, forcePushRemote, pullRemote, pushRemote } = require("./remote-actions");
const { repositoryDisplayName } = require("./helpers");
const viewLoader = new (require("./view-loader"))();

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "git-center",
      tips: [
        "You can check out another branch of the active repository with {{ 'git-center:select-branch' | keystroke }}",
        "You can open any worktree of the active repository with {{ 'git-center:select-worktree' | keystroke }}",
        "Right-click the branch tile to fetch, pull, push, or force-push the active branch.",
      ],
    };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.repositoryStatusView = null;
    this.branchStatusView = null;
    this.repositoryTile = null;
    this.branchTile = null;
    this.pickerWindows = new Map();
    this.repositoryListView = null;
    this.branchListView = null;
    this.worktreeListView = null;
    this.statusBarConnections = new Map();

    // Commands and tile clicks open the same modal pickers. Toggling the lock
    // pins the shared active-repository context so it stops following the
    // active pane item.
    this.subscriptions.add(
      lumine.commands.add("lumine-workspace", {
        "git-center:select-repository": {
          description: "Choose which repository the Git packages act on.",
          modal: "Repositories",
          didDispatch: (event) => this.togglePicker(event.context?.window, "repositoryListView"),
        },
        "git-center:select-branch": {
          description: "Pick a branch of the active repository to check out.",
          modal: "Branches",
          didDispatch: (event) => this.togglePicker(event.context?.window, "branchListView"),
        },
        "git-center:select-worktree": {
          description: "Open the list of the active repository's worktrees.",
          modal: "Worktrees",
          didDispatch: (event) => this.togglePicker(event.context?.window, "worktreeListView"),
        },
        "git-center:toggle-lock": {
          description: "Pin the active repository so it stops following the editor.",
          didDispatch: () => this.toggleActiveRepositoryLock(),
        },
        "git-center:previous-repository": {
          description: "Select the previous repository in name order.",
          didDispatch: () => this.cycleRepository(-1),
        },
        "git-center:next-repository": {
          description: "Select the next repository in name order.",
          didDispatch: () => this.cycleRepository(1),
        },
        "git-center:fetch": {
          description: "Fetch from the active branch's remote without changing the working tree.",
          didDispatch: () => fetchRemote(),
        },
        "git-center:pull": {
          description: "Fetch and merge the active branch's upstream.",
          didDispatch: () => pullRemote(),
        },
        "git-center:push": {
          description: "Push the active branch to its remote counterpart.",
          didDispatch: () => pushRemote(),
        },
        "git-center:force-push": {
          description: "Overwrite the active branch's remote counterpart.",
          didDispatch: () => forcePushRemote(),
        },
      }),
      lumine.contextMenu.add({
        ".git-center-repository": [
          { type: "separator" },
          {
            label: "Select Repository…",
            command: "git-center:select-repository",
          },
          {
            label: "Select Worktree…",
            command: "git-center:select-worktree",
            created() {
              this.enabled = !!lumine.repositories.getActiveRepository();
            },
          },
          { type: "separator" },
          ...[
            ["Previous Repository", "git-center:previous-repository"],
            ["Next Repository", "git-center:next-repository"],
          ].map(([label, command]) => ({
            label,
            command,
            created() {
              this.enabled = lumine.repositories.getRepositories().length > 1;
            },
          })),
          { type: "separator" },
          {
            label: "Lock Repository",
            command: "git-center:toggle-lock",
            type: "checkbox",
            created() {
              this.enabled = !!lumine.repositories.getActiveRepository();
              this.checked = lumine.repositories.isActiveRepositoryPinned();
            },
          },
          { type: "separator" },
        ],
      }),
    );
  },

  cycleRepository(direction) {
    const repositories = lumine.repositories
      .getRepositories()
      .slice()
      .sort((a, b) => repositoryDisplayName(a).localeCompare(repositoryDisplayName(b)));
    if (repositories.length < 2) return;
    const index = repositories.indexOf(lumine.repositories.getActiveRepository());
    const next =
      index === -1
        ? repositories[direction > 0 ? 0 : repositories.length - 1]
        : repositories[(index + direction + repositories.length) % repositories.length];
    try {
      lumine.repositories.setActiveRepository(next, {
        pin: lumine.repositories.isActiveRepositoryPinned(),
      });
    } catch {
      // The repository was destroyed mid-cycle.
    }
  },

  toggleActiveRepositoryLock() {
    const active = lumine.repositories.getActiveRepository();
    if (!active) {
      return;
    }
    try {
      lumine.repositories.setActiveRepository(active, {
        pin: !lumine.repositories.isActiveRepositoryPinned(),
      });
    } catch {
      // The repository was destroyed while toggling.
    }
  },

  deactivate() {
    for (const record of this.pickerWindows.values()) {
      record.lease.dispose();
      for (const key of ["repositoryListView", "branchListView", "worktreeListView"])
        record[key]?.destroy();
    }
    this.pickerWindows.clear();
    const owner = this.subscriptions;
    const connections = this.statusBarConnections;
    const repositoryListView = this.repositoryListView;
    const branchListView = this.branchListView;
    const worktreeListView = this.worktreeListView;
    this.subscriptions = null;
    this.statusBarConnections = new Map();
    this.repositoryListView = null;
    this.branchListView = null;
    this.worktreeListView = null;
    this.updateStatusBarAliases();
    owner?.dispose();
    this.deactivateStatusBar(connections);
    repositoryListView?.destroy();
    branchListView?.destroy();
    worktreeListView?.destroy();
  },

  deactivateStatusBar(connections = this.statusBarConnections) {
    for (const state of [...connections.values()]) state.retire();
    this.updateStatusBarAliases();
  },

  consumeStatusBar(service) {
    return service.observeWindows((scopedStatusBar, context) =>
      this.consumeWindowStatusBar(scopedStatusBar, context),
    );
  },

  consumeWindowStatusBar(statusBar, _context) {
    const owner = this.subscriptions;
    if (!owner || owner.disposed) return new Disposable();
    const connections = this.statusBarConnections;
    let state = connections.get(statusBar);
    if (!state) {
      state = { refs: 0, retired: false, resources: new CompositeDisposable() };
      connections.set(statusBar, state);
      const owns = () =>
        !state.retired && this.subscriptions === owner && connections.get(statusBar) === state;
      const retain = (resource) => {
        if (owns()) state.resources.add(resource);
        else resource.dispose();
      };
      state.retire = () => {
        if (state.retired) return;
        state.retired = true;
        if (connections.get(statusBar) === state) connections.delete(statusBar);
        this.updateStatusBarAliases();
        state.resources.dispose();
      };
      state.ready = Promise.resolve().then(async () => {
        if (!owns()) return;
        try {
          const { RepositoryStatusView, BranchStatusView } = await this.loadViews("status");
          if (!owns()) return;
          state.repositoryStatusView = new RepositoryStatusView({ deferInitialUpdate: true });
          retain(new Disposable(() => state.repositoryStatusView.destroy()));
          if (!owns()) return;
          state.branchStatusView = new BranchStatusView({ deferInitialUpdate: true });
          retain(new Disposable(() => state.branchStatusView.destroy()));
          if (!owns()) return;
          state.repositoryTile = statusBar.addLeftTile({
            item: state.repositoryStatusView.element,
            priority: 110,
          });
          retain(new Disposable(() => state.repositoryTile.destroy()));
          if (!owns()) return;
          state.branchTile = statusBar.addLeftTile({
            item: state.branchStatusView.element,
            priority: 120,
          });
          retain(new Disposable(() => state.branchTile.destroy()));
          if (owns()) this.updateStatusBarAliases();
        } catch (error) {
          if (!owns()) return;
          state.retire();
          lumine.notifications.addError("Unable to load Git status views.", {
            detail: error.message,
            dismissable: true,
          });
        }
      });
    }
    state.refs++;
    const lease = new Disposable(() => {
      owner.remove(lease);
      if (!state.retired && --state.refs === 0) state.retire();
    });
    owner.add(lease);
    return lease;
  },

  updateStatusBarAliases() {
    const state = [...this.statusBarConnections.values()].filter((item) => !item.retired).at(-1);
    this.repositoryTile = state?.repositoryTile ?? null;
    this.branchTile = state?.branchTile ?? null;
    this.repositoryStatusView = state?.repositoryStatusView ?? null;
    this.branchStatusView = state?.branchStatusView ?? null;
  },

  getPickerRecord(window) {
    let record = this.pickerWindows.get(window);
    if (!record) {
      record = { pending: new Map() };
      record.lease = window.onWillDestroy(() => {
        this.pickerWindows.delete(window);
        record.lease.dispose();
        for (const key of ["repositoryListView", "branchListView", "worktreeListView"])
          record[key]?.destroy();
      });
      this.pickerWindows.set(window, record);
    }
    return record;
  },

  loadViews(kind) {
    return viewLoader.load(kind);
  },

  async togglePicker(window, field) {
    const owner = this.subscriptions;
    if (!owner || owner.disposed) return;
    window ??= lumine.workspace.getMainWindow();
    const windows = this.pickerWindows;
    const record = this.getPickerRecord(window);
    const owns = () =>
      this.subscriptions === owner &&
      !owner.disposed &&
      this.pickerWindows === windows &&
      windows.get(window) === record;
    if (!record.pending.has(field)) {
      const pending = this.loadViews(field)
        .then((View) => {
          if (!owns()) return null;
          if (!record[field]) {
            const view = new View(window);
            if (!owns()) {
              view.destroy();
              return null;
            }
            record[field] = view;
          }
          if (window.isMain()) this[field] = record[field];
          return record[field];
        })
        .catch((error) => {
          record.pending.delete(field);
          if (owns())
            lumine.notifications.addError("Unable to load the Git picker.", {
              detail: error.message,
              dismissable: true,
            });
          return null;
        });
      record.pending.set(field, pending);
    }
    const view = await record.pending.get(field);
    if (owns() && view) return view.toggle();
  },

  getPicker(window, field, path) {
    window ??= lumine.workspace.getMainWindow();
    const record = this.getPickerRecord(window);
    if (!record[field]) {
      const View = require(path);
      record[field] = new View(window);
    }
    if (window.isMain()) this[field] = record[field];
    return record[field];
  },
  getRepositoryListView(window) {
    return this.getPicker(window, "repositoryListView", "./repository-list-view");
  },
  getBranchListView(window) {
    return this.getPicker(window, "branchListView", "./branch-list-view");
  },
  getWorktreeListView(window) {
    return this.getPicker(window, "worktreeListView", "./worktree-list-view");
  },
};
