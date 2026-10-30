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
    this.controls = [];
    this.pending = false;
    this.closed = false;
    this.destinationModified = Boolean(values.destinationPath);
    this.baseDirectory = directories.length === 1 ? directories[0] : "";
    const document = window.getDocument();
    this.element = document.createElement("form");
    this.element.className = "git-center-repository-dialog dialog-form";
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute(
      "aria-label",
      mode === "initialize" ? "Initialize Repository" : "Clone Repository",
    );
    const header = document.createElement("header");
    header.className = "dialog-header";
    const heading = document.createElement("h1");
    heading.className = "dialog-title";
    heading.textContent = mode === "initialize" ? "Initialize Repository" : "Clone Repository";
    header.append(heading);
    this.body = document.createElement("div");
    this.body.className = "dialog-body";
    this.element.append(header, this.body);

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
      this.controls.push(select);
      select.addEventListener("change", () => {
        this.baseDirectory = select.value;
        this.destinationModified = false;
        this.setDestination(mode === "clone" ? this.proposedDestination() : select.value);
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
      if (values.sourceURL && !this.destinationModified)
        this.setDestination(this.proposedDestination());
    }

    this.status = document.createElement("div");
    this.status.className = "git-center-repository-dialog-status dialog-status";
    this.status.setAttribute("role", "status");
    const buttons = document.createElement("div");
    buttons.className = "git-center-repository-dialog-buttons dialog-actions";
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
    const footer = document.createElement("footer");
    footer.className = "dialog-footer";
    footer.append(buttons);
    this.element.append(this.status, footer);
    this.controls.push(this.cancelButton, this.submitButton);
    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.moveFocus(event.target, event.shiftKey ? -1 : 1);
      }
      if (event.key !== "Escape" || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    });
    this.panel = window.addModalPanel({
      item: this.element,
      className: "dialog-panel",
      visible: false,
      autoFocus: Object.values(this.fields)[0].getElement(),
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
        "core:focus-next": (event) => {
          event.stopPropagation();
          this.moveFocus(event.target, 1);
        },
        "core:focus-previous": (event) => {
          event.stopPropagation();
          this.moveFocus(event.target, -1);
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
    label.className = "dialog-field";
    const title = this.element.ownerDocument.createElement("span");
    title.className = "dialog-label";
    title.textContent = text;
    label.append(title, field);
    this.body.append(label);
  }

  addInput(name, label, value) {
    const editor = lumine.workspace.buildTextEditor({ mini: true, softWrapped: false });
    editor.setText(value);
    const element = editor.getElement();
    element.dataset.field = name;
    element.setAttribute("aria-label", label);
    this.fields[name] = editor;
    this.controls.push(element);
    this.subscriptions.add(
      lumine.textEditors.add(editor, { role: "input" }),
      editor.onDidChange(() => {
        if (name === "destinationPath" && !this.settingDestination) this.destinationModified = true;
        if (name === "sourceURL" && !this.destinationModified)
          this.setDestination(this.proposedDestination());
        this.validate();
      }),
    );
    this.addFieldLabel(label, element);
  }

  setDestination(value) {
    this.settingDestination = true;
    try {
      this.fields.destinationPath.setText(value);
    } finally {
      this.settingDestination = false;
    }
  }

  moveFocus(target, direction) {
    const controls = this.controls.filter((control) => !control.disabled);
    if (!controls.length) return;
    const index = controls.findIndex((control) => control === target || control.contains(target));
    controls[(index + direction + controls.length) % controls.length].focus();
  }

  proposedDestination() {
    const source = this.fields.sourceURL;
    if (source.getBuffer().getLength() > INPUT_LIMIT || source.getLineCount() > 1)
      return this.baseDirectory;
    const name = repositoryName(source.getText().trim());
    return this.baseDirectory && name ? path.join(this.baseDirectory, name) : this.baseDirectory;
  }

  validate() {
    if (!this.submitButton || this.pending || this.closed) return;
    const fields = Object.values(this.fields);
    const oversized = fields.some((field) => field.getBuffer().getLength() > INPUT_LIMIT);
    const multiline = fields.some((field) => field.getLineCount() > 1);
    const valid =
      !oversized && !multiline && fields.every((field) => field.getText().trim().length > 0);
    this.submitButton.disabled = this.retryBlocked || !valid;
    if (this.retryBlocked) return;
    this.status.textContent = oversized
      ? "Each field must be at most 64 Ki characters."
      : multiline
        ? "Each field must contain a single line."
        : "";
    this.status.classList.toggle("text-error", oversized || multiline);
  }

  show() {
    this.panel.show({
      crumb: this.mode === "initialize" ? "Initialize Repository" : "Clone Repository",
    });
    Object.values(this.fields)[0].selectAll();
  }

  async submit() {
    if (this.closed || this.pending || this.submitButton.disabled) return;
    const values = Object.fromEntries(
      Object.entries(this.fields).map(([name, field]) => [name, field.getText().trim()]),
    );
    this.pending = true;
    this.element.setAttribute("aria-busy", "true");
    this.submitButton.disabled = this.cancelButton.disabled = true;
    for (const field of Object.values(this.fields)) field.setReadOnly(true);
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
      this.element.removeAttribute("aria-busy");
      this.cancelButton.disabled = false;
      for (const field of Object.values(this.fields)) field.setReadOnly(false);
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
    for (const field of Object.values(this.fields)) field.destroy();
    this.onFinish(result);
  }
};
