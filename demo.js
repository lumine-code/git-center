// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view"],
  viewport: { width: 1200, height: 600 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    const git = (args) =>
      require("node:child_process").execFileSync("git", args, {
        cwd: context.project,
        windowsHide: true,
      });
    git(["branch", "smoothing"]);
    git(["branch", "data-validation"]);
    state.editor = await open("Version Control/signal.js");
    state.editor.setText(
      "export function average(samples) {\n  if (samples.length === 0) return 0;\n  return samples.reduce((sum, value) => sum + value, 0) / samples.length;\n}\n\nconst samples = [0.2, 0.8, -0.4, 0.5, 1.0];\nconsole.log(`Mean amplitude: ${average(samples).toFixed(2)}`);\n",
    );
    await state.editor.save();
    await lumine.project.setPaths([fixture("Version Control")]);
    await new Promise((r) => setTimeout(r, 600));
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Select a local branch and inspect the repository status.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "git-center:select-branch");
        }
      },
      ready() {
        return Boolean(document.body.innerText.includes("data-validation"));
      },
    },
    {
      id: "initialize",
      file: "demo-initialize.png",
      caption: "Initialize a local repository in a chosen project folder.",
      async run({ lumine, fixture, open }) {
        const main = lumine.packages.getActivePackage("git-center").mainModule;
        main.getBranchListView().selectListHost.cancel();
        await open("New Project/notes.md");
        void main.provideRepositorySetup().openInitializeDialog({
          directoryPath: fixture("New Project"),
        });
      },
      ready() {
        return Boolean(
          document.querySelector(".git-center-repository-dialog input[name='destinationPath']"),
        );
      },
    },
    {
      id: "clone",
      file: "demo-clone.png",
      caption: "Choose a remote repository, clone destination, and remote name.",
      async run({ lumine, fixture, project }) {
        const main = lumine.packages.getActivePackage("git-center").mainModule;
        void main.provideRepositorySetup().openCloneDialog({
          sourceURL: project,
          destinationPath: fixture("Cloned Project"),
          remoteName: "origin",
        });
      },
      ready() {
        return Boolean(
          document.querySelector(".git-center-repository-dialog input[name='sourceURL']"),
        );
      },
    },
  ],
  async cleanup() {},
};
