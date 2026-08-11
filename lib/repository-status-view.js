const path = require("path");

const { CompositeDisposable, Disposable } = require("lumine");

const { repositoryDisplayName, repositoryWorkingDirectory } = require("./helpers");
const {
  renderChips,
  statusChips,
  statusTooltipLine,
  summarizeStatus,
} = require("./status-summary");

// Status bar tile showing the window's active repository context. Always
// visible: a context without a repository renders the focused directory in a
// dimmed "no repo" state instead of hiding.
module.exports = class RepositoryStatusView {
  constructor({ onDidClick } = {}) {
    this.element = document.createElement("status-bar-tile");
    this.element.classList.add("git-center-repository");

    this.icon = document.createElement("span");
    this.icon.classList.add("icon", "icon-repo");
    this.element.appendChild(this.icon);

    this.nameLabel = document.createElement("span");
    this.nameLabel.classList.add("repository-label");
    this.element.appendChild(this.nameLabel);

    this.statusLabel = document.createElement("span");
    this.statusLabel.classList.add("git-center-status");
    this.element.appendChild(this.statusLabel);

    const clickHandler = (event) => {
      event.preventDefault();
      onDidClick?.(this.element);
    };
    this.element.addEventListener("click", clickHandler);

    // Middle click toggles the pin ("lock") of the active repository.
    const auxClickHandler = (event) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      this.togglePin();
    };
    this.element.addEventListener("auxclick", auxClickHandler);

    // Wheeling over the tile cycles through the window's repositories.
    // Accumulate deltas so trackpads don't skip several repositories at once.
    this.wheelAccumulator = 0;
    const wheelHandler = (event) => {
      event.preventDefault();
      this.wheelAccumulator += event.deltaY;
      if (Math.abs(this.wheelAccumulator) < 60) {
        return;
      }
      const direction = this.wheelAccumulator > 0 ? 1 : -1;
      this.wheelAccumulator = 0;
      this.cycleRepository(direction);
    };
    this.element.addEventListener("wheel", wheelHandler, { passive: false });

    this.activeRepository = null;
    this.snapshotSubscription = null;

    this.subscriptions = new CompositeDisposable(
      new Disposable(() => {
        this.element.removeEventListener("click", clickHandler);
        this.element.removeEventListener("auxclick", auxClickHandler);
        this.element.removeEventListener("wheel", wheelHandler);
      }),
      lumine.repositories.observeActiveRepository(() => this.update()),
      lumine.repositories.onDidChange(() => this.update()),
    );
  }

  // Keep exactly one status snapshot subscription, targeting the active
  // repository. Subscribing declares interest, which makes the repository load
  // and refresh the snapshot on its own schedule.
  subscribeToActiveRepository(repository) {
    if (repository === this.activeRepository) {
      return;
    }
    this.snapshotSubscription?.dispose();
    this.activeRepository = repository;
    this.snapshotSubscription = repository?.onDidChangeStatusSnapshot(() => this.update());
  }

  cycleRepository(direction) {
    const repositories = lumine.repositories
      .getRepositories()
      .slice()
      .sort((a, b) => repositoryDisplayName(a).localeCompare(repositoryDisplayName(b)));
    if (repositories.length < 2) {
      return;
    }

    const active = lumine.repositories.getActiveRepository();
    const index = repositories.indexOf(active);
    // With no active repository there is nothing to step from, so enter the list
    // at the end the wheel is coming from. Stepping off index -1 would otherwise
    // land on the second-to-last repository when wheeling backwards.
    const next =
      index === -1
        ? repositories[direction > 0 ? 0 : repositories.length - 1]
        : repositories[(index + direction + repositories.length) % repositories.length];
    try {
      // A locked selection stays locked, retargeted to the new repository.
      lumine.repositories.setActiveRepository(next, {
        pin: lumine.repositories.isActiveRepositoryPinned(),
      });
    } catch {
      // The repository was destroyed mid-cycle.
    }
  }

  togglePin() {
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
  }

  getAnchorElement() {
    return this.element.style.display === "none" ? null : this.element;
  }

  update() {
    if (lumine.isDestroying) {
      return;
    }

    const { repository, workingDirectory, pinned } =
      lumine.repositories.getActiveRepositoryContext();
    this.subscribeToActiveRepository(repository);
    this.element.classList.toggle("no-repository", !repository);
    this.icon.classList.toggle("icon-repo", !pinned);
    this.icon.classList.toggle("icon-lock", pinned);
    this.tooltipDisposable?.dispose();

    if (repository) {
      this.nameLabel.textContent = repositoryDisplayName(repository);
      // The tile counts what changed; the branch tile carries the divergence.
      const summary = summarizeStatus(repository.getStatusSnapshot());
      renderChips(this.statusLabel, statusChips(summary));

      const repositoryDirectory = repositoryWorkingDirectory(repository) || "";
      const title = [
        pinned ? `${repositoryDirectory} (pinned)` : repositoryDirectory,
        statusTooltipLine(summary),
      ]
        .filter(Boolean)
        .join("\n");
      this.tooltipDisposable = lumine.tooltips.add(this.element, { title });
      return;
    }

    // The focused location is not inside any repository; show where a new one
    // would be initialized or cloned.
    this.nameLabel.textContent = workingDirectory
      ? path.basename(workingDirectory)
      : "No repository";
    renderChips(this.statusLabel, []);
    this.tooltipDisposable = lumine.tooltips.add(this.element, {
      title: workingDirectory ? `${workingDirectory} (not a repository)` : "No repository",
    });
  }

  destroy() {
    this.subscriptions.dispose();
    this.snapshotSubscription?.dispose();
    this.tooltipDisposable?.dispose();
    this.element.remove();
  }
};
