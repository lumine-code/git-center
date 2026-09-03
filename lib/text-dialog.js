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
      commands: {
        "git-center:confirm-text-dialog": {
          description: "Submit the entered value to the pending Git operation.",
          didDispatch: () => this.confirm(),
        },
      },
      actions: [
        {
          command: "git-center:confirm-text-dialog",
          context: "dialog",
          primary: true,
          // Validation and failed Git operations keep the prompt open;
          // confirm() closes it only when its tri-state callback returns true.
          disposition: "stay",
          dispatch: "local",
        },
      ],
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
    this.inputDialogView.setInfoMessage(prompt);
    this.inputDialogView.clearStatus();
    this.inputDialogView.setPlaceholderText(placeholder);
    this.inputDialogView.show({
      ...(crumb ? { crumb } : {}),
      query: value,
      // A prefilled value is a suggestion, so typing replaces it outright.
      selectQuery: true,
    });
  }

  async confirm() {
    const value = this.inputDialogView.getQuery().trim();
    if (this.pending) return;
    if (!value && !this.allowEmpty) {
      await this.inputDialogView.setStatus({ type: "error", message: this.emptyMessage });
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
    return this.inputDialogView.destroy();
  }
};
