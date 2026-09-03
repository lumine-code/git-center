const path = require("path");

const { CompositeDisposable } = require("lumine");

const {
  applySwitchItem,
  checkoutBranch,
  openWorktree,
  repositoryWorkingDirectory,
  worktreesByBranchRef,
} = require("./helpers");
const { divergenceChips, statusChips, summarizeStatus } = require("./status-summary");
const TextDialog = require("./text-dialog");

const ACTIONS = [
  {
    id: "action:create",
    action: "create",
    branch: "Create new branch...",
    icon: "icon-plus",
    crumb: "New branch",
  },
  {
    id: "action:create-from",
    action: "create-from",
    branch: "Create new branch from...",
    icon: "icon-plus",
    crumb: "Create from",
  },
  {
    id: "action:detach",
    action: "detach",
    branch: "Checkout detached...",
    icon: "icon-git-commit",
    crumb: "Detach",
  },
];

const BRANCH_NAME_PROMPT = {
  prompt: "Please provide a new branch name",
  placeholder: "Branch name",
  emptyMessage: "Enter a branch name.",
};

const RELATIVE_TIME_UNITS = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

function formatRelativeTime(date, now = Date.now()) {
  const timestamp = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return null;

  const elapsed = now - timestamp;
  const magnitude = Math.abs(elapsed);
  if (magnitude < 60 * 1000) return "now";

  for (const [unit, milliseconds] of RELATIVE_TIME_UNITS) {
    if (magnitude < milliseconds) continue;
    const value = Math.max(1, Math.round(magnitude / milliseconds));
    const amount = `${value} ${unit}${value === 1 ? "" : "s"}`;
    return elapsed >= 0 ? `${amount} ago` : `in ${amount}`;
  }
  return "now";
}

function primaryForItem(item, highlight) {
  const primary = document.createDocumentFragment();
  primary.appendChild(highlight(item.branch));
  const relativeTime = formatRelativeTime(item.lastCommit?.committerDate);
  if (relativeTime) {
    const time = document.createElement("span");
    time.classList.add("git-center-ref-time");
    time.textContent = ` ${relativeTime}`;
    primary.appendChild(time);
  }
  return primary;
}

function worktreeName(worktree) {
  return path.basename(worktree.path) || worktree.path;
}

function detailForItem(item) {
  const commit = item.lastCommit;
  if (!commit) return undefined;
  return [commit.authorName, commit.oid?.slice(0, 7), commit.subject]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" • ");
}

