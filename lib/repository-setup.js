const RepositoryDialog = require("./repository-dialog");
const { resolveDirectoryCandidates } = require("./directory-context");

module.exports = class RepositorySetup {
  constructor({ mode, context, options, signal }) {
    this.mode = mode;
    this.context = context;
    this.options = options;
    this.signal = signal;
    this.closed = false;
  }

  get pending() {
    return Boolean(this.dialog?.pending);
  }

  async open() {
    let directories = await resolveDirectoryCandidates(this.context);
    if (this.closed || this.signal.aborted) return null;
    if (directories.length === 0)
      directories = [lumine.config.get("core.projectHome")].filter(Boolean);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.dialog = new RepositoryDialog({
        window: this.context.window,
        mode: this.mode,
        directories,
        values: {
          sourceURL: this.options.sourceURL,
          destinationPath:
            this.mode === "initialize" ? this.options.directoryPath : this.options.destinationPath,
          remoteName: this.options.remoteName,
        },
        onSubmit: (values) => this.submit(values),
        onFinish: (result) => {
          this.closed = true;
          resolve(result);
        },
      });
      this.dialog.show();
    });
  }

  async submit({ sourceURL, destinationPath, remoteName }) {
    const repository = await (this.mode === "initialize"
      ? lumine.repositories.initialize(destinationPath, { signal: this.signal })
      : lumine.repositories.clone(sourceURL, destinationPath, {
          sourceRemoteName: remoteName,
          signal: this.signal,
        }));
    if (this.closed || this.signal.aborted) return null;
    if (!lumine.project.contains(destinationPath)) lumine.project.addPath(destinationPath);
    return repository;
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.dialog?.finish(null);
    this.resolve?.(null);
  }
};
