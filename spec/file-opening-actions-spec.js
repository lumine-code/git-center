const fs = require("fs");
const os = require("os");
const path = require("path");
const { CompositeDisposable } = require("lumine");
const newWindowModifier = process.platform === "darwin" ? { metaKey: true } : { ctrlKey: true };

describe("Git Center worktree file gestures", () => {
  let view, directory, item, leases, external;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-picker-")));
    const main = (await lumine.packages.activatePackage("git-center")).mainModule;
    external = (await lumine.packages.activatePackage("open-external")).mainModule;
    view = main.getWorktreeListView();
    item = { id: "selected-worktree", name: "Selected Worktree", path: directory, repository: {} };
    spyOn(view, "loadItems").and.resolveTo([
      item,
      { id: "action:create", name: "Create", action: "create" },
      { id: "action:prune", name: "Prune", action: "prune" },
    ]);
    leases = new CompositeDisposable();
    await view.selectListHost.show();
    await view.selectList.selectItemById(item.id);
  });

  afterEach(async () => {
    if (jasmine.isSpy(fs.statSync)) fs.statSync.and.callThrough();
    if (jasmine.isSpy(lumine.workspace.open)) lumine.workspace.open.and.callThrough();
    leases.dispose();
    await lumine.packages.deactivatePackage("git-center");
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), directory);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("Worktree picker scratch directory escaped the temporary root");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function click(modifiers, itemId, waitForAction = true) {
    const done = waitForAction
      ? new Promise((resolve) => {
          const lease = view.selectList.onDidFinishAction((result) => {
            lease.dispose();
            resolve(result);
          });
        })
      : Promise.resolve();
    const element = view.selectList.getElement();
    const row =
      itemId == null
        ? element.querySelector('[role="option"].selected')
        : element.querySelectorAll('[role="option"]')[
            view.selectList.getDisplayedItems().findIndex((entry) => entry.id === itemId)
          ];
    row.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...modifiers,
      }),
    );
    return done;
  }

  it("opens the chooser for the worktree folder on Alt-click", async () => {
    await lumine.packages.deactivatePackage("launcher");
    const choose = jasmine.createSpy("choose worktree opener");
    leases.add(
      lumine.commands.add("lumine-workspace", {
        "launcher:open": (event) => {
          event.stopPropagation();
          choose(event.detail);
        },
      }),
    );
    expect((await click({ altKey: true })).status).toBe("success");
    expect(choose).toHaveBeenCalledOnceWith({ path: directory, pane: view.openingPane });
  });

  for (const modifiers of [{ shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
    it(`resolves ${modifiers.ctrlKey ? "Ctrl+Shift" : "Shift"}-click through its Enter binding`, async () => {
      const list = view.selectList;
      const selected = list.getItems()[0];
      await list.selectNone();
      const open = spyOn(lumine.workspace, "open").and.callThrough();
      const action = spyOn(list, "runAction").and.callThrough();
      const add = spyOn(lumine.project, "addPaths");
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...modifiers,
      });
      list.getElement().querySelector('[role="option"]').dispatchEvent(event);
      await flushMicrotasks();

      expect(event.defaultPrevented).toBe(true);
      expect(list.getSelectedItem()).toBe(selected);
      expect(open).not.toHaveBeenCalled();
      if (modifiers.ctrlKey) {
        expect(action).not.toHaveBeenCalled();
        expect(add).not.toHaveBeenCalled();
        expect(view.selectListHost.isVisible()).toBe(true);
      } else {
        expect(action).toHaveBeenCalledTimes(1);
        expect(action.calls.mostRecent().args[0]).toBe("git-center:add-worktree-to-window");
        expect(add).toHaveBeenCalledOnceWith([directory], { mustExist: true });
        expect(view.selectListHost.isVisible()).toBe(false);
      }
    });
  }

  it("routes external and reveal gestures through the registered handlers", async () => {
    const open = spyOn(external, "openExternal").and.resolveTo("");
    const show = spyOn(external, "showInFolder").and.resolveTo("");
    expect((await click({ ctrlKey: true, altKey: true })).status).toBe("success");
    await view.selectListHost.show();
    await view.selectList.selectItemById(item.id);
    expect((await click({ altKey: true, shiftKey: true })).status).toBe("success");
    expect(open).toHaveBeenCalledOnceWith(directory);
    expect(show).toHaveBeenCalledOnceWith(directory);
  });

  it("opens the worktree through its platform new-window gesture without another placement action", async () => {
    await view.selectList.selectItemById("action:create");
    const open = spyOn(lumine.application, "openWindow");
    const change = spyOn(lumine.project, "setState");
    const add = spyOn(lumine.project, "addPaths");
    const primary = spyOn(view, "performAction");
    const system = spyOn(external, "openExternal");
    const result = await click(newWindowModifier, item.id);

    expect(result.status).toBe("success");
    expect(result.command).toBe("git-center:open-worktree-in-new-window");
    expect(open).toHaveBeenCalledOnceWith({ pathsToOpen: [directory], newWindow: true });
    expect(change).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
    expect(system).not.toHaveBeenCalled();
  });

  it("keeps Create and Prune as domain actions without file alternatives", async () => {
    const open = spyOn(lumine.application, "openWindow");
    const primary = spyOn(view, "performAction");
    const started = jasmine.createSpy("action started"),
      finished = jasmine.createSpy("action finished");
    leases.add(
      view.selectList.onDidStartAction(started),
      view.selectList.onDidFinishAction(finished),
    );
    for (const [id, command] of [
      ["action:create", "git-center:create-worktree"],
      ["action:prune", "git-center:prune-worktrees"],
    ]) {
      await view.selectList.selectItemById(id);
      expect(view.selectList.getAvailableActions().map((action) => action.command)).toEqual([
        command,
      ]);
      expect(
        lumine.commands.canDispatch(
          view.selectList.getElement(),
          "git-center:open-worktree-in-new-window",
        ),
      ).toBe(false);
      await click(newWindowModifier, undefined, false);
      await flushMicrotasks();
      expect(view.selectListHost.isVisible()).toBe(true);
    }
    expect(open).not.toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });

  it("keeps project placement actions in the menu while resolving the shared alternatives", () => {
    const actions = view.selectList.getAvailableActions().map((action) => action.command);
    for (const command of [
      "git-center:open-worktree-in-new-window",
      "git-center:open-worktree-in-this-window",
      "git-center:add-worktree-to-window",
    ])
      expect(actions).toContain(command);
    for (const target of [
      view.selectList.getElement(),
      view.selectList.getQueryEditor().getElement(),
    ])
      for (const [keystrokes, command] of [
        [
          process.platform === "darwin" ? "cmd-enter" : "ctrl-enter",
          "git-center:open-worktree-in-new-window",
        ],
        ["shift-enter", "git-center:add-worktree-to-window"],
        ["alt-enter", "git-center:open-worktree-with"],
        ["ctrl-alt-enter", "git-center:open-worktree-external"],
        ["alt-shift-enter", "git-center:show-worktree-in-folder"],
      ])
        expect(lumine.keymaps.findKeyBindings({ target, keystrokes })[0]?.command).toBe(command);
    for (const keystrokes of ["ctrl-shift-enter"])
      expect(
        lumine.keymaps
          .findKeyBindings({ target: view.selectList.getQueryEditor().getElement(), keystrokes })
          .some((binding) => binding.command.startsWith("git-center:")),
      ).toBe(false);
  });
  it("checks cached path eligibility without filesystem calls", () => {
    const stat = spyOn(fs, "statSync").and.throwError("availability performed I/O");
    for (const action of view
      .actions()
      .filter((action) =>
        [
          "git-center:open-worktree-with",
          "git-center:open-worktree-external",
          "git-center:show-worktree-in-folder",
        ].includes(action.command),
      )) {
      expect(action.when({ item })).toBe(true);
    }
    expect(stat).not.toHaveBeenCalled();
  });

  it("revalidates an eligible path only when its action executes", async () => {
    const stat = spyOn(fs, "statSync").and.returnValue({ isDirectory: () => false });
    const open = spyOn(lumine.workspace, "open");
    await view.performFileAction(item, "external");
    expect(stat).toHaveBeenCalledWith(item.path);
    expect(open).not.toHaveBeenCalled();
  });
});
