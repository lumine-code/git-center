const path = require("path");

const { summarizeStatus } = require("./status-summary");

function repositoryWorkingDirectory(repository) {
  try {
    return repository?.getWorkingDirectory?.() || null;
  } catch {
    return null;
  }
}

function repositoryDisplayName(repository) {
  const workingDirectory = repositoryWorkingDirectory(repository);
  return workingDirectory ? path.basename(workingDirectory) : "repository";
}

// Human-readable label for a repository's current head: the branch name, a
// short commit id when detached, or the unborn branch's name before the first
// commit. Falls back to the synchronous cache until the snapshot loads.
function headLabel(repository) {
  const snapshot = repository?.getStatusSnapshot?.();
  if (snapshot?.initialized) {
    if (snapshot.head.detached) {
      return snapshot.head.oid ? snapshot.head.oid.slice(0, 7) : "";
    }
    return snapshot.head.name || "";
  }
  return repository?.getShortHead?.() || "";
}

// Full-ref consumers keep their richer snapshot preference. The branch tile
// reads the current status instead, without loading every ref in the worktree.
function headUpstream(repository, { preferStatus = false } = {}) {
  const snapshot = repository?.getStatusSnapshot?.();
  if (snapshot?.initialized) {
    if (snapshot.head?.unborn || snapshot.head?.detached) return null;
    if (preferStatus) return snapshot.upstream;
  }
  const refs = repository?.getRefsSnapshot?.();
  if (refs?.initialized) {
    const head = refs.branches?.find((branch) => branch.isHead);
    if (head) return head.upstream || null;
  }
  return snapshot?.initialized ? snapshot.upstream : null;
}

function startRefsRefresh(repository) {
  const refresh = { repository, pending: true, failed: false };
  refresh.promise = repository
    .refreshRefsSnapshot()
    .catch((error) => {
      refresh.failed = true;
      throw error;
    })
    .finally(() => {
      refresh.pending = false;
    });
  refresh.promise.catch(() => {});
  return refresh;
}

async function currentRefsAfterRefresh(refresh) {
  const snapshot = await refresh.promise;
  const current = refresh.repository.getRefsSnapshot?.();
  return current && (current === snapshot || current.generation > snapshot?.generation)
    ? current
    : snapshot || current;
}

function currentStatusAfterLoad(repository, snapshot) {
  const current = repository.getStatusSnapshot?.();
  return current?.initialized &&
    (!snapshot?.initialized || !(current.generation < snapshot.generation))
    ? current
    : snapshot;
}

