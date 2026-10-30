const { Disposable } = require("lumine");

describe("Git Center command availability", () => {
  let main, commands, active, repositories, refs, status, operations;
  beforeEach(() => {
    active = null;
    repositories = [];
    refs = { initialized: true, remotes: [], branches: [{ isHead: true, name: "main" }] };
    status = { initialized: true, head: { oid: "commit" } };
    operations = { isAvailable: () => true };
    spyOn(lumine.repositories, "getActiveRepository").and.callFake(() => active);
    spyOn(lumine.repositories, "getRepositories").and.callFake(() => repositories);
    spyOn(lumine.commands, "add").and.callFake((_selector, entries) => {
      commands = entries;
      return new Disposable();
    });
    main = Object.create(require("../lib/main"));
    main.activate();
  });
  afterEach(() => {
    main.deactivate();
    lumine.repositories.getActiveRepository.and.callThrough();
    lumine.repositories.getRepositories.and.callThrough();
    lumine.commands.add.and.callThrough();
  });
  const available = (commands, name) => commands[`git-center:${name}`].isAvailable?.({}) ?? true;

  it("keeps setup and repository selection available in an empty workspace", () => {
    for (const name of Object.keys(commands)) {
      const setup = ["initialize", "clone", "select-repository"].includes(name.split(":")[1]);
      expect(commands[name].isAvailable?.({}) ?? true)
        .withContext(name)
        .toBe(setup);
    }
  });

  it("checks repository count and the active repository separately", () => {
    active = {
      getOperations: () => operations,
      getRefsSnapshot: () => refs,
      getStatusSnapshot: () => status,
    };
    repositories = [active];
    expect(available(commands, "select-repository")).toBe(true);
    expect(available(commands, "select-branch")).toBe(true);
    expect(available(commands, "next-repository")).toBe(false);
    repositories.push({});
    expect(available(commands, "next-repository")).toBe(true);
    expect(available(commands, "fetch")).toBe(false);
    refs.remotes.push({ name: "origin" });
    expect(available(commands, "fetch")).toBe(true);
    status.head.oid = null;
    expect(available(commands, "push")).toBe(false);
  });

  it("matches current-branch remote operations rather than just remote count", () => {
    active = {
      getOperations: () => operations,
      getRefsSnapshot: () => refs,
      getStatusSnapshot: () => status,
    };
    refs.remotes = [{ name: "origin" }];
    expect(available(commands, "fetch")).toBe(true);
    expect(available(commands, "pull")).toBe(false);
    refs.branches[0].upstream = { ref: "refs/remotes/origin/main" };
    expect(available(commands, "pull")).toBe(true);
    refs.branches[0].upstream = null;
    refs.remotes = [{ name: "first" }, { name: "second" }];
    expect(available(commands, "push")).toBe(false);
    expect(available(commands, "fetch")).toBe(false);
    refs.branches[0].push = { ref: "refs/remotes/second/main" };
    expect(available(commands, "push")).toBe(true);
    refs.branches = [];
    expect(available(commands, "fetch")).toBe(false);
    expect(available(commands, "push")).toBe(false);
    refs.initialized = false;
    expect(available(commands, "fetch")).toBe(true);
  });
});

describe("Git Center picker availability after repositories close", () => {
  let main;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    spyOn(lumine.repositories, "getRepositories").and.returnValue([]);
    spyOn(lumine.repositories, "getActiveRepository").and.returnValue(null);
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-center");
    await lumine.workspace.discardEditorWindows();
  });

  for (const [command, field] of [
    ["select-repository", "repositoryListView"],
    ["select-branch", "branchListView"],
    ["select-worktree", "worktreeListView"],
  ]) {
    it(`can close an open ${command} picker without a repository or document`, async () => {
      const target = lumine.workspace.getElement();
      const name = `git-center:${command}`;
      expect(lumine.workspace.getActiveTextEditor()).toBeUndefined();
      expect(lumine.commands.canDispatch(target, name)).toBe(command === "select-repository");
      await main.togglePicker(null, field);
      const host = main.pickerWindows.get(lumine.workspace.getMainWindow())[field].selectListHost;
      await host.show();
      expect(host.isVisible()).toBe(true);
      const load = spyOn(main, "loadViews").and.throwError("availability must remain passive");
      expect(lumine.commands.canDispatch(target, name)).toBe(true);
      expect(load).not.toHaveBeenCalled();
      const invalidate = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
      await lumine.commands.dispatch(target, name);
      expect(host.isVisible()).toBe(false);
      expect(invalidate).toHaveBeenCalled();
      expect(lumine.commands.canDispatch(target, name)).toBe(command === "select-repository");
    });
  }

  it("keeps the visible-picker exception inside its own window", async () => {
    await main.togglePicker(null, "repositoryListView");
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    expect(main.isPickerVisible({ context: { window: extra } }, "repositoryListView")).toBe(false);
    expect(main.isPickerVisible({}, "repositoryListView")).toBe(true);
  });
});
