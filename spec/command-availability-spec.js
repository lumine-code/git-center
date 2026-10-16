const mainModule = require("../lib/main");
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
    main = Object.create(mainModule);
    main.activate();
  });
  afterEach(() => {
    main.deactivate();
    lumine.repositories.getActiveRepository.and.callThrough();
    lumine.repositories.getRepositories.and.callThrough();
    lumine.commands.add.and.callThrough();
  });
  const available = (commands, name) => commands[`git-center:${name}`].isAvailable({});

  it("disables every repository action in an empty workspace", () => {
    for (const name of Object.keys(commands))
      expect(commands[name].isAvailable({})).withContext(name).toBe(false);
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
