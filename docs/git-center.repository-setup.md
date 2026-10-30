# git-center.repository-setup

Open local repository initialization and clone forms with an optional captured path context.

| Field       | Value                                           |
| ----------- | ----------------------------------------------- |
| Version     | 1.0.0                                           |
| Provided by | Repository setup UI                             |
| Consumed by | Packages offering repository setup entry points |
| Owner       | git-center                                      |

## Registration

Declare `git-center.repository-setup` at `^1.0.0` in `consumedServices`. Consumption is passive; return a disposable that clears only that provider reference.

## Contract

```ts
type SetupContext = {
  event?: Event;
};
type RepositorySetup = {
  openInitializeDialog(
    options?: SetupContext & {
      directoryPath?: string;
    },
  ): Promise<GitRepository | null>;
  openCloneDialog(
    options?: SetupContext & {
      sourceURL?: string;
      destinationPath?: string;
      remoteName?: string;
    },
  ): Promise<GitRepository | null>;
};
```

All options are optional. `directoryPath` is an explicit repository directory and takes precedence over the event context. `destinationPath` is the complete clone destination. `remoteName` defaults to `origin`. A method resolves to the created core repository on success or `null` when dismissed or retired. Operation errors remain in the form for correction; they do not automatically retry a mutation.

## Minimal example

```js
consumeRepositorySetup(service) {
  this.repositorySetup = service;
  return new Disposable(() => {
    if (this.repositorySetup === service) this.repositorySetup = null;
  });
}
initializeFolder(event, directoryPath) {
  return this.repositorySetup?.openInitializeDialog({ event, directoryPath });
}
```

## Behavior

The provider captures the command's originating window and path before loading its UI. Tree-originating commands use the current tree selection; other commands use the center document's backing path, including non-text documents. A file selects its parent directory. Several distinct folders require an explicit choice in the form. Without a path the form offers the configured project home as an editable suggestion. Clone destinations follow the selected parent folder and repository name until edited.

The forms work independently of repository selection, pinned repositories, the status bar and existing repositories. Writes run through `lumine.repositories`. A successful operation adds its directory to the project. Each window owns its form; a second invocation preserves an operation already running in that window.

## Teardown

Consumers clear their reference when the provider disappears. Closing a window or deactivating the provider retires its forms, aborts outstanding operations and settles pending results as `null`. References retained from a previous activation cannot open new UI.

## Versioning

Incompatible changes require a new contract version.
