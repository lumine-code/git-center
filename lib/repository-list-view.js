const { CompositeDisposable } = require("lumine");

const { applySwitchItem, buildSwitchItems } = require("./helpers");
const { divergenceChips, statusChips } = require("./status-summary");

const ACTIONS = [
  { id: "action:auto", auto: true, repoName: "Auto" },
  { id: "action:update", update: true, repoName: "Update repositories" },
];

// Repository picker. Selecting a repository makes it the window's active
// repository (unpinned).
module.exports = class RepositoryListView {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = null;
    this.activeRescanIds = new Set();
    this.rescanScrollTop = null;
    this.selectListView = lumine.workspace.buildSelectList({
      className: "git-center-repository-list",
      items: [],
      emptyMessage: "No repositories in this window",
      getItemId: (item) => item.id,
      search: { getFilterText: (item) => item.repoName },
      renderItem: (item, { highlight }) => {
        if (item.update) {
          return {
            className: "git-center-item",
            icon: ["icon-sync"],
            primary: highlight(item.repoName),
            secondary: "Find repositories again and refresh their Git state.",
          };
        }
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
          description: "Find repositories again and refresh their Git state.",
          didDispatch: () =>
            lumine.commands.dispatch(lumine.workspace.getElement(), "git:update-repositories"),
        },
      },
      actions: [
        {
          command: "git-center:use-selected-repository",
          context: "item",
          when: ({ item }) => !item.update,
          primary: true,
          disposition: "close",
        },
        {
          command: "git-center:refresh-repositories",
          context: "item",
          when: ({ item }) => Boolean(item.update),
          primary: true,
          disposition: "stay",
        },
      ],
    });

    this.subscriptions.add(
      this.selectListView.onDidOpen(() => this.observeRepositories()),
      this.selectListView.onDidHide(() => {
        this.stopObservingRepositories();
        this.activeRescanIds.clear();
        this.rescanScrollTop = null;
      }),
    );
  }

  useRepository(item) {
    if (item.auto) {
      lumine.repositories.setActiveRepository(null);
    } else {
      applySwitchItem(item, { pin: true });
    }
  }

  observeRepositories() {
    this.stopObservingRepositories();
    const subscriptions = new CompositeDisposable();
    this.repositorySubscriptions = subscriptions;

    subscriptions.add(
      lumine.repositories.onDidChange(() => {
        if (!this.selectListView.isVisible()) return;
        this.observeRepositories();
        this.requestRefresh().catch(() => {});
      }),
      lumine.repositories.onDidChangeActiveRepository(() => {
        this.requestRefresh().catch(() => {});
      }),
      lumine.repositories.onDidStartRescan(({ id }) => {
        if (this.activeRescanIds.size === 0) {
          this.rescanScrollTop = this.selectListView.getScrollTop();
        }
        this.activeRescanIds.add(id);
        this.selectListView.setItems([]).catch(() => {});
        this.selectListView.setLoadingState({ message: "Loading repositories…" }).catch(() => {});
      }),
      lumine.repositories.onDidFinishRescan(({ id }) => {
        this.activeRescanIds.delete(id);
        if (this.activeRescanIds.size === 0) {
          const scrollTop = this.rescanScrollTop;
          this.rescanScrollTop = null;
          this.requestRefresh()
            .then(() => {
              if (scrollTop != null) this.selectListView.setScrollTop(scrollTop);
            })
            .catch(() => {});
        }
      }),
    );

    for (const repository of lumine.repositories.getRepositories()) {
      subscriptions.add(
        repository.onDidChangeStatusSnapshot(() => {
          this.requestRefresh().catch(() => {});
        }),
        repository.onDidChangeRefsSnapshot(() => {
          this.requestRefresh().catch(() => {});
        }),
      );
    }
  }

  stopObservingRepositories() {
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
    if (this.activeRescanIds.size > 0) return [];
    // One row per repository, so the working directory identifies it.
    const repositories = (await buildSwitchItems())
      .filter((item) => item.current)
      .map((item) => ({ ...item, id: `repo:${item.workingDirectory}` }));
    return {
      sections: [
        { id: "actions", items: ACTIONS },
        ...(repositories.length > 0 ? [{ id: "repositories", items: repositories }] : []),
      ],
    };
  }

  async toggle() {
    if (this.selectListView.isVisible()) {
      this.selectListView.cancel();
      return;
    }

    await this.selectListView.show();
    await this.selectListView.update({});
  }

  hide() {
    this.selectListView.cancel();
  }

  destroy() {
    this.stopObservingRepositories();
    this.subscriptions.dispose();
    this.selectListView.destroy();
  }
};
