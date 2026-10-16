function deferred() {
  let resolve;
  const promise = new Promise((accept) => (resolve = accept));
  return { promise, resolve };
}

function picker(toggle) {
  return {
    toggle,
    selectListHost: {
      onDidOpen: () => ({ dispose() {} }),
      onDidHide: () => ({ dispose() {} }),
    },
    destroy() {},
  };
}

describe("Git Center native views", () => {
  let main;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    main.deactivateStatusBar();
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-center");
  });

  function fakeWindow() {
    let close;
    return {
      onWillDestroy(callback) {
        close = callback;
        return { dispose() {} };
      },
      isMain: () => false,
      close() {
        close();
      },
    };
  }

  it("shares native view imports and preserves synchronous picker constructors", async () => {
    const ViewLoader = require("../lib/view-loader");
    const loader = new ViewLoader();
    const imported = spyOn(loader, "importView").and.callThrough();
    const first = loader.load("repositoryListView");
    expect(loader.load("repositoryListView")).toBe(first);
    expect(await first).toBe(require("../lib/repository-list-view"));
    expect((await loader.load("status")).BranchStatusView).toBe(
      require("../lib/branch-status-view"),
    );
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("retries a failed native import without retaining its rejected promise", async () => {
    const ViewLoader = require("../lib/view-loader");
    const loader = new ViewLoader();
    const nativeImport = loader.importView.bind(loader);
    const failure = new Error("temporary view failure");
    const imported = spyOn(loader, "importView").and.rejectWith(failure);
    await expectAsync(loader.load("branchListView")).toBeRejectedWith(failure);
    imported.and.callFake(nativeImport);
    expect(await loader.load("branchListView")).toBe(require("../lib/branch-list-view"));
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("constructs one picker for concurrent requests", async () => {
    const window = fakeWindow();
    const importing = deferred();
    const toggle = jasmine.createSpy("toggle");
    const View = jasmine.createSpy("View").and.returnValue(picker(toggle));
    const loading = spyOn(main, "loadViews").and.returnValue(importing.promise);
    const first = main.togglePicker(window, "repositoryListView");
    const second = main.togglePicker(window, "repositoryListView");
    importing.resolve(View);
    await Promise.all([first, second]);
    expect(loading).toHaveBeenCalledTimes(1);
    expect(View).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  for (const retire of ["window", "package"]) {
    it(`does not create or toggle a picker after its ${retire} closes during import`, async () => {
      const window = fakeWindow();
      const importing = deferred();
      const View = jasmine.createSpy("View");
      spyOn(main, "loadViews").and.returnValue(importing.promise);
      const pending = main.togglePicker(window, "branchListView");
      if (retire === "window") window.close();
      else await lumine.packages.deactivatePackage("git-center");
      importing.resolve(View);
      await pending;
      expect(View).not.toHaveBeenCalled();
    });
  }

  it("does not add status tiles after their service edge is disposed during import", async () => {
    const importing = deferred();
    const started = deferred();
    const View = jasmine.createSpy("StatusView");
    spyOn(main, "loadViews").and.callFake(() => {
      started.resolve();
      return importing.promise;
    });
    const statusBar = { addLeftTile: jasmine.createSpy("addLeftTile") };
    const lease = main.consumeWindowStatusBar(statusBar);
    const ready = main.statusBarConnections.get(statusBar).ready;
    await started.promise;
    lease.dispose();
    importing.resolve({ RepositoryStatusView: View, BranchStatusView: View });
    await ready;
    expect(View).not.toHaveBeenCalled();
    expect(statusBar.addLeftTile).not.toHaveBeenCalled();
  });

  it("contains a picker load failure and retries a later command", async () => {
    const window = fakeWindow();
    const toggle = jasmine.createSpy("toggle");
    const View = jasmine.createSpy("View").and.returnValue(picker(toggle));
    const loading = spyOn(main, "loadViews").and.rejectWith(new Error("temporary picker failure"));
    await main.togglePicker(window, "repositoryListView");
    expect(View).not.toHaveBeenCalled();
    loading.and.resolveTo(View);
    await main.togglePicker(window, "repositoryListView");
    expect(View).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("reacquires native picker constructors after unload and retains the synchronous getters", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await main.togglePicker(null, "repositoryListView");
    const oldMain = main;
    const oldView = main.getRepositoryListView();
    await lumine.packages.unloadPackage("git-center");
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    await main.togglePicker(null, "repositoryListView");
    const view = main.getRepositoryListView();
    expect(main).not.toBe(oldMain);
    expect(view.constructor).not.toBe(oldView.constructor);
    expect(view.constructor).toBe(require("../lib/repository-list-view"));
    expect(view.selectListHost.isVisible()).toBe(true);
  });
});
