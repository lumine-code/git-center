const { fetchRemote, forcePushRemote, pullRemote, pushRemote } = require("../lib/remote-actions");

function buildRepository({
  upstream = { name: "origin/main" },
  push = null,
  remotes = ["origin"],
} = {}) {
  const operations = {
    isAvailable: jasmine.createSpy("isAvailable").and.returnValue(true),
    fetch: jasmine.createSpy("fetch").and.resolveTo(),
    pull: jasmine.createSpy("pull").and.resolveTo(),
    push: jasmine.createSpy("push").and.resolveTo(),
  };
  const repository = {
    getOperations: () => operations,
    ensureRefsSnapshot: () =>
      Promise.resolve({
        branches: [{ name: "main", isHead: true, upstream, push }],
        remotes: remotes.map((name) => ({ name })),
      }),
  };
  return { operations, repository };
}

describe("Git Center remote actions", () => {
  it("fetches and pulls the active branch's upstream through core operations", async () => {
    const { operations, repository } = buildRepository();

    expect(await fetchRemote(repository)).toBe(true);
    expect(await pullRemote(repository)).toBe(true);

    expect(operations.fetch).toHaveBeenCalledWith("origin", null);
    expect(operations.pull).toHaveBeenCalledWith("origin", "main");
  });

  it("pushes normally or forcibly and sets an upstream for an untracked branch", async () => {
    const tracked = buildRepository();
    expect(await pushRemote(tracked.repository)).toBe(true);
    expect(await forcePushRemote(tracked.repository)).toBe(true);
    expect(tracked.operations.push.calls.argsFor(0)).toEqual([
      "origin",
      "main",
      { force: false, setUpstream: false },
    ]);
    expect(tracked.operations.push.calls.argsFor(1)).toEqual([
      "origin",
      "main",
      { force: true, setUpstream: false },
    ]);

    const untracked = buildRepository({ upstream: null });
    expect(await pushRemote(untracked.repository)).toBe(true);
    expect(untracked.operations.push).toHaveBeenCalledWith("origin", "main", {
      force: false,
      setUpstream: true,
    });
  });

  it("owns the branch tile's context menu without naming Git Panel commands", () => {
    const menu = require("../menus/main.json")["context-menu"];
    const commands = menu[".git-center-branch.status-bar-item"]
      .map((item) => item.command)
      .filter(Boolean);
    expect(commands).toEqual([
      "git-center:fetch",
      "git-center:pull",
      "git-center:push",
      "git-center:force-push",
    ]);
    expect(commands.some((command) => command.startsWith("git-panel:"))).toBe(false);
  });
});
