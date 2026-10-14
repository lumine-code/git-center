const fs = require("fs");
const os = require("os");
const path = require("path");
const { CompositeDisposable } = require("lumine");

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

  async function click(modifiers) {
    const done = new Promise((resolve) => {
      const lease = view.selectList.onDidFinishAction((result) => {
        lease.dispose();
        resolve(result);
      });
    });
    view.selectList
      .getElement()
      .querySelector('[role="option"].selected')
      .dispatchEvent(
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
    await lumine.packages.deactivatePackage("open-with");
    const choose = jasmine.createSpy("choose worktree opener");
    leases.add(
      lumine.commands.add("lumine-workspace", {
        "open-with:toggle": (event) => {
          event.stopPropagation();
          choose(event.detail);
        },
      }),
    );
    expect((await click({ altKey: true })).status).toBe("success");
    expect(choose).toHaveBeenCalledOnceWith({ path: directory, pane: view.openingPane });
  });

  for (const modifiers of [{ shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
    it(`selects without opening for ${modifiers.ctrlKey ? "Ctrl+Shift" : "Shift"}-click`, async () => {
      const list = view.selectList;
      const selected = list.getItems()[0];
      await list.selectNone();
      const open = spyOn(lumine.workspace, "open").and.callThrough();
      const action = spyOn(list, "runAction").and.callThrough();
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...modifiers,
      });
      list.getElement().querySelector('[role="option"]').dispatchEvent(event);
      await Promise.resolve();

      expect(event.defaultPrevented).toBe(true);
      expect(list.getSelectedItem()).toBe(selected);
      expect(action).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(view.selectListHost.isVisible()).toBe(true);
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

  it("keeps Create and Prune as domain actions without file alternatives", async () => {
    for (const [id, command] of [
      ["action:create", "git-center:create-worktree"],
      ["action:prune", "git-center:prune-worktrees"],
    ]) {
      await view.selectList.selectItemById(id);
      expect(view.selectList.getAvailableActions().map((action) => action.command)).toEqual([
        command,
      ]);
    }
  });

  it("keeps project placement actions in the menu while resolving the shared alternatives", () => {
    const actions = view.selectList.getAvailableActions().map((action) => action.command);
    for (const command of [
      "git-center:open-worktree-in-new-window",
      "git-center:open-worktree-in-this-window",
      "git-center:add-worktree-to-window",
    ])
      expect(actions).toContain(command);
    for (const [keystrokes, command] of [
      ["alt-enter", "git-center:open-worktree-with"],
      ["ctrl-alt-enter", "git-center:open-worktree-external"],
      ["alt-shift-enter", "git-center:show-worktree-in-folder"],
    ])
      expect(
        lumine.keymaps.findKeyBindings({
          target: view.selectList.getQueryEditor().getElement(),
          keystrokes,
        })[0]?.command,
      ).toBe(command);
    for (const keystrokes of ["shift-enter", "ctrl-shift-enter"])
      expect(
        lumine.keymaps
          .findKeyBindings({ target: view.selectList.getQueryEditor().getElement(), keystrokes })
          .some((binding) => binding.command.startsWith("git-center:")),
      ).toBe(false);
  });
});
