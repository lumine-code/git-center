function activeRepository() {
  return lumine.repositories.getActiveRepository();
}

function notifyUnavailable(message) {
  lumine.notifications.addWarning(message, { dismissable: true });
}

function targetParts(target) {
  const name = target?.name || "";
  const separator = name.indexOf("/");
  if (separator <= 0 || separator === name.length - 1) return null;
  return {
    remote: name.slice(0, separator),
    reference: name.slice(separator + 1),
  };
}

function fallbackRemote(refs) {
  if (refs.remotes.length === 1) return refs.remotes[0].name;
  return refs.remotes.find((remote) => remote.name === "origin")?.name || null;
}

async function prepare(repository, operationName) {
  if (!repository) return null;
  const operations = repository.getOperations?.();
  if (!operations?.isAvailable(operationName)) {
    notifyUnavailable(`Git ${operationName} is unavailable for the active repository.`);
    return null;
  }

  const refs = await repository.ensureRefsSnapshot();
  const branch = refs.branches.find((entry) => entry.isHead);
  if (!branch) {
    notifyUnavailable(`Git ${operationName} requires an active local branch.`);
    return null;
  }
  return { branch, operations, refs };
}

async function run(operationName, repository, callback) {
  try {
    const context = await prepare(repository || activeRepository(), operationName);
    if (!context) return false;
    return (await callback(context)) !== false;
  } catch (error) {
    lumine.notifications.addError(`Git ${operationName} failed`, {
      detail: error.stderr || error.message,
      dismissable: true,
    });
    return false;
  }
}

function fetchRemote(repository) {
  return run("fetch", repository, ({ branch, operations, refs }) => {
    const target = targetParts(branch.upstream) || targetParts(branch.push);
    const remote = target?.remote || fallbackRemote(refs);
    if (!remote) {
      notifyUnavailable("The current branch does not identify a remote to fetch.");
      return false;
    }
    return operations.fetch(remote, null);
  });
}

function pullRemote(repository) {
  return run("pull", repository, ({ branch, operations }) => {
    const upstream = targetParts(branch.upstream);
    if (!upstream) {
      notifyUnavailable("The current branch has no upstream to pull from.");
      return false;
    }
    return operations.pull(upstream.remote, upstream.reference);
  });
}

function pushRemote(repository, { force = false } = {}) {
  return run("push", repository, ({ branch, operations, refs }) => {
    const target = targetParts(branch.push) || targetParts(branch.upstream);
    const remote = target?.remote || fallbackRemote(refs);
    if (!remote) {
      notifyUnavailable("The current branch does not identify a remote to push to.");
      return false;
    }
    return operations.push(remote, branch.name, {
      force,
      setUpstream: !target,
    });
  });
}

function forcePushRemote(repository) {
  return pushRemote(repository, { force: true });
}

module.exports = { fetchRemote, forcePushRemote, pullRemote, pushRemote };
