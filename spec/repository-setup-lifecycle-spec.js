const os = require("node:os");
const path = require("node:path");

describe("Git Center repository setup lifetime", () => {
  let main;
  const directoryPath = path.join(os.tmpdir(), "git-center-setup-lifetime");

  beforeEach(() => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = Object.create(require("../lib/main"));
    main.activate();
  });

  afterEach(async () => {
    main.deactivate();
    await lumine.workspace.discardEditorWindows();
    await lumine.project.setPaths([]);
  });

  async function openDialog(options = {}) {
    const window = options.event?.context?.window ?? lumine.workspace.getMainWindow();
    const promise = main.openRepositoryDialog("initialize", { directoryPath, ...options });
    await conditionPromise(() => main.repositorySetupRequests.get(window)?.runtime?.dialog);
    return { promise, dialog: main.repositorySetupRequests.get(window).runtime.dialog };
  }

  it("cancels without executing an operation or adding a project folder", async () => {
    const initialize = spyOn(lumine.repositories, "initialize");
    const { promise, dialog } = await openDialog();
    dialog.cancel();
    expect(await promise).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
    expect(lumine.project.contains(directoryPath)).toBe(false);
    expect(main.repositorySetupRequests.size).toBe(0);
    expect(dialog.closed).toBe(true);
  });

  it("resolves cancellation and restores the repository picker when its form crumb is popped", async () => {
    const window = lumine.workspace.getMainWindow();
    await main.togglePicker(window, "repositoryListView");
    const picker = main.getRepositoryListView(window);
    expect(picker.selectListHost.isVisible()).toBe(true);
    const { promise, dialog } = await openDialog();
    expect(picker.selectListHost.isVisible()).toBe(false);
    expect(window.getModalFlow().getTrail().at(-1)).toBe("Initialize Repository");
    expect(window.getModalFlow().pop()).toBe(true);
    expect(await promise).toBeNull();
    expect(main.repositorySetupRequests.has(window)).toBe(false);
    expect(dialog.closed).toBe(true);
    expect(picker.selectListHost.isVisible()).toBe(true);
  });

  it("keeps a pending form and its result when a credential child crumb is popped", async () => {
    let complete;
    spyOn(lumine.repositories, "initialize").and.returnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const window = lumine.workspace.getMainWindow();
    await main.togglePicker(window, "repositoryListView");
    const { promise, dialog } = await openDialog();
    let settled = false;
    void promise.then(() => (settled = true));
    const submitted = dialog.submit();
    const credentials = window.addModalPanel({
      item: window.getDocument().createElement("input"),
      visible: false,
    });
    try {
      credentials.show({ crumb: "Git credentials" });
      expect(dialog.panel.isVisible()).toBe(false);
      expect(dialog.closed).toBe(false);
      expect(window.getModalFlow().pop()).toBe(true);
      await flushMicrotasks();
      expect(dialog.panel.isVisible()).toBe(true);
      expect(dialog.pending).toBe(true);
      expect(dialog.fields.destinationPath.isReadOnly()).toBe(true);
      expect(dialog.element.getAttribute("aria-busy")).toBe("true");
      expect(dialog.closed).toBe(false);
      expect(settled).toBe(false);
      expect(main.repositorySetupRequests.has(window)).toBe(true);
      const repository = {};
      complete(repository);
      await submitted;
      expect(await promise).toBe(repository);
      expect(dialog.closed).toBe(true);
      expect(dialog.fields.destinationPath.isDestroyed()).toBe(true);
      expect(main.repositorySetupRequests.has(window)).toBe(false);
    } finally {
      credentials.destroy();
    }
  });

  it("does not construct UI from an import that finishes after deactivation", async () => {
    let finishImport;
    spyOn(main, "loadViews").and.returnValue(new Promise((resolve) => (finishImport = resolve)));
    const Runtime = jasmine.createSpy("RepositorySetup");
    const promise = main.openRepositoryDialog("initialize", { directoryPath });
    main.deactivate();
    expect(await promise).toBeNull();
    finishImport(Runtime);
    await flushMicrotasks();
    expect(Runtime).not.toHaveBeenCalled();
    expect(main.repositorySetupRequests.size).toBe(0);
  });

  it("retires a service reference when its activation ends", async () => {
    const retired = main.provideRepositorySetup();
    main.deactivate();
    main.activate();
    const open = spyOn(main, "openRepositoryDialog").and.callThrough();
    expect(await retired.openInitializeDialog({ directoryPath })).toBeNull();
    expect(await retired.openCloneDialog({ directoryPath })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    const promise = main.provideRepositorySetup().openInitializeDialog({ directoryPath });
    await conditionPromise(
      () => main.repositorySetupRequests.get(lumine.workspace.getMainWindow())?.runtime?.dialog,
    );
    main.repositorySetupRequests.get(lumine.workspace.getMainWindow()).runtime.dialog.cancel();
    expect(await promise).toBeNull();
  });

  it("returns to a still-connected tree selection provider when its replacement retires", () => {
    const first = { getSelectionSnapshot: () => ({ entries: [] }) };
    const second = { getSelectionSnapshot: () => ({ entries: [] }) };
    const firstLease = main.consumeTreeViewSelection(first);
    const secondLease = main.consumeTreeViewSelection(second);
    secondLease.dispose();
    expect(main.treeViewSelection).toBe(first);
    firstLease.dispose();
    expect(main.treeViewSelection).toBeNull();
  });

  it("retains a tree selection provider until all of its consumption leases retire", () => {
    const provider = { getSelectionSnapshot: () => ({ entries: [] }) };
    const first = main.consumeTreeViewSelection(provider);
    const second = main.consumeTreeViewSelection(provider);
    first.dispose();
    expect(main.treeViewSelection).toBe(provider);
    second.dispose();
    expect(main.treeViewSelection).toBeNull();
  });

  it("retires outstanding UI and old service references when the package is unloaded", async () => {
    main.deactivate();
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    const retired = main.provideRepositorySetup();
    const { promise, dialog } = await openDialog();
    await lumine.packages.unloadPackage("git-center", { serialize: false });
    expect(await promise).toBeNull();
    expect(dialog.closed).toBe(true);
    expect(await retired.openInitializeDialog({ directoryPath })).toBeNull();
    expect(await retired.openCloneDialog({ directoryPath })).toBeNull();
  });

  it("aborts an in-flight operation on teardown and ignores its later success", async () => {
    let complete;
    const initialize = spyOn(lumine.repositories, "initialize").and.returnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const addPath = spyOn(lumine.project, "addPath").and.callThrough();
    const { promise, dialog } = await openDialog();
    const submitted = dialog.submit();
    const signal = initialize.calls.mostRecent().args[1].signal;
    main.deactivate();
    expect(await promise).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(dialog.closed).toBe(true);
    complete({});
    await submitted;
    expect(addPath).not.toHaveBeenCalled();
  });

  it("keeps independent forms in their originating editor windows", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    const first = await openDialog();
    const second = await openDialog({ event: { context: { window: extra } } });
    expect(second.dialog.element.ownerDocument).toBe(extra.getDocument());
    expect(first.dialog.element.ownerDocument).toBe(lumine.workspace.getMainWindow().getDocument());
    expect(main.repositorySetupRequests.size).toBe(2);
    first.dialog.cancel();
    expect(await first.promise).toBeNull();
    expect(second.dialog.closed).toBe(false);
    await lumine.workspace.attachWindow(extra);
    expect(await second.promise).toBeNull();
    expect(second.dialog.closed).toBe(true);
    expect(main.repositorySetupRequests.size).toBe(0);
  });
});
