describe("Git Center pickers in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("git-center");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-center");
    await lumine.workspace.discardEditorWindows();
  });
  it("retains independent repository queries and branch prompts in local documents", async () => {
    const workspace = lumine.workspace;
    await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    const main = lumine.packages.getActivePackage("git-center").mainModule;
    await main.togglePicker(workspace.getMainWindow(), "repositoryListView");
    await main.togglePicker(extra, "repositoryListView");
    const local = main.getRepositoryListView(workspace.getMainWindow());
    const remote = main.getRepositoryListView(extra);
    expect(local.selectListHost.isVisible()).toBe(true);
    expect(remote.selectList.getElement().ownerDocument).toBe(extra.getDocument());
    await local.selectList.setQuery("local");
    await remote.selectList.setQuery("remote");
    expect(local.selectList.getQuery()).toBe("local");
    const branch = main.getBranchListView(extra);
    branch.branchNameDialog.inputDialogHost.getPanel();
    expect(branch.branchNameDialog.inputDialog.getElement().ownerDocument).toBe(
      extra.getDocument(),
    );
    await workspace.attachWindow(extra);
    expect(main.pickerWindows.has(extra)).toBe(false);
  });
});
