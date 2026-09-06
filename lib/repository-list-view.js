const { CompositeDisposable } = require("lumine");

const { applySwitchItem, buildRepositoryItems } = require("./helpers");
const { divergenceChips, statusChips } = require("./status-summary");

const CONTEXT_ITEMS = [{ id: "action:auto", auto: true, repoName: "Auto" }];

// Repository picker. Selecting a repository makes it the window's active
// repository and optionally pins it, according to the package setting.
module.exports = class RepositoryListView {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = null;
    this.activeRescanIds = new Set();
    this.rescanScrollTop = null;
    this.pendingStatusLoads = new Map();
    this.refreshScheduled = false;
    this.refreshRequested = false;
    this.refreshPromise = null;
    this.selectListHost = lumine.workspace.addSelectList(
      {
        items: [],
        emptyMessage: "No repositories in this window",
        getItemId: (item) => item.id,
        search: { getFilterText: (item) => item.repoName },
        renderItem: (item, { highlight }) => {
          if (item.auto) {
            return {
              className: "git-center-item",
              icon: ["icon-sync"],
              primary: highlight(item.repoName),
              secondary: "The active repository is updated based on the active editor.",
            };
          }

          // The branch badge sits last so the working-tree and upstream detail
          // reads to its left, closest to the repository it describes.
          return {
            className: "git-center-item",
            icon: ["icon-repo"],
            primary: highlight(item.repoName),
            secondary: item.workingDirectory,
            trailing: [
              ...statusChips(item.status),
              ...divergenceChips(item.upstream),
              { text: item.branch, className: "badge badge-info" },
            ],
          };
        },
        source: {
          mode: "snapshot",
          loadingMessage: "Loading repositories…",
          load: () => this.loadItems(),
        },
        commands: {
          "git-center:use-selected-repository": {
            description: "Use the selected repository as the active repository.",
            didDispatch: ({ detail }) => this.useRepository(detail.item),
          },
          "git-center:refresh-repositories": {
            displayName: "Update Repositories",
            description: "Find repositories again and refresh their Git state.",
            didDispatch: () =>
              lumine.commands.dispatch(lumine.workspace.getElement(), "git:update-repositories"),
          },
        },
        actions: [
          {
            command: "git-center:use-selected-repository",
            context: "item",
            primary: true,
            disposition: "close",
          },
          {
            command: "git-center:refresh-repositories",
            context: "dialog",
            group: "List",
            disposition: "stay",
          },
        ],
      },
      { className: "git-center-repository-list" },
    );
    this.selectList = this.selectListHost.getModel();

    this.subscriptions.add(
      this.selectListHost.onDidOpen(() => this.observeRepositories()),
      this.selectListHost.onDidHide(() => {
        this.stopObservingRepositories();
        this.activeRescanIds.clear();
        this.rescanScrollTop = null;
        this.refreshRequested = false;
      }),
    );
  }

  useRepository(item) {
    if (item.auto) {
      lumine.repositories.setActiveRepository(null);
    } else {
      applySwitchItem(item, {
        pin: lumine.config.get("git-center.autoLockRepository"),
      });
    }
  }

  observeRepositories() {
    this.stopObservingRepositories();
    const subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = subscriptions;

    subscriptions.add(
      lumine.repositories.onDidChange(() => {
        if (!this.selectListHost.isVisible()) return;
        this.observeRepositories();
        this.scheduleRefresh();
      }),
      lumine.repositories.onDidChangeActiveRepository(() => {
        this.scheduleRefresh();
      }),
      lumine.repositories.onDidStartRescan(({ id }) => {
        if (this.activeRescanIds.size === 0) {
          this.rescanScrollTop = this.selectList.getScrollTop();
        }
        this.activeRescanIds.add(id);
        this.selectList.setItems([]).catch(() => {});
        this.selectList.setLoadingState({ message: "Loading repositories…" }).catch(() => {});
      }),
      lumine.repositories.onDidFinishRescan(({ id }) => {
        this.activeRescanIds.delete(id);
        if (this.activeRescanIds.size === 0) {
          const scrollTop = this.rescanScrollTop;
          this.rescanScrollTop = null;
          this.requestRefresh()
            .then(() => {
              if (scrollTop != null) this.selectList.setScrollTop(scrollTop);
            })
            .catch(() => {});
        }
      }),
    );

    for (const repository of lumine.repositories.getRepositories()) {
      subscriptions.add(
        repository.onDidChangeStatusSnapshot(() => {
          // The source that requested this first snapshot will publish the
          // complete row once its await resolves. Reloading here would cancel
          // and restart that source once per repository.
          if (!this.pendingStatusLoads.has(repository)) this.scheduleRefresh();
        }),
      );
    }
  }

  stopObservingRepositories() {
    this.repositorySubscriptions?.dispose();
    this.repositorySubscriptions = null;
  }

  scheduleRefresh() {
    if (this.refreshScheduled || !this.selectListHost.isVisible()) return;
    this.refreshScheduled = true;
    queueMicrotask(() => {
      this.refreshScheduled = false;
      this.requestRefresh().catch(() => {});
    });
  }

  requestRefresh() {
    if (!this.selectListHost.isVisible()) return Promise.resolve();
    this.refreshRequested = true;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.flushRefreshes().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async flushRefreshes() {
    while (this.refreshRequested && this.selectListHost.isVisible()) {
      this.refreshRequested = false;
      const scrollTop = this.selectList.getScrollTop();
      await this.selectList.reload();
      if (!this.selectListHost.isVisible()) return;
      await this.selectList.update({});
      this.selectList.setScrollTop(scrollTop);
    }
  }

  async loadItems() {
    if (this.activeRescanIds.size > 0) return [];
    const repositories = lumine.repositories.getRepositories();
    const pending = repositories.filter(
      (repository) => !repository.getStatusSnapshot?.().initialized,
    );
    for (const repository of pending) {
      this.pendingStatusLoads.set(repository, (this.pendingStatusLoads.get(repository) || 0) + 1);
    }

    // One row per repository, so the working directory identifies it.
    try {
      const items = (await buildRepositoryItems(repositories)).map((item) => ({
        ...item,
        id: `repo:${item.workingDirectory}`,
      }));
      const active = items.find((item) => item.active);
      const remaining = active ? items.filter((item) => item !== active) : items;
      return {
        sections: [
          { id: "context", items: [...CONTEXT_ITEMS, ...(active ? [active] : [])] },
          ...(remaining.length > 0 ? [{ id: "repositories", items: remaining }] : []),
        ],
      };
    } finally {
      for (const repository of pending) {
        const count = (this.pendingStatusLoads.get(repository) || 1) - 1;
        if (count === 0) this.pendingStatusLoads.delete(repository);
        else this.pendingStatusLoads.set(repository, count);
      }
    }
  }

  async toggle() {
    if (this.selectListHost.isVisible()) {
      this.selectListHost.cancel();
      return;
    }

    await this.selectListHost.show();
    if (this.selectListHost.isVisible()) await this.selectList.update({});
  }

  hide() {
    this.selectListHost.cancel();
  }

  destroy() {
    this.stopObservingRepositories();
    this.refreshRequested = false;
    this.subscriptions.dispose();
    return this.selectListHost.destroy();
  }
};
