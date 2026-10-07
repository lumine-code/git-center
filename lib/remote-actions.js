async function run(name, repository, options = {}) {
  repository ||= lumine.repositories.getActiveRepository();
  if (!repository) return false;
  const operations = repository.getOperations?.();
  if (!operations?.isAvailable(name)) {
    lumine.notifications.addWarning(`Git ${name} is unavailable for the active repository.`, {
      dismissable: true,
    });
    return false;
  }
  try {
    await operations[`${name}Current`](options);
    return true;
  } catch (error) {
    const notify =
      error.code === "ERR_GIT_REMOTE_CONTEXT" || error.outcome === "not-started"
        ? "addWarning"
        : "addError";
    lumine.notifications[notify](
      `Git ${name} ${error.outcome === "unknown" ? "outcome is unknown" : "failed"}`,
      {
        detail: error.stderr || error.message,
        dismissable: true,
      },
    );
    return false;
  }
}

const fetchRemote = (repository) => run("fetch", repository);
const pullRemote = (repository) => run("pull", repository);
const pushRemote = (repository, options) => run("push", repository, options);
const forcePushRemote = (repository) => run("push", repository, { force: true });

module.exports = { fetchRemote, forcePushRemote, pullRemote, pushRemote };
