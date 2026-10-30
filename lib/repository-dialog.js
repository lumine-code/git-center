const path = require("path");
const { CompositeDisposable } = require("lumine");

const INPUT_LIMIT = 64 * 1024;

function repositoryName(source) {
  let pathname = source;
  if (!/^[a-z]:[\\/]/i.test(source)) {
    try {
      pathname = new URL(source).pathname;
    } catch {
      pathname = source.replace(/^(?:[^@/\\:\s]+@)?[^/\\:\s]+:/, "").split(/[?#]/, 1)[0];
    }
  }
  return path.posix.basename(pathname.replace(/\\/g, "/"), ".git");
}

// Own the complete form until the operation settles. In particular, another
// modal (Git authentication) may temporarily cover a running clone.
module.exports = class RepositoryDialog {
  constructor({ window, mode, directories, values = {}, onSubmit, onFinish }) {
    this.window = window;
    this.mode = mode;
    this.onSubmit = onSubmit;
    this.onFinish = onFinish;
    this.subscriptions = new CompositeDisposable();
    this.fields = {};
    this.pending = false;
    this.closed = false;
    this.destinationModified = Boolean(values.destinationPath);
    this.baseDirectory = directories.length === 1 ? directories[0] : "";
    const document = window.getDocument();
    this.element = document.createElement("form");
    this.element.className = "git-center-repository-dialog";
    const heading = document.createElement("h1");
    heading.textContent = mode === "initialize" ? "Initialize Repository" : "Clone Repository";
    this.element.append(heading);

    if (directories.length > 1) {
      const select = document.createElement("select");
      select.className = "form-control";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a folder…";
      select.append(placeholder);
      for (const directory of directories) {
        const option = document.createElement("option");
        option.value = option.textContent = directory;
        select.append(option);
      }
      this.addFieldLabel(mode === "clone" ? "Parent directory" : "Selected folder", select);
      select.addEventListener("change", () => {
        this.baseDirectory = select.value;
        this.destinationModified = false;
        this.fields.destinationPath.value =
          mode === "clone" ? this.proposedDestination() : select.value;
        this.validate();
      });
      this.directorySelect = select;
    }

    if (mode === "clone") this.addInput("sourceURL", "Clone from", values.sourceURL || "");
    this.addInput(
      "destinationPath",
      mode === "initialize" ? "Repository directory" : "Destination directory",
      values.destinationPath || this.baseDirectory,
    );
    if (mode === "clone") {
      this.addInput("remoteName", "Remote name", values.remoteName || "origin");
      this.fields.sourceURL.addEventListener("input", () => {
        if (!this.destinationModified)
          this.fields.destinationPath.value = this.proposedDestination();
        this.validate();
      });
      this.fields.destinationPath.addEventListener("input", () => {
        this.destinationModified = true;
      });
      if (values.sourceURL && !this.destinationModified)
        this.fields.destinationPath.value = this.proposedDestination();
    }

    this.status = document.createElement("div");
    this.status.className = "git-center-repository-dialog-status";
    this.status.setAttribute("role", "status");
    const buttons = document.createElement("div");
    buttons.className = "git-center-repository-dialog-buttons";
    this.cancelButton = document.createElement("button");
    this.cancelButton.type = "button";
    this.cancelButton.className = "btn";
    this.cancelButton.textContent = "Cancel";
    this.cancelButton.addEventListener("click", () => this.cancel());
    this.submitButton = document.createElement("button");
    this.submitButton.type = "submit";
    this.submitButton.className = "btn btn-primary";
    this.submitButton.textContent = mode === "initialize" ? "Initialize" : "Clone";
    buttons.append(this.cancelButton, this.submitButton);
    this.element.append(this.status, buttons);
    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        const controls = [...this.element.querySelectorAll("input, select, button")].filter(
          (control) => !control.disabled,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && event.target === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key !== "Escape" || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    });
    this.panel = window.addModalPanel({
      item: this.element,
      visible: false,
      autoFocus: Object.values(this.fields)[0],
    });
    this.subscriptions.add(
      lumine.commands.add(this.element, {
        "core:confirm": (event) => {
          event.stopPropagation();
          return this.submit();
        },
        "core:cancel": (event) => {
          event.stopPropagation();
          this.cancel();
        },
      }),
      this.panel.onDidDestroy(() => this.finish(null)),
      this.panel.onDidChangeVisible((visible) => {
        if (!visible && !this.panel.flowTransition && !this.pending) this.finish(null);
      }),
      this.panel.onDidEndModalFlow(() => {
        if (!this.pending) this.finish(null);
      }),
    );
    this.validate();
  }

  addFieldLabel(text, field) {
    const label = this.element.ownerDocument.createElement("label");
    label.append(text, field);
    this.element.append(label);
  }

  addInput(name, label, value) {
    const input = this.element.ownerDocument.createElement("input");
    input.type = "text";
    input.className = "input-text native-key-bindings";
    input.name = name;
    input.value = value;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => this.validate());
    this.fields[name] = input;
    this.addFieldLabel(label, input);
  }

  proposedDestination() {
    const name = repositoryName(this.fields.sourceURL.value.trim());
    return this.baseDirectory && name ? path.join(this.baseDirectory, name) : this.baseDirectory;
  }

  validate() {
    if (!this.submitButton || this.pending || this.closed) return;
    const fields = Object.values(this.fields);
    const oversized = fields.some((field) => field.value.length > INPUT_LIMIT);
    const valid = fields.every((field) => field.value.trim().length > 0);
    this.submitButton.disabled = this.retryBlocked || oversized || !valid;
    if (this.retryBlocked) return;
    this.status.textContent = oversized ? "Each field must be at most 64 Ki characters." : "";
    this.status.classList.toggle("text-error", oversized);
  }

  show() {
    this.panel.show({
      crumb: this.mode === "initialize" ? "Initialize Repository" : "Clone Repository",
    });
    Object.values(this.fields)[0].select();
  }

  async submit() {
    if (this.closed || this.pending || this.submitButton.disabled) return;
    const values = Object.fromEntries(
      Object.entries(this.fields).map(([name, field]) => [name, field.value.trim()]),
    );
    this.pending = true;
    this.submitButton.disabled = this.cancelButton.disabled = true;
    for (const field of Object.values(this.fields)) field.readOnly = true;
    if (this.directorySelect) this.directorySelect.disabled = true;
    this.status.classList.remove("text-error");
    this.status.textContent =
      this.mode === "initialize" ? "Initializing repository…" : "Cloning repository…";
    try {
      const repository = await this.onSubmit(values);
      if (!this.closed) this.finish(repository);
    } catch (error) {
      if (this.closed) return;
      this.pending = false;
      this.cancelButton.disabled = false;
      for (const field of Object.values(this.fields)) field.readOnly = false;
      if (this.directorySelect) this.directorySelect.disabled = false;
      this.retryBlocked = error.retriable === false;
      this.validate();
      this.status.classList.add("text-error");
      this.status.textContent = error.stderr || error.message;
      if (this.retryBlocked)
        this.status.textContent +=
          " Inspect the repository state before starting another operation.";
      if (!this.panel.isVisible()) this.show();
    }
  }

  cancel() {
    if (!this.pending) this.finish(null);
  }

  finish(result) {
    if (this.closed) return;
    this.closed = true;
    this.subscriptions.dispose();
    this.panel.destroy();
    this.onFinish(result);
  }
};
