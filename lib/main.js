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
    this.subscriptions.dispose();
    this.deactivateStatusBar();
    this.repositoryListView?.destroy();
    this.repositoryListView = null;
    this.branchListView?.destroy();
    this.branchListView = null;
    this.worktreeListView?.destroy();
    this.worktreeListView = null;
  },

  deactivateStatusBar() {
    this.repositoryTile?.destroy();
    this.repositoryTile = null;
    this.branchTile?.destroy();
    this.branchTile = null;
    this.repositoryStatusView?.destroy();
    this.repositoryStatusView = null;
    this.branchStatusView?.destroy();
    this.branchStatusView = null;
  },

  consumeStatusBar(statusBar) {
    let disposed = false;
    let registration = null;
    const deferred = new Disposable(() => {
      disposed = true;
      registration?.dispose();
    });
    this.subscriptions.add(deferred);

    // Repository status snapshots and their view modules are relatively heavy.
    // Return the service disposable synchronously, then attach the two tiles
    // once the package activation batch has yielded.
    queueMicrotask(() => {
      if (disposed) return;
      const RepositoryStatusView = require("./repository-status-view");
      const BranchStatusView = require("./branch-status-view");

      this.repositoryStatusView = new RepositoryStatusView({
        onDidClick: () => this.getRepositoryListView().toggle(),
        deferInitialUpdate: true,
      });
      this.branchStatusView = new BranchStatusView({
        onDidClick: () => this.getBranchListView().toggle(),
        deferInitialUpdate: true,
      });

      // Repository band, see the priority convention in packages/status-bar/README.md.
      this.repositoryTile = statusBar.addLeftTile({
        item: this.repositoryStatusView.element,
        priority: 210,
      });
      this.branchTile = statusBar.addLeftTile({
        item: this.branchStatusView.element,
        priority: 220,
      });

      const repositoryStatusView = this.repositoryStatusView;
      const branchStatusView = this.branchStatusView;
      const repositoryTile = this.repositoryTile;
      const branchTile = this.branchTile;
      registration = new Disposable(() => {
        repositoryTile.destroy();
        branchTile.destroy();
        repositoryStatusView.destroy();
        branchStatusView.destroy();
        if (this.repositoryTile === repositoryTile) this.repositoryTile = null;
        if (this.branchTile === branchTile) this.branchTile = null;
        if (this.repositoryStatusView === repositoryStatusView) this.repositoryStatusView = null;
        if (this.branchStatusView === branchStatusView) this.branchStatusView = null;
      });
      if (disposed) registration.dispose();
      else this.subscriptions.add(registration);
    });
    return deferred;
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
