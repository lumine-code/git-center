describe("Git Center full-scan dialog request lifetime", () => {
  let main, view;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    view = main.getWorktreeListView();
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-center");
  });
  it("does not let an older confirmed operation close a later prompt or clear its pending state", async () => {
    const dialog = view.textDialog;
    let finishOld, finishCurrent;
    dialog.show({
      prompt: "Old",
      value: "old",
      onConfirm: () => new Promise((resolve) => (finishOld = resolve)),
    });
    const old = dialog.confirm();
    dialog.inputDialogHost.cancel();
    dialog.show({
      prompt: "Current",
      value: "current",
      onConfirm: () => new Promise((resolve) => (finishCurrent = resolve)),
    });
    const current = dialog.confirm();
    finishOld(true);
    await old;
    expect(dialog.inputDialogHost.isVisible()).toBe(true);
    expect(dialog.inputDialog.getQuery()).toBe("current");
    expect(dialog.pending).toBe(true);
    finishCurrent(false);
    await current;
    expect(dialog.inputDialogHost.isVisible()).toBe(true);
    expect(dialog.pending).toBe(false);
  });
  it("preserves a current successful confirmation and selected opening value", async () => {
    const dialog = view.textDialog;
    dialog.show({ prompt: "Current", value: "suggestion", onConfirm: () => Promise.resolve(true) });
    expect(dialog.inputDialog.getQueryEditor().getSelectedText()).toBe("suggestion");
    await dialog.confirm();
    expect(dialog.inputDialogHost.isVisible()).toBe(false);
  });
  it("does not show a late worktree path prompt after its picker has been destroyed", async () => {
    let finish;
    const repository = {
      ensureRefsSnapshot: () => new Promise((resolve) => (finish = resolve)),
      getWorkingDirectory: () => "C:/safe-placeholder",
    };
    const opening = view.showCreateDialog(repository);
    await view.destroy();
    finish({ head: { name: "main" } });
    let error;
    try {
      await opening;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeUndefined();
    expect(view.textDialog.inputDialogHost.isVisible()).toBe(false);
  });
});
