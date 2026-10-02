const path = require("path");
const { Disposable } = require("lumine");
const DialogSource = require(
  path.resolve(path.dirname(require.resolve("lumine")), "..", "src", "dialog-source"),
);

function fakeRepository() {
  const listeners = { status: new Set(), refs: new Set() };
  const state = {
    status: { initialized: true, generation: 1, files: [] },
    refs: {
      initialized: true,
      generation: 1,
      branches: [{ name: "main", ref: "refs/heads/main", isHead: true }],
      head: { name: "main" },
      worktrees: [{ path: "/repo", branch: "refs/heads/main", headOid: "123" }],
    },
  };
  const subscribe = (kind, callback) => {
    listeners[kind].add(callback);
    return new Disposable(() => listeners[kind].delete(callback));
  };
  return {
    state,
    listeners,
    getWorkingDirectory: () => "/repo",
    getStatusSnapshot: () => state.status,
    getRefsSnapshot: () => state.refs,
    ensureStatusSnapshot: () => Promise.resolve(state.status),
    refreshRefsSnapshot: jasmine
      .createSpy("refreshRefsSnapshot")
      .and.callFake(() => Promise.resolve(state.refs)),
    onDidChangeStatusSnapshot: (callback) => subscribe("status", callback),
    onDidChangeRefsSnapshot: (callback) => subscribe("refs", callback),
  };
}

describe("picker snapshot boundaries", () => {
  for (const [modulePath, load, build, refresh] of [
    ["../lib/branch-list-view", "loadBranchItems", "buildCheckoutGroups", "requestBranchRefresh"],
    ["../lib/worktree-list-view", "loadItems", "buildWorktreeItems", "requestRefresh"],
  ]) {
    it(`uses status published during the first refs refresh in ${path.basename(modulePath)}`, async () => {
      const Type = require(modulePath);
      const repository = fakeRepository();
      let finishRefs;
      repository.refreshRefsSnapshot.and.returnValue(
        new Promise((resolve) => (finishRefs = resolve)),
      );
      spyOn(lumine.repositories, "getActiveRepository").and.returnValue(repository);
      const view = Object.create(Type.prototype);
      view.selectListHost = { isVisible: () => true };
      view[refresh] = jasmine.createSpy(refresh).and.resolveTo();
      view[build] = jasmine
        .createSpy(build)
        .and.returnValue(load === "loadBranchItems" ? [[], [], []] : []);
      view.observeActiveRepository();
      try {
        const loading = view[load]();
        repository.state.status = {
          initialized: true,
          generation: 2,
          files: [{ untracked: true }],
        };
        for (const callback of repository.listeners.status) callback();
        finishRefs(repository.state.refs);
        await loading;
        expect(view[build].calls.mostRecent().args[2].added).toBe(1);
        expect(view[refresh]).not.toHaveBeenCalled();
        expect(repository.refreshRefsSnapshot).toHaveBeenCalledTimes(1);
      } finally {
        view.stopObservingActiveRepository();
      }
    });
  }

  for (const [modulePath, hostIndex, rowMatches] of [
    ["../lib/branch-list-view", 0, (item) => item.branch === "added-while-suspended"],
    ["../lib/branch-list-view", 1, (item) => item.reference === "added-while-suspended"],
    ["../lib/worktree-list-view", 0, (item) => item.path === path.normalize("/other")],
  ]) {
    it(`reloads hidden-flow changes in ${path.basename(modulePath)} host ${hostIndex} without refreshing Git again`, async () => {
      const Type = require(modulePath);
      const repository = fakeRepository();
      spyOn(lumine.repositories, "getActiveRepository").and.returnValue(repository);
      spyOn(lumine.workspace, "addInputDialog").and.returnValue({
        getModel: () => ({}),
        destroy: () => Promise.resolve(),
      });
      const hosts = [];
      spyOn(lumine.workspace, "addSelectList").and.callFake((options) => {
        const callbacks = {};
        const model = {
          loads: 0,
          publication: null,
          getScrollTop: () => 0,
          setScrollTop() {},
          update: () => Promise.resolve(),
        };
        model.source = new DialogSource({
          source: {
            ...options.source,
            load: (...args) => {
              model.loads++;
              return options.source.load(...args);
            },
          },
          apply: (publication) => {
            model.publication = publication;
            return Promise.resolve();
          },
        });
        model.reload = () => (model.lastReload = model.source.reload());
        const host = {
          visible: true,
          callbacks,
          getModel: () => model,
          isVisible() {
            return this.visible;
          },
          onDidOpen: (callback) => {
            callbacks.open = callback;
            return new Disposable();
          },
          onDidResume: (callback) => {
            callbacks.resume = callback;
            return new Disposable();
          },
          onDidHide: (callback) => {
            callbacks.hide = callback;
            return new Disposable();
          },
          destroy: () => Promise.resolve(),
        };
        hosts.push(host);
        return host;
      });
      const view = new Type();
      if (hostIndex === 1) view.pendingReference = { repository, action: "create-from" };
      const host = hosts[hostIndex];
      const model = host.getModel();
      try {
        await model.source.open();
        host.callbacks.open();
        host.visible = false;
        model.source.suspend();
        repository.state.refs = {
          ...repository.state.refs,
          generation: 2,
          branches: [
            ...repository.state.refs.branches,
            { name: "added-while-suspended", ref: "refs/heads/added-while-suspended" },
          ],
          worktrees: [
            ...repository.state.refs.worktrees,
            { path: "/other", branch: "refs/heads/other" },
          ],
        };
        for (const callback of repository.listeners.refs) callback();
        host.visible = true;
        await model.source.resume();
        host.callbacks.resume();
        await model.lastReload;
        const rows = Array.isArray(model.publication)
          ? model.publication
          : model.publication.sections.flatMap((section) => section.items);
        expect(rows.some(rowMatches)).toBe(true);
        expect(model.loads).toBe(2);
        expect(repository.refreshRefsSnapshot).toHaveBeenCalledTimes(1);
      } finally {
        await view.destroy();
      }
    });
  }
});
