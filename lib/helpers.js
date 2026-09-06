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

// Upstream tracking for the current head. The refs snapshot is preferred
// because it is the only source that reports a deleted upstream: the status
// snapshot has no `gone` field, and Git omits its `branch.ab` header entirely
// once the upstream commit is missing, which parses as zero ahead and zero
// behind — indistinguishable from being up to date.
function headUpstream(repository) {
  const refs = repository?.getRefsSnapshot?.();
  if (refs?.initialized) {
    const head = refs.branches?.find((branch) => branch.isHead);
    if (head) return head.upstream || null;
  }
  const snapshot = repository?.getStatusSnapshot?.();
  return snapshot?.initialized ? snapshot.upstream : null;
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
  const operations = repository?.getOperations?.();
  if (!operations || typeof operations[operationName] !== "function") {
    lumine.notifications.addError(failureTitle, {
      description: "This repository does not support worktree operations.",
      dismissable: true,
    });
    return Promise.resolve(null);
  }
  return operations[operationName](...args)
    .then(() => true)
    .catch((error) => {
      lumine.notifications.addError(failureTitle, {
        detail: error.stderr || error.message,
        dismissable: true,
      });
      return false;
    });
}

function checkoutBranch(repository, branchName, options = {}) {
  const operations = repository.getOperations?.();
  if (!operations) {
    lumine.notifications.addError(`Cannot check out '${branchName}'`, {
      description: "This repository does not support write operations.",
      dismissable: true,
    });
    return Promise.resolve(null);
  }
  return operations
    .checkout(branchName, options)
    .then(() => true)
    .catch((error) => {
      lumine.notifications.addError(`Checkout of '${branchName}' failed`, {
        detail: error.stderr || error.message,
        dismissable: true,
      });
      return false;
    });
}

// One row per repository, ordered with the active repository first. The status
// snapshot already carries the current branch, upstream divergence, and every
// working-tree change the row renders, so loading the much larger refs snapshot
// here would collect every branch, tag, remote, commit, and worktree only to
// throw all but the current branch away.
//
// `ensureStatusSnapshot` is called without options on purpose: the snapshot is
// shared, and asking for one without ignored entries would strip the ignore
// state tree-view and tabs read from it. `summarizeStatus` filters those entries
// instead. Repository rows deliberately never read refs, even from cache:
// branch-only facts such as a deleted upstream belong to the branch picker.
async function buildRepositoryItems(repositories = lumine.repositories.getRepositories()) {
  const active = lumine.repositories.getActiveRepository();

  const items = await Promise.all(
    repositories.map(async (repository) => {
      const snapshot = await repository.ensureStatusSnapshot?.().catch(() => null);
      const repoName = repositoryDisplayName(repository);
      const workingDirectory = repositoryWorkingDirectory(repository) || "";
      const isActive = repository === active;
      const status = summarizeStatus(snapshot);

      return {
        repository,
        repoName,
        workingDirectory,
        branch: headLabel(repository) || "(no branch)",
        current: true,
        active: isActive,
        status,
        upstream: snapshot?.initialized ? snapshot.upstream : null,
      };
    }),
  );

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
    checkoutBranch(item.repository, item.branch);
  }
}

module.exports = {
  applySwitchItem,
  buildRepositoryItems,
  checkoutBranch,
  headLabel,
  headUpstream,
  openWorktree,
  repositoryDisplayName,
  repositoryWorkingDirectory,
  runWorktreeOperation,
  samePath,
  worktreeBranchName,
  worktreePath,
  worktreesByBranchRef,
};
