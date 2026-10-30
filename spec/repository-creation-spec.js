const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Git Center repository creation", () => {
  let main, temporaryDirectory;

  beforeEach(() => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    temporaryDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-center-creation-")),
    );
    main = Object.create(require("../lib/main"));
    main.activate();
  });

  afterEach(async () => {
    main.deactivate();
    await lumine.project.setPaths([]);
    for (const repository of lumine.repositories.getRepositories()) {
      const directory = repository.getWorkingDirectory();
      if (!directory) continue;
      const relative = path.relative(temporaryDirectory, directory);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)))
        lumine.repositories.forget(repository);
    }
    if (!path.basename(temporaryDirectory).startsWith("git-center-creation-"))
      throw new Error("Refusing to remove an unexpected temporary directory");
    fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5 });
  });

  async function openDialog(mode, options = {}) {
    const window = options.event?.context?.window ?? lumine.workspace.getMainWindow();
    const promise = main.openRepositoryDialog(mode, {
      directoryPath: temporaryDirectory,
      ...options,
    });
    await conditionPromise(() => main.repositorySetupRequests.get(window)?.runtime?.dialog);
    return { promise, dialog: main.repositorySetupRequests.get(window).runtime.dialog };
  }

  function enter(dialog, field, value) {
    dialog.fields[field].setText(value);
  }

  it("initializes the chosen new directory and adds it to the project after success", async () => {
    const directoryPath = path.join(temporaryDirectory, "new-project");
    const { promise, dialog } = await openDialog("initialize", { directoryPath });
    expect(lumine.project.contains(directoryPath)).toBe(false);
    await dialog.submit();
    const repository = await promise;
    expect(path.normalize(repository.getWorkingDirectory())).toBe(directoryPath);
    expect(fs.statSync(path.join(directoryPath, ".git")).isDirectory()).toBe(true);
    expect(lumine.project.getPaths()).toContain(directoryPath);
    expect(dialog.closed).toBe(true);
  });

  it("clones a real local repository using the selected remote name", async () => {
    const sourcePath = path.join(temporaryDirectory, "source");
    const source = await lumine.repositories.initialize(sourcePath);
    const operations = source.getOperations();
    await operations.setConfig("user.name", "Git Center Specs");
    await operations.setConfig("user.email", "specs@lumine.invalid");
    fs.writeFileSync(path.join(sourcePath, "example.txt"), "Cloned content");
    await operations.stageFiles(["example.txt"]);
    await operations.commit("Initial content");
    const destinationPath = path.join(temporaryDirectory, "cloned");
    const { promise, dialog } = await openDialog("clone", {
      sourceURL: sourcePath,
      destinationPath,
      remoteName: "upstream",
    });
    expect(lumine.project.contains(destinationPath)).toBe(false);
    await dialog.submit();
    const repository = await promise;
    expect(path.normalize(repository.getWorkingDirectory())).toBe(destinationPath);
    expect(fs.readFileSync(path.join(destinationPath, "example.txt"), "utf8")).toBe(
      "Cloned content",
    );
    const remotes = await repository.getOperations().executeGit(["remote"], { readOnly: true });
    expect(remotes.stdout.trim()).toBe("upstream");
    expect(lumine.project.getPaths()).toContain(destinationPath);
  });

  it("proposes repository names for URL, SCP, local and relative clone sources", async () => {
    const { promise, dialog } = await openDialog("clone");
    for (const source of [
      "https://github.com/lumine-code/git-panel.git",
      "ssh://git@github.com/lumine-code/git-panel.git",
      "git://github.com/lumine-code/git-panel.git",
      "https://github.com/lumine-code/git-panel.git?ref=main#readme",
      "git@github.com:lumine-code/git-panel.git",
      "git@github.com:git-panel.git",
      "github.com:lumine-code/git-panel.git",
      "../projects/git-panel.git",
      "C:\\projects\\git-panel.git",
      "/projects/git-panel",
    ]) {
      enter(dialog, "sourceURL", source);
      expect(dialog.fields.destinationPath.getText())
        .withContext(source)
        .toBe(path.join(temporaryDirectory, "git-panel"));
    }
    for (const source of ["https://github.com", ""]) {
      enter(dialog, "sourceURL", source);
      expect(dialog.fields.destinationPath.getText()).withContext(source).toBe(temporaryDirectory);
    }
    dialog.cancel();
    expect(await promise).toBeNull();
  });

  it("preserves an edited destination and remote when the clone source changes", async () => {
    const { promise, dialog } = await openDialog("clone");
    const destinationPath = path.join(temporaryDirectory, "my-copy");
    enter(dialog, "sourceURL", "https://example.invalid/first.git");
    enter(dialog, "destinationPath", destinationPath);
    enter(dialog, "remoteName", "upstream");
    enter(dialog, "sourceURL", "https://example.invalid/second.git");
    expect(dialog.fields.destinationPath.getText()).toBe(destinationPath);
    expect(dialog.fields.remoteName.getText()).toBe("upstream");
    dialog.cancel();
    await promise;
  });

  it("keeps invalid editor drafts without reading oversized fields or submitting them", async () => {
    const clone = spyOn(lumine.repositories, "clone");
    const { promise, dialog } = await openDialog("clone");
    const source = dialog.fields.sourceURL;
    const read = spyOn(source, "getText").and.callThrough();
    source.setText("x".repeat(64 * 1024 + 1));
    read.calls.reset();
    dialog.validate();
    await dialog.submit();
    expect(read).not.toHaveBeenCalled();
    expect(dialog.submitButton.disabled).toBe(true);
    expect(dialog.status.textContent).toContain("64 Ki");
    expect(source.getBuffer().getLength()).toBe(64 * 1024 + 1);
    expect(clone).not.toHaveBeenCalled();
    source.setText("https://example.invalid/first.git\nsecond");
    expect(dialog.submitButton.disabled).toBe(true);
    expect(dialog.status.textContent).toContain("single line");
    source.setText("https://example.invalid/valid.git");
    expect(dialog.submitButton.disabled).toBe(false);
    expect(dialog.status.textContent).toBe("");
    dialog.cancel();
    expect(await promise).toBeNull();
    expect(source.isDestroyed()).toBe(true);
  });

  it("cycles keyboard focus through mini fields and actions and keeps their accessible labels", async () => {
    const { promise, dialog } = await openDialog("clone");
    const source = dialog.fields.sourceURL.getElement();
    const destination = dialog.fields.destinationPath.getElement();
    const remote = dialog.fields.remoteName.getElement();
    expect(source.getAttribute("aria-label")).toBe("Clone from");
    expect(destination.getAttribute("aria-label")).toBe("Destination directory");
    source.focus();
    await lumine.commands.dispatch(source, "core:focus-next");
    expect(destination.hasFocus()).toBe(true);
    await lumine.commands.dispatch(destination, "core:focus-next");
    expect(remote.hasFocus()).toBe(true);
    await lumine.commands.dispatch(remote, "core:focus-next");
    expect(document.activeElement).toBe(dialog.cancelButton);
    await lumine.commands.dispatch(dialog.cancelButton, "core:focus-next");
    expect(source.hasFocus()).toBe(true);
    await lumine.commands.dispatch(source, "core:focus-previous");
    expect(document.activeElement).toBe(dialog.cancelButton);
    dialog.cancel();
    expect(await promise).toBeNull();
  });

  it("keeps fields after a failed operation and retries only when submitted again", async () => {
    const directoryPath = path.join(temporaryDirectory, "retry");
    const repository = {};
    const initialize = spyOn(lumine.repositories, "initialize").and.rejectWith(
      new Error("Permission denied"),
    );
    const { promise, dialog } = await openDialog("initialize", { directoryPath });
    await dialog.submit();
    expect(initialize.calls.count()).toBe(1);
    expect(lumine.project.contains(directoryPath)).toBe(false);
    expect(dialog.closed).toBe(false);
    expect(dialog.fields.destinationPath.getText()).toBe(directoryPath);
    expect(dialog.fields.destinationPath.isReadOnly()).toBe(false);
    expect(dialog.status.textContent).toContain("Permission denied");
    expect(dialog.submitButton.disabled).toBe(false);
    initialize.and.resolveTo(repository);
    await dialog.submit();
    expect(await promise).toBe(repository);
    expect(initialize.calls.count()).toBe(2);
    expect(lumine.project.contains(directoryPath)).toBe(true);
  });

  for (const outcome of ["partial", "unknown"]) {
    it(`blocks replay after a non-retriable ${outcome} outcome`, async () => {
      const error = Object.assign(new Error("Refresh and inspect the repository"), {
        outcome,
        retriable: false,
      });
      const clone = spyOn(lumine.repositories, "clone").and.rejectWith(error);
      const destinationPath = path.join(temporaryDirectory, "incomplete");
      const sourceURL = "https://example.invalid/project.git";
      const { promise, dialog } = await openDialog("clone", {
        sourceURL,
        destinationPath,
        remoteName: "upstream",
      });
      await dialog.submit();
      await dialog.submit();
      expect(clone.calls.count()).toBe(1);
      expect(dialog.submitButton.disabled).toBe(true);
      expect(dialog.fields.sourceURL.getText()).toBe(sourceURL);
      expect(dialog.fields.destinationPath.getText()).toBe(destinationPath);
      expect(dialog.fields.remoteName.getText()).toBe("upstream");
      expect(lumine.project.contains(destinationPath)).toBe(false);
      expect(dialog.status.textContent).toContain("Inspect the repository state");
      dialog.cancel();
      expect(await promise).toBeNull();
    });
  }

  it("shares a pending operation and ignores duplicate submission", async () => {
    let complete;
    const initialize = spyOn(lumine.repositories, "initialize").and.returnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const directoryPath = path.join(temporaryDirectory, "pending");
    const { promise, dialog } = await openDialog("initialize", { directoryPath });
    const submitted = dialog.submit();
    await dialog.submit();
    const duplicate = main.openRepositoryDialog("clone", { directoryPath });
    expect(duplicate).toBe(promise);
    expect(initialize.calls.count()).toBe(1);
    expect(dialog.cancelButton.disabled).toBe(true);
    expect(lumine.project.contains(directoryPath)).toBe(false);
    const repository = {};
    complete(repository);
    await submitted;
    expect(await promise).toBe(repository);
    expect(lumine.project.contains(directoryPath)).toBe(true);
  });
});