// Git reports worktree paths with forward slashes on every platform, while a
// repository's working directory may arrive either way, so the two are only
// comparable once resolved.
function samePath(left, right) {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Git reports worktree paths with forward slashes on every platform. Normalize
// once, so what the picker shows and what the project is handed both use the
// separators the rest of the window does.
function worktreePath(worktree) {
  return worktree?.path ? path.normalize(worktree.path) : null;
}

// `refs/heads/feature` → `feature`. A detached or bare worktree has no branch.
function worktreeBranchName(worktree) {
  const ref = worktree?.branch;
  if (!ref) return null;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

// Which local branch refs are checked out in a worktree other than the given
// working directory. Git refuses to check one of these out — `fatal: '<branch>'
// is already used by worktree at '<path>'` — so the branch picker routes to the
// worktree that holds it instead of attempting a checkout that cannot succeed.
function worktreesByBranchRef(worktrees, excludedWorkingDirectory) {
  const index = new Map();
  for (const worktree of worktrees || []) {
    if (!worktree.branch || worktree.detached) continue;
    if (samePath(worktree.path, excludedWorkingDirectory)) continue;
    index.set(worktree.branch, { ...worktree, path: worktreePath(worktree) });
  }
  return index;
}

// The three ways to reach a worktree, shared by the worktree picker and the
// branch picker's "already checked out elsewhere" warning.
function openWorktree(worktreePath, mode = "current-window") {
  if (mode === "new-window") {
    lumine.application.openWindow({ pathsToOpen: [worktreePath], newWindow: true });
  } else if (mode === "add") {
    lumine.project.addPaths([worktreePath], { mustExist: true });
  } else {
    lumine.project.setState([worktreePath]);
  }
}

// Worktree writes report the way checkoutBranch does: `true` on success,
// `false` on a Git failure, `null` when nothing implements the operation.
// Nothing throws, so a dialog can decide whether to stay open from the result.
function runWorktreeOperation(repository, operationName, failureTitle, args = []) {
  const pathDetail =
    operationName === "worktreeMove"
      ? `Source: ${args[0]}\nDestination: ${args[1]}`
      : args[0]
        ? `Path: ${args[0]}`
        : "";
  const operations = repository?.getOperations?.();
  if (!operations || typeof operations[operationName] !== "function") {
    lumine.notifications.addError(failureTitle, {
      description: "This repository does not support worktree operations.",
      detail: pathDetail,
      dismissable: true,
    });
    return Promise.resolve(null);
  }
  return operations[operationName](...args)
    .then(() => true)
    .catch((error) => {
      lumine.notifications.addError(failureTitle, {
        detail: [pathDetail, error.stderr || error.message].filter(Boolean).join("\n\n"),
        dismissable: true,
      });
      return false;
    });
}

function checkoutBranch(repository, branchName, options = {}) {
  const operations = repository.getOperations?.();
  if (!operations) {
    lumine.notifications.addError("Cannot check out the branch", {
      description: "This repository does not support write operations.",
      detail: `Branch: ${branchName}`,
      dismissable: true,
    });
    return Promise.resolve(null);
  }
  return operations
    .checkout(branchName, options)
    .then(() => true)
    .catch((error) => {
      lumine.notifications.addError("Branch checkout failed", {
        detail: `Branch: ${branchName}\n\n${error.stderr || error.message}`,
        dismissable: true,
      });
      return false;
    });
}

// Describe rows from the available snapshots. The picker loads missing
// snapshots independently of publishing names and selection.
function buildRepositoryItems(
  repositories = lumine.repositories.getRepositories(),
  previousRows = new Map(),
) {
  const active = lumine.repositories.getActiveRepository();
  const current = new Set(repositories);
  for (const repository of previousRows.keys()) {
    if (!current.has(repository)) previousRows.delete(repository);
  }

  const items = repositories.map((repository) => {
    const snapshot = repository.getStatusSnapshot?.();
    const workingDirectory = repositoryWorkingDirectory(repository) || repository.getPath?.() || "";
    const isActive = repository === active;
    const branch = headLabel(repository) || (snapshot?.initialized ? "(no branch)" : null);
    const previous = previousRows.get(repository);
    if (
      previous &&
      previous.snapshot === snapshot &&
      previous.item.workingDirectory === workingDirectory &&
      previous.item.active === isActive &&
      previous.item.branch === branch
    ) {
      return previous.item;
    }
    const item = {
      id: `repo:${workingDirectory}`,
      repository,
      repoName: workingDirectory ? path.basename(workingDirectory) : "repository",
      workingDirectory,
      branch,
      current: true,
      active: isActive,
      status: summarizeStatus(snapshot),
      upstream: snapshot?.initialized ? snapshot.upstream : null,
    };
    previousRows.set(repository, { item, snapshot });
    return item;
  });

  return items.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.repoName.localeCompare(b.repoName);
  });
}

// Selecting a row makes its repository active; selecting a non-current branch
// also checks it out. Switch first so a failed checkout still lands in the
// target repository.
function applySwitchItem(item, { pin = false } = {}) {
  try {
    lumine.repositories.setActiveRepository(item.repository, { pin });
  } catch {
    // The repository was destroyed while the picker was open.
    return;
  }
  if (!item.current) {
    return checkoutBranch(item.repository, item.branch);
  }
}

module.exports = {
  applySwitchItem,
  buildRepositoryItems,
  checkoutBranch,
  currentRefsAfterRefresh,
  currentStatusAfterLoad,
  headLabel,
  headUpstream,
  openWorktree,
  repositoryDisplayName,
  repositoryWorkingDirectory,
  runWorktreeOperation,
  samePath,
  startRefsRefresh,
  worktreeBranchName,
  worktreePath,
  worktreesByBranchRef,
};
