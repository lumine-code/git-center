const fs = require("node:fs/promises");
const path = require("node:path");

function captureDirectoryContext(options = {}, treeSelection = null) {
  const event = options.event;
  const savedContext = event?.context;
  const resolvedContext = savedContext?.window
    ? savedContext
    : lumine.workspace.resolveCommandContext(event);
  const commandContext = savedContext ?? resolvedContext;
  const window =
    savedContext?.window ?? resolvedContext?.window ?? lumine.workspace.getMainWindow();
  let entries;

  if (typeof options.directoryPath === "string" && options.directoryPath.length > 0) {
    entries = [{ path: options.directoryPath, kind: "directory" }];
  } else if (event?.target?.closest?.(".tree-view")) {
    // An empty tree selection belongs to that tree, even if another document
    // or a pinned repository still has a path elsewhere in the workspace.
    entries = treeSelection?.getSelectionSnapshot?.().entries ?? [];
  } else {
    const item = commandContext?.documentItem;
    const fileEditor = commandContext?.fileEditor;
    const documentPath = item?.isDestroyed?.()
      ? null
      : item?.getPath?.() || (fileEditor?.isDestroyed?.() ? null : fileEditor?.getPath?.());
    entries = documentPath ? [{ path: documentPath, kind: "unknown" }] : [];
  }

  return Object.freeze({
    window,
    entries: Object.freeze(
      entries
        .filter((entry) => typeof entry.path === "string" && entry.path.length > 0)
        .map((entry) => Object.freeze({ path: entry.path, kind: entry.kind })),
    ),
  });
}

async function resolveDirectoryCandidates(context) {
  const directories = [];
  const seen = new Set();
  for (const entry of context.entries) {
    let directoryPath;
    if (entry.kind === "directory") directoryPath = entry.path;
    else if (entry.kind === "file") directoryPath = path.dirname(entry.path);
    else {
      try {
        const metadata = await fs.stat(entry.path);
        directoryPath = metadata.isDirectory() ? entry.path : path.dirname(entry.path);
      } catch (error) {
        // A center item can have a saved destination before its file exists.
        if (error.code !== "ENOENT") throw error;
        directoryPath = path.dirname(entry.path);
      }
    }
    directoryPath = path.resolve(directoryPath);
    const key = process.platform === "win32" ? directoryPath.toLowerCase() : directoryPath;
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(directoryPath);
  }
  return directories;
}

module.exports = { captureDirectoryContext, resolveDirectoryCandidates };
