const { CompositeDisposable, Disposable } = require("lumine");
const { fetchRemote, forcePushRemote, pullRemote, pushRemote } = require("./remote-actions");

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
          didDispatch: () => this.getRepositoryListView().toggle(),
        },
        "git-center:select-branch": {
          description: "Pick a branch of the active repository to check out.",
          modal: "Branches",
          didDispatch: () => this.getBranchListView().toggle(),
        },
        "git-center:select-worktree": {
          description: "Open the list of the active repository's worktrees.",
          modal: "Worktrees",
          didDispatch: () => this.getWorktreeListView().toggle(),
        },
        "git-center:toggle-lock": {
          description: "Pin the active repository so it stops following the editor.",
          didDispatch: () => this.toggleActiveRepositoryLock(),
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
    );
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

  consumeStatusBar(statusBar) {
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
      queueMicrotask(() => {
        if (!owns()) return;
        try {
          const RepositoryStatusView = require("./repository-status-view");
          const BranchStatusView = require("./branch-status-view");
          state.repositoryStatusView = new RepositoryStatusView({
            onDidClick: () => {
              if (owns()) this.getRepositoryListView().toggle();
            },
            deferInitialUpdate: true,
          });
          retain(new Disposable(() => state.repositoryStatusView.destroy()));
          if (!owns()) return;
          state.branchStatusView = new BranchStatusView({
            onDidClick: () => {
              if (owns()) this.getBranchListView().toggle();
            },
            deferInitialUpdate: true,
          });
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
          state.retire();
          throw error;
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

  getRepositoryListView() {
    if (!this.repositoryListView) {
      const RepositoryListView = require("./repository-list-view");
      this.repositoryListView = new RepositoryListView();
    }
    return this.repositoryListView;
  },

  getBranchListView() {
    if (!this.branchListView) {
      const BranchListView = require("./branch-list-view");
      this.branchListView = new BranchListView();
    }
    return this.branchListView;
  },

  getWorktreeListView() {
    if (!this.worktreeListView) {
      const WorktreeListView = require("./worktree-list-view");
      this.worktreeListView = new WorktreeListView();
    }
    return this.worktreeListView;
  },
};
