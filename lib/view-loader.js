const imports = {
  status: () => import("./status-runtime.js"),
  repositoryListView: () => import("./repository-list-view.js"),
  branchListView: () => import("./branch-list-view.js"),
  worktreeListView: () => import("./worktree-list-view.js"),
  repositorySetup: () => import("./repository-setup.js"),
};

module.exports = class ViewLoader {
  constructor() {
    this.pending = new Map();
  }

  importView(kind) {
    return imports[kind]();
  }

  load(kind) {
    if (!this.pending.has(kind)) {
      const pending = Promise.resolve()
        .then(() => this.importView(kind))
        .then((namespace) => namespace.default ?? namespace)
        .catch((error) => {
          if (this.pending.get(kind) === pending) this.pending.delete(kind);
          throw error;
        });
      this.pending.set(kind, pending);
    }
    return this.pending.get(kind);
  }
};
