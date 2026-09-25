const { CompositeDisposable, Disposable } = require("lumine");

const { headLabel, headUpstream } = require("./helpers");
const { divergenceChips, divergenceTooltipLine, renderChips } = require("./status-summary");

const REMOTE_OPERATION_STATES = {
  fetch: {
    animationClass: "animate-rotate",
    iconClass: "icon-sync",
    tooltip: "Fetching from remote",
  },
  pull: {
    animationClass: "animate-down",
    iconClass: "icon-arrow-down",
    tooltip: "Pulling from remote",
  },
  push: {
    animationClass: "animate-up",
    iconClass: "icon-arrow-up",
    tooltip: "Pushing to remote",
  },
};

const OPERATION_ICON_CLASSES = [
  "icon-git-branch",
  ...Object.values(REMOTE_OPERATION_STATES).flatMap(({ animationClass, iconClass }) => [
    animationClass,
    iconClass,
  ]),
];

// Status bar tile showing the active repository's head and how far it has
// drifted from its upstream. Subscribing to both snapshots is what keeps them
// refreshed.
module.exports = class BranchStatusView {
  constructor({ onDidClick, deferInitialUpdate = false } = {}) {
    this.element = document.createElement("status-bar-tile");
    this.element.classList.add("git-center-branch");

    this.branchIcon = document.createElement("span");
    this.branchIcon.classList.add("git-center-branch-icon", "icon", "icon-git-branch");
    this.element.appendChild(this.branchIcon);

    this.branchLabel = document.createElement("span");
    this.branchLabel.classList.add("branch-label");
    this.element.appendChild(this.branchLabel);

    this.divergenceLabel = document.createElement("span");
    this.divergenceLabel.classList.add("git-center-status");
    this.element.appendChild(this.divergenceLabel);

    const clickHandler = (event) => {
      event.preventDefault();
      onDidClick?.(this.element);
    };
    this.element.addEventListener("click", clickHandler);

    this.activeRepository = null;
    this.snapshotSubscription = null;
    this.refsSubscription = null;
    this.operationSubscriptions = null;

    const observeActiveRepository = deferInitialUpdate
      ? (callback) => lumine.repositories.onDidChangeActiveRepository(callback)
      : (callback) => lumine.repositories.observeActiveRepository(callback);
    this.subscriptions = new CompositeDisposable(
      new Disposable(() => this.element.removeEventListener("click", clickHandler)),
      observeActiveRepository(() => this.update()),
    );
    if (deferInitialUpdate) {
      queueMicrotask(() => {
        if (!this.destroyed) this.update();
      });
    }
  }

  getAnchorElement() {
    return this.element.style.display === "none" ? null : this.element;
  }

  // Keep exactly one subscription of each kind, targeting the active
  // repository. Subscribing declares interest, which makes the repository load
  // and refresh that snapshot on its own schedule — without a refs subscriber
  // the refs snapshot is loaded once and never updated again, so the upstream
  // this tile and the branch picker read would silently go stale. Operation
  // lifecycle events drive the fetch/pull/push animation no matter which
  // package initiated the operation.
  subscribeToActiveRepository(repository) {
    if (repository === this.activeRepository) {
      return;
    }
    this.snapshotSubscription?.dispose();
    this.refsSubscription?.dispose();
    this.operationSubscriptions?.dispose();
    this.activeRepository = repository;
    this.snapshotSubscription = repository?.onDidChangeStatusSnapshot(() => this.update());
    this.refsSubscription = repository?.onDidChangeRefsSnapshot(() => this.update());
    const operations = repository?.getOperations?.();
    this.operationSubscriptions = operations
      ? new CompositeDisposable(
          operations.onDidStartOperation(() => this.update()),
          operations.onDidFinishOperation(() => this.update()),
        )
      : null;
  }

  updateOperationIcon(repository) {
    const runningOperation = repository
      ?.getOperations?.()
      ?.getPendingOperations()
      .find(({ name, status }) => status === "running" && REMOTE_OPERATION_STATES[name]);
    const operationState = REMOTE_OPERATION_STATES[runningOperation?.name] || null;

    this.branchIcon.classList.remove(...OPERATION_ICON_CLASSES);
    if (operationState) {
      this.branchIcon.classList.add(operationState.iconClass, operationState.animationClass);
      this.element.setAttribute("aria-busy", "true");
    } else {
      this.branchIcon.classList.add("icon-git-branch");
      this.element.removeAttribute("aria-busy");
    }
    return operationState;
  }

  update() {
    if (lumine.isDestroying) {
      return;
    }

    const repository = lumine.repositories.getActiveRepository();
    this.subscribeToActiveRepository(repository);
    const operationState = this.updateOperationIcon(repository);

    if (!repository) {
      // The active context has no repository, so there is no branch to show or
      // switch; hide the tile entirely.
      this.element.style.display = "none";
      this.branchLabel.textContent = "";
      this.branchTooltipDisposable?.dispose();
      this.branchTooltipDisposable = null;
      return;
    }

    const snapshot = repository.getStatusSnapshot();
    const head = headLabel(repository);
    this.branchLabel.textContent = head;
    // A repository is active again, so the tile comes back — unless there is no
    // head to name, which reads as nothing at all rather than as an empty chip.
    this.element.style.display = head ? "" : "none";

    // The tile reports drift from upstream; the repository tile carries the
    // working-tree counts. A detached or unborn head has no upstream to report.
    const upstream = headUpstream(repository);
    renderChips(this.divergenceLabel, divergenceChips(upstream));

    let tooltip = `On branch ${head}`;
    if (snapshot.initialized && snapshot.head.detached) {
      tooltip = `Detached at ${head}`;
    } else if (snapshot.initialized && snapshot.head.unborn) {
      tooltip = `On unborn branch ${head}`;
    }
    const divergence = divergenceTooltipLine(upstream);
    this.branchTooltipDisposable?.dispose();
    this.branchTooltipDisposable = lumine.tooltips.addComposite(
      this.element,
      [
        { title: tooltip },
        operationState && { title: operationState.tooltip },
        divergence && { title: divergence },
        {
          title: "Select branch",
          keyBindingExtra: "LMB",
          keyBindingCommand: "git-center:select-branch",
        },
      ].filter(Boolean),
    );
  }

  destroy() {
    this.destroyed = true;
    this.subscriptions.dispose();
    this.snapshotSubscription?.dispose();
    this.refsSubscription?.dispose();
    this.operationSubscriptions?.dispose();
    this.branchTooltipDisposable?.dispose();
    this.element.remove();
  }
};
