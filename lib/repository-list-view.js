const { CompositeDisposable } = require("lumine");

const { applySwitchItem, buildRepositoryItems } = require("./helpers");
const { divergenceChips, statusChips } = require("./status-summary");

const CONTEXT_ITEMS = [{ id: "action:auto", auto: true, repoName: "Auto" }];
const MAX_PENDING_STATUS_LOADS = 3;

// Repository picker. Selecting a repository makes it the window's active
// repository and optionally pins it, according to the package setting.
module.exports = class RepositoryListView {
  constructor(window = lumine.workspace.getMainWindow()) {
    this.window = window;
    this.subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = null;
    this.activeRescanIds = new Set();
    this.rescanScrollTop = null;
    this.repositoryRows = new Map();
    this.statusSubscriptions = new Map();
    this.queuedStatusLoads = new Set();
    this.pendingStatusLoads = new Set();
    this.attemptedStatusLoads = new Set();
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
              ...(item.branch ? [{ text: item.branch, className: "badge badge-info" }] : []),
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
          "git-center:update-repositories": {
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
            command: "git-center:update-repositories",
            context: "dialog",
            group: "List",
            disposition: "stay",
          },
          {
            command: "git-center:initialize",
            context: "dialog",
            group: "Repository",
            dispatch: "opener",
            disposition: "push",
          },
          {
            command: "git-center:clone",
            context: "dialog",
            group: "Repository",
            dispatch: "opener",
            disposition: "push",
          },
        ],
      },
      { window, className: "git-center-repository-list" },
    );
    this.selectList = this.selectListHost.getModel();

    this.subscriptions.add(
      this.selectListHost.onDidOpen(() => this.observeRepositories()),
      this.selectListHost.onDidChangeVisible(({ visible }) => {
        if (!visible) this.stopObservingStatuses();
      }),
      this.selectListHost.onDidResume(() => this.scheduleRefresh()),
      this.selectListHost.onDidHide(() => {
        this.stopObservingRepositories();
        this.activeRescanIds.clear();
        this.rescanScrollTop = null;
        this.refreshRequested = false;
        this.queuedStatusLoads.clear();
        this.attemptedStatusLoads.clear();
        this.repositoryRows.clear();
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
      lumine.repositories.onDidChange(() => this.scheduleRefresh()),
      lumine.repositories.onDidChangeActiveRepository(() => {
        this.scheduleRefresh();
      }),
      this.selectList.onDidChangeSelection(() => {
        this.observeSelectedStatuses();
        this.startStatusLoads();
      }),
      lumine.repositories.onDidStartRescan(({ id }) => {
        if (this.activeRescanIds.size === 0) {
          this.rescanScrollTop = this.selectList.getScrollTop();
        }
        this.activeRescanIds.add(id);
        this.stopObservingStatuses();
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

    this.observeSelectedStatuses();
    this.startStatusLoads();
  }

  prioritizedRepositories() {
    return [
      lumine.repositories.getActiveRepository(),
      this.selectList.getSelectedItem()?.repository,
    ];
  }

  observeSelectedStatuses() {
    if (!this.selectListHost.isVisible() || this.activeRescanIds.size) return;
    const wanted = new Set(this.prioritizedRepositories());
    for (const [repository, subscription] of this.statusSubscriptions) {
      if (wanted.has(repository) && this.repositoryRows.has(repository)) continue;
      this.statusSubscriptions.delete(repository);
      subscription.dispose();
    }
    for (const repository of wanted) {
      if (!this.repositoryRows.has(repository) || this.statusSubscriptions.has(repository)) {
        continue;
      }
      if (!repository.getStatusSnapshot?.().initialized) continue;
      const subscription = repository.onDidChangeStatusSnapshot?.(() => this.scheduleRefresh());
      if (subscription) this.statusSubscriptions.set(repository, subscription);
    }
  }

  startStatusLoads() {
    if (
      !this.repositorySubscriptions ||
      !this.selectListHost.isVisible() ||
      this.activeRescanIds.size
    ) {
      return;
    }
    const prioritized = this.prioritizedRepositories();
    while (this.queuedStatusLoads.size && this.pendingStatusLoads.size < MAX_PENDING_STATUS_LOADS) {
      const repository =
        prioritized.find((item) => this.queuedStatusLoads.has(item)) ??
        this.queuedStatusLoads.values().next().value;
      this.queuedStatusLoads.delete(repository);
      if (!this.repositoryRows.has(repository) || repository.getStatusSnapshot?.().initialized)
        continue;
      this.attemptedStatusLoads.add(repository);
      this.pendingStatusLoads.add(repository);
      void Promise.resolve()
        .then(() => repository.ensureStatusSnapshot())
        .then(
          () => {
            if (this.repositoryRows.has(repository)) this.scheduleRefresh();
          },
          () => {},
        )
        .finally(() => {
          this.pendingStatusLoads.delete(repository);
          this.startStatusLoads();
        });
    }
  }

  stopObservingRepositories() {
    this.repositorySubscriptions?.dispose();
    this.repositorySubscriptions = null;
    this.stopObservingStatuses();
  }

  stopObservingStatuses() {
    for (const subscription of this.statusSubscriptions.values()) subscription.dispose();
    this.statusSubscriptions.clear();
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
    if (!this.selectListHost.isVisible() || this.activeRescanIds.size) return Promise.resolve();
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
      if (this.activeRescanIds.size) return;
      const scrollTop = this.selectList.getScrollTop();
      await this.selectList.setSections(this.loadItems().sections);
      if (!this.selectListHost.isVisible() || this.activeRescanIds.size) return;
      if (this.selectList.getLoadingState()) await this.selectList.setLoadingState(null);
      this.selectList.setScrollTop(scrollTop);
      this.observeSelectedStatuses();
      this.startStatusLoads();
    }
  }

  loadItems() {
    if (this.activeRescanIds.size > 0) return [];
    const items = buildRepositoryItems(lumine.repositories.getRepositories(), this.repositoryRows);
    for (const repository of this.queuedStatusLoads) {
      if (!this.repositoryRows.has(repository)) this.queuedStatusLoads.delete(repository);
    }
    for (const repository of this.attemptedStatusLoads) {
      if (!this.repositoryRows.has(repository)) this.attemptedStatusLoads.delete(repository);
    }
    for (const { repository } of items) {
      if (
        !this.repositoryRows.get(repository).snapshot?.initialized &&
        !this.pendingStatusLoads.has(repository) &&
        !this.attemptedStatusLoads.has(repository) &&
        typeof repository.ensureStatusSnapshot === "function"
      ) {
        this.queuedStatusLoads.add(repository);
      }
    }
    const active = items.find((item) => item.active);
    const remaining = active ? items.filter((item) => item !== active) : items;
    return {
      sections: [
        { id: "context", items: [...CONTEXT_ITEMS, ...(active ? [active] : [])] },
        ...(remaining.length > 0 ? [{ id: "repositories", items: remaining }] : []),
      ],
    };
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
    this.queuedStatusLoads.clear();
    this.attemptedStatusLoads.clear();
    this.repositoryRows.clear();
    this.subscriptions.dispose();
    return this.selectListHost.destroy();
  }
};
