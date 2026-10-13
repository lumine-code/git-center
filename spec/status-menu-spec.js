describe("Git Center status action menus", () => {
  let main;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("status-bar");
    main = (await lumine.packages.activatePackage("git-center")).mainModule;
    await conditionPromise(() => main.repositoryStatusView && main.branchStatusView);
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-center");
  });
  it("offers every repository gesture and primary branch action", () => {
    const repository = main.repositoryStatusView.element;
    const menu = () => lumine.contextMenu.templateForElement(repository);
    expect(menu().map((item) => item.command)).toEqual([
      "git-center:select-repository",
      "git-center:select-worktree",
      undefined,
      "git-center:previous-repository",
      "git-center:next-repository",
      undefined,
      "git-center:toggle-lock",
    ]);
    expect(
      menu().find((item) => item.command === "git-center:select-repository").mouseBindingLabel,
    ).toBe("LMB");
    expect(menu().find((item) => item.command === "git-center:toggle-lock").mouseBindingLabel).toBe(
      "MMB",
    );
    const checked = spyOn(lumine.repositories, "isActiveRepositoryPinned").and.returnValue(true);
    expect(menu().find((item) => item.command === "git-center:toggle-lock").checked).toBe(true);
    checked.and.returnValue(false);
    expect(menu().find((item) => item.command === "git-center:toggle-lock").checked).toBe(false);
    expect(
      lumine.contextMenu
        .templateForElement(main.branchStatusView.element)
        .map((item) => item.command),
    ).toContain("git-center:select-branch");
  });
  it("dispatches primary, middle and wheel gestures through the menu commands", () => {
    const element = main.repositoryStatusView.element;
    const dispatch = spyOn(lumine.commands, "dispatch");
    element.dispatchEvent(new MouseEvent("click", { button: 2 }));
    element.dispatchEvent(new MouseEvent("auxclick", { button: 2 }));
    lumine.contextMenu.templateForElement(element);
    expect(dispatch).not.toHaveBeenCalled();
    element.click();
    element.dispatchEvent(new MouseEvent("auxclick", { button: 1 }));
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, cancelable: true }));
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, cancelable: true }));
    expect(dispatch.calls.allArgs()).toEqual([
      [element, "git-center:select-repository"],
      [element, "git-center:toggle-lock"],
      [element, "git-center:next-repository"],
      [element, "git-center:previous-repository"],
    ]);
  });
  it("disposes both menu definitions and retained tile listeners", async () => {
    const element = main.repositoryStatusView.element;
    await lumine.packages.deactivatePackage("git-center");
    const dispatch = spyOn(lumine.commands, "dispatch");
    element.click();
    element.dispatchEvent(new MouseEvent("auxclick", { button: 1 }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(lumine.contextMenu.templateForElement(element)).toEqual([]);
  });
});