// Checkout picker for the active repository. Local branches switch directly,
// remote branches resolve to a tracking local branch, and tags detach HEAD.
module.exports = class BranchListView {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.branchRepositorySubscriptions = null;
    this.referenceRepositorySubscriptions = null;
    this.branchNameDialog = new TextDialog({ className: "git-center-branch-name-dialog" });
    this.selectListView = lumine.workspace.buildSelectList({
      className: "git-center-branch-list",
      crumb: "Branches",
      items: [],
      emptyMessage: "No branches or tags yet",
      getItemId: (item) => item.id,
      search: {
        getFilterText: (item) =>
          item.action
            ? item.branch
            : [
                item.branch,
                item.lastCommit?.authorName,
                item.lastCommit?.oid,
                item.lastCommit?.subject,
              ]
                .filter(Boolean)
                .join(" "),
      },
      renderItem: (item, { highlight }) => {
        const className = ["git-center-item"];
        if (item.action) {
          className.push("git-center-branch-action");
          if (item.action === "detach") className.push("git-center-branch-action-last");
        }
        return {
          className,
          icon: [item.icon || "icon-git-branch"],
          primary: item.action ? highlight(item.branch) : primaryForItem(item, highlight),
          // Action rows stay one line; refs carry their target commit below.
          secondary: item.action ? undefined : detailForItem(item),
          trailing: [
            // Only the checked-out branch has a working tree to report on.
            ...(item.current ? statusChips(item.status) : []),
            ...divergenceChips(item.upstream),
            item.current && { text: "current", className: "badge" },
            item.worktree && {
              text: worktreeName(item.worktree),
              className: "badge git-center-branch-worktree",
            },
          ],
        };
      },
      source: {
        mode: "snapshot",
        loadingMessage: "Loading branches…",
        load: () => this.loadBranchItems(),
      },
      commands: {
        "git-center:checkout-selected-reference": {
          description: "Check out the selected branch or tag.",
          didDispatch: ({ detail }) => this.confirmCheckoutItem(detail.item),
        },
        "git-center:create-branch": {
          description: "Create a new branch from HEAD.",
          didDispatch: () => this.performAction("create"),
        },
        "git-center:create-branch-from-reference": {
          description: "Choose a reference from which to create a new branch.",
          didDispatch: () => this.performAction("create-from"),
        },
        "git-center:checkout-detached": {
          description: "Choose a reference to check out without a branch.",
          didDispatch: () => this.performAction("detach"),
        },
      },
      actions: this.branchActions(),
    });

    this.referenceListView = lumine.workspace.buildSelectList({
      className: "git-center-reference-list",
      items: [],
      emptyMessage: "No references yet",
      getItemId: (item) => item.id,
      search: { getFilterText: (item) => `${item.label} ${item.detail}` },
      renderItem: (item, { highlight }) => ({
        className: "git-center-item",
        icon: [item.icon],
        primary: highlight(item.label),
        secondary: item.detail || undefined,
      }),
      source: {
        mode: "snapshot",
        loadingMessage: "Loading references…",
        load: () => this.loadReferenceItems(),
      },
      commands: {
        "git-center:create-branch-from-selected-reference": {
          description: "Create a new branch from the selected reference.",
          didDispatch: ({ detail }) => this.confirmReference(detail.item),
        },
        "git-center:checkout-selected-reference-detached": {
          description: "Check out the selected reference without a branch.",
          didDispatch: ({ detail }) => this.confirmReference(detail.item),
        },
      },
      actions: this.referenceActions(),
    });

    this.subscriptions.add(
      this.selectListView.onDidOpen(() => this.observeActiveRepository()),
      this.selectListView.onDidHide(() => this.stopObservingActiveRepository()),
      this.referenceListView.onDidOpen(() => this.observeReferenceRepository()),
      this.referenceListView.onDidHide(() => this.stopObservingReferenceRepository()),
    );
  }

  branchActions() {
    return [
      {
        command: "git-center:checkout-selected-reference",
        context: "item",
        when: ({ item }) => !item.action,
        primary: true,
        disposition: "close",
      },
      ...ACTIONS.map((item) => ({
        command: {
          create: "git-center:create-branch",
          "create-from": "git-center:create-branch-from-reference",
          detach: "git-center:checkout-detached",
        }[item.action],
        context: "item",
        when: ({ item: selected }) => selected.action === item.action,
        primary: true,
        disposition: "push",
      })),
    ];
  }

  referenceActions() {
    return [
      {
        command: "git-center:create-branch-from-selected-reference",
        context: "item",
        when: () => this.pendingReference?.action === "create-from",
        primary: true,
        disposition: "push",
      },
      {
        command: "git-center:checkout-selected-reference-detached",
        context: "item",
        when: () => this.pendingReference?.action === "detach",
        primary: true,
        disposition: "close",
      },
    ];
  }

  observeActiveRepository() {
    this.stopObservingActiveRepository();
    const subscriptions = new CompositeDisposable();
    this.branchRepositorySubscriptions = subscriptions;
    const repository = lumine.repositories.getActiveRepository();

    subscriptions.add(
      lumine.repositories.onDidChangeActiveRepository(() => {
        if (!this.selectListView.isVisible()) return;
        this.observeActiveRepository();
        this.requestBranchRefresh().catch(() => {});
      }),
    );
    if (repository) {
      subscriptions.add(
        repository.onDidChangeStatusSnapshot(() => {
          this.requestBranchRefresh().catch(() => {});
        }),
        repository.onDidChangeRefsSnapshot(() => {
          this.requestBranchRefresh().catch(() => {});
        }),
      );
    }
  }

  stopObservingActiveRepository() {
    this.branchRepositorySubscriptions?.dispose();
    this.branchRepositorySubscriptions = null;
  }

  observeReferenceRepository() {
    this.stopObservingReferenceRepository();
    const repository = this.pendingReference?.repository;
    if (!repository) return;
    const subscriptions = new CompositeDisposable();
    this.referenceRepositorySubscriptions = subscriptions;
    subscriptions.add(
      repository.onDidChangeRefsSnapshot(() => {
        this.requestReferenceRefresh().catch(() => {});
      }),
    );
  }

  stopObservingReferenceRepository() {
    this.referenceRepositorySubscriptions?.dispose();
    this.referenceRepositorySubscriptions = null;
  }

  async requestBranchRefresh() {
    if (!this.selectListView.isVisible()) return Promise.resolve();
    const scrollTop = this.selectListView.getScrollTop();
    await this.selectListView.reload();
    await this.selectListView.update({});
    this.selectListView.setScrollTop(scrollTop);
  }

  async loadBranchItems() {
    const repository = lumine.repositories.getActiveRepository();
    if (!repository) return [];
    const [refs, statusSnapshot] = await Promise.all([
      repository.ensureRefsSnapshot?.().catch(() => null),
      repository.ensureStatusSnapshot?.().catch(() => null),
    ]);
    const [local, remote, tags] = this.buildCheckoutGroups(
      repository,
      refs,
      summarizeStatus(statusSnapshot),
    );
    return {
      sections: [
        { id: "actions", items: ACTIONS },
        ...(local.length > 0 ? [{ id: "local", items: local }] : []),
        ...(remote.length > 0 ? [{ id: "remote", items: remote }] : []),
        ...(tags.length > 0 ? [{ id: "tags", items: tags }] : []),
      ],
    };
  }

  buildCheckoutGroups(repository, refs, status) {
    // A branch checked out in another worktree cannot be checked out here, and
    // `%(HEAD)` only marks the one this worktree holds — so without this the
    // row looks ordinary and Enter fails with a raw `fatal:`.
    const heldElsewhere = worktreesByBranchRef(
      refs?.worktrees,
      repositoryWorkingDirectory(repository),
    );

    const localBranches = (refs?.branches || [])
      .map((branch) => ({
        id: `branch:${branch.name}`,
        repository,
        kind: "local",
        branch: branch.name,
        reference: branch.name,
        oid: branch.oid,
        icon: "icon-git-branch",
        current: branch.isHead,
        worktree: heldElsewhere.get(branch.ref) || null,
        status,
        upstream: branch.upstream || null,
        lastCommit: branch.lastCommit || null,
      }))
      .sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        return a.branch.localeCompare(b.branch);
      });

    if (!localBranches.some((item) => item.current)) {
      const head = refs?.head;
      const matchingRef = [
        ...(refs?.branches || []),
        ...(refs?.remoteBranches || []),
        ...(refs?.tags || []),
      ].find((entry) => entry.lastCommit?.oid === head?.oid);
      localBranches.unshift({
        id: "head",
        repository,
        kind: "head",
        branch: head?.name || (head?.oid ? head.oid.slice(0, 7) : "(no branch)"),
        reference: "HEAD",
        oid: head?.oid || null,
        icon: "icon-git-commit",
        current: true,
        status,
        upstream: null,
        lastCommit: matchingRef?.lastCommit || null,
      });
    }

    const remoteBranches = (refs?.remoteBranches || [])
      .filter((branch) => !branch.symrefTarget)
      .map((branch) => {
        const trackingBranch = (refs?.branches || []).find(
          (localBranch) => localBranch.upstream?.ref === branch.ref,
        );
        return {
          id: `remote:${branch.name}`,
          repository,
          kind: "remote",
          branch: branch.name,
          reference: branch.name,
          oid: branch.oid,
          icon: "icon-cloud-download",
          current: false,
          status: null,
          upstream: null,
          trackingBranch: trackingBranch?.name || null,
          trackingBranchCurrent: Boolean(trackingBranch?.isHead),
          localBranchName: branch.name.slice(branch.remoteName.length + 1),
          lastCommit: branch.lastCommit || null,
        };
      })
      .sort((a, b) => a.branch.localeCompare(b.branch));

    const tags = (refs?.tags || [])
      .map((tag) => ({
        id: `tag:${tag.name}`,
        repository,
        kind: "tag",
        branch: tag.name,
        reference: tag.ref,
        oid: tag.targetOid,
        icon: "icon-tag",
        current: false,
        status: null,
        upstream: null,
        lastCommit: tag.lastCommit || null,
      }))
      .sort((a, b) => a.branch.localeCompare(b.branch));

    return [localBranches, remoteBranches, tags];
  }

  confirmCheckoutItem(item) {
    if (item.worktree) {
      this.reportBranchHeldByWorktree(item);
      return;
    }
    if (item.kind === "local" || item.kind === "head") {
      applySwitchItem(item);
      return;
    }
    if (item.kind === "remote") {
      if (item.trackingBranch) {
        if (!item.trackingBranchCurrent) checkoutBranch(item.repository, item.trackingBranch);
      } else {
        checkoutBranch(item.repository, item.localBranchName, {
          createNew: true,
          track: true,
          startPoint: item.reference,
        });
      }
      return;
    }
    if (item.kind === "tag") {
      checkoutBranch(item.repository, item.reference, { detach: true });
    }
  }

  // Git would refuse this checkout outright. The branch is not unreachable
  // though — it is open somewhere else — so say where, and offer to go there.
  reportBranchHeldByWorktree(item) {
    const location = item.worktree.path;
    lumine.notifications.addWarning(`'${item.branch}' is checked out in another worktree`, {
      description: `Git allows one worktree per branch. It is open at \`${location}\`.`,
      dismissable: true,
      buttons: [
        { text: "Open Worktree", onDidClick: () => openWorktree(location) },
        {
          text: "Open in New Window",
          onDidClick: () => openWorktree(location, "new-window"),
        },
      ],
    });
  }

  async requestReferenceRefresh() {
    if (!this.referenceListView.isVisible()) return Promise.resolve();
    const scrollTop = this.referenceListView.getScrollTop();
    await this.referenceListView.reload();
    await this.referenceListView.update({});
    this.referenceListView.setScrollTop(scrollTop);
  }

  async loadReferenceItems() {
    const repository = this.pendingReference?.repository;
    if (!repository) return [];
    const refs = await repository.ensureRefsSnapshot?.().catch(() => null);
    return this.buildReferenceItems(refs);
  }

  performAction(action) {
    const repository = lumine.repositories.getActiveRepository();
    if (!repository) return;

    // The next step shows itself as a flow step, which hides this list as a
    // transition — the trail keeps it as the previous breadcrumb entry.
    if (action === "create") {
      this.branchNameDialog.show({
        ...BRANCH_NAME_PROMPT,
        crumb: ACTIONS.find((entry) => entry.action === action).crumb,
        onConfirm: (name) => checkoutBranch(repository, name, { createNew: true }),
      });
    } else {
      return this.showReferenceList(action, repository);
    }
  }

  async showReferenceList(action, repository) {
    this.pendingReference = { action, repository };
    await this.referenceListView.show({
      crumb: ACTIONS.find((entry) => entry.action === action).crumb,
    });
    await this.referenceListView.update({});
  }

  buildReferenceItems(refs) {
    const items = [];
    if (refs?.head?.oid) {
      items.push({
        id: "head:HEAD",
        reference: "HEAD",
        label: "HEAD",
        detail: refs.head.name || refs.head.oid.slice(0, 7),
        icon: "icon-git-commit",
      });
    }
    for (const branch of refs?.branches || []) {
      items.push({
        id: `branch:${branch.name}`,
        reference: branch.name,
        label: branch.name,
        detail: "Local branch",
        icon: "icon-git-branch",
      });
    }
    for (const branch of refs?.remoteBranches || []) {
      if (branch.symrefTarget) continue;
      items.push({
        id: `remote:${branch.name}`,
        reference: branch.name,
        label: branch.name,
        detail: "Remote branch",
        icon: "icon-cloud-download",
      });
    }
    for (const tag of refs?.tags || []) {
      items.push({
        id: `tag:${tag.name}`,
        reference: tag.name,
        label: tag.name,
        detail: "Tag",
        icon: "icon-tag",
      });
    }
    return items;
  }

  confirmReference(item) {
    const { action, repository } = this.pendingReference ?? {};
    if (!repository) return;

    if (action === "detach") {
      checkoutBranch(repository, item.reference, { detach: true });
    } else if (action === "create-from") {
      // The dialog shows itself as the next step; going back from it returns
      // to this reference list with its items and filter intact.
      this.branchNameDialog.show({
        ...BRANCH_NAME_PROMPT,
        crumb: item.reference,
        onConfirm: (name) =>
          checkoutBranch(repository, name, { createNew: true, startPoint: item.reference }),
      });
    }
  }

  async toggle() {
    if (this.selectListView.isVisible()) {
      this.selectListView.cancel();
      return;
    }
    const repository = lumine.repositories.getActiveRepository();
    if (!repository) {
      return;
    }

    await this.selectListView.show();
    await this.selectListView.update({});
  }

  destroy() {
    this.stopObservingActiveRepository();
    this.stopObservingReferenceRepository();
    this.subscriptions.dispose();
    this.selectListView.destroy();
    this.referenceListView.destroy();
    this.branchNameDialog.destroy();
  }
};
