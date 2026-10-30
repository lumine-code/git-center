const fs = require("node:fs/promises");
const path = require("node:path");
const { captureDirectoryContext, resolveDirectoryCandidates } = require("../lib/directory-context");

describe("Git Center repository directory context", () => {
  let commandContext, editorWindow, treeSelection, stat;
  const root = path.resolve("repository-context");
  const filePath = path.join(root, "document.txt");

  beforeEach(() => {
    editorWindow = {};
    commandContext = {
      window: editorWindow,
      documentItem: { getPath: () => filePath },
    };
    spyOn(lumine.workspace, "resolveCommandContext").and.callFake(() => commandContext);
    stat = spyOn(fs, "stat").and.resolveTo({ isDirectory: () => false });
    treeSelection = {
      getSelectionSnapshot: jasmine.createSpy("getSelectionSnapshot").and.returnValue({
        entries: [{ path: path.join(root, "selected"), kind: "directory" }],
      }),
    };
  });

  function treeEvent(context = commandContext) {
    const tree = document.createElement("div");
    tree.className = "tree-view";
    const child = document.createElement("div");
    tree.append(child);
    return { target: child, context };
  }

  it("captures the saved center item and its window before focus changes", async () => {
    const context = captureDirectoryContext({ event: { context: commandContext } }, treeSelection);
    commandContext.documentItem = { getPath: () => path.join(root, "other", "changed.txt") };
    expect(context.window).toBe(editorWindow);
    expect(context.entries).toEqual([{ path: filePath, kind: "unknown" }]);
    expect(lumine.workspace.resolveCommandContext).not.toHaveBeenCalled();
    expect(treeSelection.getSelectionSnapshot).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(await resolveDirectoryCandidates(context)).toEqual([root]);
  });

  it("resolves command context without an event instead of reading a dock's active item", () => {
    spyOn(lumine.workspace, "getActivePaneItem").and.throwError("Dock items are not documents");
    const context = captureDirectoryContext();
    expect(lumine.workspace.resolveCommandContext).toHaveBeenCalledWith(undefined);
    expect(context.entries[0].path).toBe(filePath);
  });

  it("keeps an explicit directory preset even when it does not exist", async () => {
    const directoryPath = path.join(root, "new-directory");
    const context = captureDirectoryContext({ event: treeEvent(), directoryPath }, treeSelection);
    expect(context.entries).toEqual([{ path: directoryPath, kind: "directory" }]);
    expect(treeSelection.getSelectionSnapshot).not.toHaveBeenCalled();
    expect(await resolveDirectoryCandidates(context)).toEqual([directoryPath]);
    expect(stat).not.toHaveBeenCalled();
  });

  it("copies a tree multiselection without retaining mutable provider entries", async () => {
    const entries = [
      { path: root, kind: "directory" },
      { path: filePath, kind: "file" },
      { path: path.join(root, "other"), kind: "directory" },
    ];
    treeSelection.getSelectionSnapshot.and.returnValue({ entries });
    const context = captureDirectoryContext({ event: treeEvent() }, treeSelection);
    entries[0].path = path.join(root, "changed");
    entries.push({ path: path.join(root, "added"), kind: "directory" });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.entries)).toBe(true);
    expect(context.entries.every(Object.isFrozen)).toBe(true);
    expect(await resolveDirectoryCandidates(context)).toEqual([root, path.join(root, "other")]);
    expect(stat).not.toHaveBeenCalled();
  });

  it("keeps an empty tree selection empty instead of falling through to the center document", async () => {
    treeSelection.getSelectionSnapshot.and.returnValue({ entries: [] });
    expect(
      await resolveDirectoryCandidates(
        captureDirectoryContext({ event: treeEvent() }, treeSelection),
      ),
    ).toEqual([]);
    expect(captureDirectoryContext({ event: treeEvent() }).entries).toEqual([]);
    expect(stat).not.toHaveBeenCalled();
  });

  it("uses a notebook's backing file instead of an embedded editor", async () => {
    const notebookPath = path.join(root, "notebook.ipynb");
    commandContext.documentItem = { getPath: () => notebookPath };
    commandContext.embeddedEditor = { getPath: () => path.join(root, "cells", "cell.py") };
    expect(await resolveDirectoryCandidates(captureDirectoryContext())).toEqual([root]);
    expect(stat).toHaveBeenCalledWith(notebookPath);

    commandContext.documentItem = {};
    commandContext.fileEditor = { getPath: () => notebookPath };
    expect(captureDirectoryContext().entries[0].path).toBe(notebookPath);
  });

  it("accepts a non-text center item whose path is a directory", async () => {
    commandContext.documentItem = { getPath: () => root };
    stat.and.resolveTo({ isDirectory: () => true });
    expect(await resolveDirectoryCandidates(captureDirectoryContext())).toEqual([root]);
    expect(stat).toHaveBeenCalledWith(root);
  });

  it("uses the parent of a center item's destination that does not exist yet", async () => {
    stat.and.rejectWith(Object.assign(new Error("Missing"), { code: "ENOENT" }));
    expect(await resolveDirectoryCandidates(captureDirectoryContext())).toEqual([root]);
  });

  it("reports filesystem errors instead of silently choosing another directory", async () => {
    const error = Object.assign(new Error("Access denied"), { code: "EACCES" });
    stat.and.rejectWith(error);
    await expectAsync(resolveDirectoryCandidates(captureDirectoryContext())).toBeRejectedWith(
      error,
    );
  });

  it("offers no candidate for an empty or destroyed document", () => {
    commandContext.documentItem = null;
    expect(captureDirectoryContext().entries).toEqual([]);
    commandContext.documentItem = { isDestroyed: () => true, getPath: () => filePath };
    commandContext.fileEditor = { getPath: () => filePath };
    expect(captureDirectoryContext().entries).toEqual([]);
  });

  it("deduplicates directory spelling using the host platform's case rules", async () => {
    const first = path.join(root, "Selected");
    const second = path.join(root, "selected");
    treeSelection.getSelectionSnapshot.and.returnValue({
      entries: [
        { path: first + path.sep, kind: "directory" },
        { path: first, kind: "directory" },
        { path: second, kind: "directory" },
      ],
    });
    const expected = process.platform === "win32" ? [first] : [first, second];
    expect(
      await resolveDirectoryCandidates(
        captureDirectoryContext({ event: treeEvent() }, treeSelection),
      ),
    ).toEqual(expected);
  });
});
