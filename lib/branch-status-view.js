const { CompositeDisposable, Disposable } = require("lumine");

const { headLabel, headUpstream } = require("./helpers");
const { divergenceChips, divergenceTooltipLine, renderChips } = require("./status-summary");

// Status bar tile showing the active repository's head and how far it has
// drifted from its upstream. Subscribing to both snapshots is what keeps them
// refreshed.
module.exports = class BranchStatusView {
  constructor({ onDidClick } = {}) {
    this.element = document.createElement("status-bar-tile");
    this.element.classList.add("git-center-branch");

    const branchIcon = document.createElement("span");
    branchIcon.classList.add("icon", "icon-git-branch");
    this.element.appendChild(branchIcon);

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

    this.subscriptions = new CompositeDisposable(
      new Disposable(() => this.element.removeEventListener("click", clickHandler)),
      lumine.repositories.observeActiveRepository(() => this.update()),
    );
  }

  getAnchorElement() {
    return this.element.style.display === "none" ? null : this.element;
  }

  // Keep exactly one subscription of each kind, targeting the active
  // repository. Subscribing declares interest, which makes the repository load
  // and refresh that snapshot on its own schedule — without a refs subscriber
  // the refs snapshot is loaded once and never updated again, so the upstream
  // this tile and the branch picker read would silently go stale.
  subscribeToActiveRepository(repository) {
    if (repository === this.activeRepository) {
      return;
    }
    this.snapshotSubscription?.dispose();
    this.refsSubscription?.dispose();
    this.activeRepository = repository;
    this.snapshotSubscription = repository?.onDidChangeStatusSnapshot(() => this.update());
    this.refsSubscription = repository?.onDidChangeRefsSnapshot(() => this.update());
  }

  update() {
    if (lumine.isDestroying) {
      return;
    }

    const repository = lumine.repositories.getActiveRepository();
    this.subscribeToActiveRepository(repository);

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
      [tooltip, divergence].filter(Boolean).map((title) => ({ title })),
    );
  }

  destroy() {
    this.subscriptions.dispose();
    this.snapshotSubscription?.dispose();
    this.refsSubscription?.dispose();
    this.branchTooltipDisposable?.dispose();
    this.element.remove();
  }
};
