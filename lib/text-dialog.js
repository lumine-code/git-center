// A one-field prompt: a resting message, a query editor, and an async confirm
// that keeps the dialog open until the work reports success.
//
// `onConfirm` follows the tri-state contract the Git helpers use — only `true`
// closes the dialog, so a failed operation leaves the value in place to correct
// with the error already reported as a notification.
module.exports = class TextDialog {
  constructor({ className } = {}) {
    this.inputDialogView = lumine.workspace.buildInputDialog({
      className,
      // The query here is the caller's value, not scratch input: `show` sets
      // it and the dialog must open on it rather than on an empty field.
      preserveQuery: true,
      didConfirm: () => this.confirm(),
      didCancel: () => this.hide(),
    });
  }

  show({
    prompt,
    onConfirm,
    crumb,
    placeholder = "",
    value = "",
    emptyMessage = "Enter a value.",
    allowEmpty = false,
  }) {
    this.onConfirm = onConfirm;
    this.emptyMessage = emptyMessage;
    this.allowEmpty = allowEmpty;
    this.pending = false;
    this.inputDialogView.update({
      infoMessage: prompt,
      status: null,
      placeholderText: placeholder,
      query: value,
      // A prefilled value is a suggestion, so typing replaces it outright.
      selectQuery: true,
    });
    this.inputDialogView.show(crumb ? { crumb } : undefined);
  }

  async confirm() {
    const value = this.inputDialogView.getQuery().trim();
    if (this.pending) return;
    if (!value && !this.allowEmpty) {
      await this.inputDialogView.update({
        status: { type: "error", message: this.emptyMessage },
      });
      return;
    }
    this.pending = true;
    const succeeded = await this.onConfirm?.(value);
    this.pending = false;
    if (succeeded) this.hide();
  }

  hide() {
    this.inputDialogView.hide();
  }

  destroy() {
    this.inputDialogView.destroy();
  }
};
