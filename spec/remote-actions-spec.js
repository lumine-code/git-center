const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { fetchRemote, forcePushRemote, pullRemote, pushRemote } = require("../lib/remote-actions");

function buildRepository() {
  const operations = {
    isAvailable: jasmine.createSpy("isAvailable").and.returnValue(true),
    fetchCurrent: jasmine.createSpy("fetch current branch").and.resolveTo(),
    pullCurrent: jasmine.createSpy("pull current branch").and.resolveTo(),
    pushCurrent: jasmine.createSpy("push current branch").and.resolveTo(),
  };
  return { operations, repository: { getOperations: () => operations } };
}

describe("Git Center remote actions", () => {
  it("delegates current-branch selection and remote policy to core", async () => {
    const { operations, repository } = buildRepository();
    expect(await fetchRemote(repository)).toBe(true);
    expect(await pullRemote(repository)).toBe(true);
    expect(await pushRemote(repository)).toBe(true);
    expect(await forcePushRemote(repository)).toBe(true);
    expect(operations.fetchCurrent).toHaveBeenCalledOnceWith({});
    expect(operations.pullCurrent).toHaveBeenCalledOnceWith({});
    expect(operations.pushCurrent.calls.allArgs()).toEqual([[{}], [{ force: true }]]);
  });

  it("waits for the core workflow before reporting success", async () => {
    const { operations, repository } = buildRepository();
    let finish;
    operations.pushCurrent.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let resolved = false;
    const pushing = pushRemote(repository).then((result) => {
      resolved = true;
      return result;
    });
    expect(resolved).toBe(false);
    finish();
    expect(await pushing).toBe(true);
  });

  it("explains unavailable actions and unknown outcomes", async () => {
    const { operations, repository } = buildRepository();
    const warning = spyOn(lumine.notifications, "addWarning");
    const error = spyOn(lumine.notifications, "addError");
    operations.isAvailable.and.returnValue(false);
    expect(await pushRemote(repository)).toBe(false);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(operations.pushCurrent).not.toHaveBeenCalled();
    operations.isAvailable.and.returnValue(true);
    operations.pushCurrent.and.rejectWith(
      Object.assign(new Error("Worker exited"), { outcome: "unknown" }),
    );
    expect(await pushRemote(repository)).toBe(false);
    expect(error.calls.mostRecent().args[0]).toContain("outcome is unknown");
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

describe("Git Center with core remote policy", () => {
  let directory, registration, provider, repository, push;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-center-remote-policy-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", directory], {
      windowsHide: true,
    });
    registration = await lumine.repositories.add(directory, { persist: false });
    repository = registration.repository;
    spyOn(repository, "refreshRefsSnapshot").and.resolveTo({
      branches: [{ name: "main", isHead: true, upstream: { name: "origin/main" }, push: null }],
      remotes: [{ name: "origin" }],
    });
    spyOn(repository, "refreshStatusSnapshot").and.resolveTo({
      initialized: true,
      head: { name: "main", oid: null },
    });
    push = jasmine.createSpy("push backend").and.resolveTo("pushed");
    provider = lumine.repositories.addOperationProvider({
      createRepositoryOperations: () => ({ push }),
    });
  });

  afterEach(() => {
    provider?.dispose();
    registration?.dispose();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it("blocks a protected branch without invoking the push backend", async () => {
    lumine.config.set("git.protectPushes", true);
    lumine.config.set("git.protectedBranches", ["main"]);
    const warning = spyOn(lumine.notifications, "addWarning");
    expect(await pushRemote(repository)).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(warning.calls.mostRecent().args[1].detail).toContain("protected branch main");
  });

  it("respects cancellation of core's force-push confirmation", async () => {
    lumine.config.set("git.protectPushes", false);
    lumine.config.set("git.confirmForcePush", true);
    const confirm = spyOn(lumine.applicationDelegate, "confirm").and.resolveTo(1);
    spyOn(lumine.notifications, "addWarning");
    expect(await forcePushRemote(repository)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});
