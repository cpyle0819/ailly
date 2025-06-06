import * as assert from "node:assert";
import { resolve } from "node:path";
import { mock } from "node:test";
import * as vscode from "vscode";
import { generate } from "./generate.js";
import { SETTINGS } from "./settings.js";
import { MockStatusManager } from "./status_manager.js";
import { getNormalizedText } from "./testing/util.js";

async function activate(docUri: vscode.Uri) {
  const ext = vscode.extensions.getExtension("davidsouther.ailly");
  await ext?.activate();
  const doc = await vscode.workspace.openTextDocument(docUri);
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

process.env.AILLY_ENGINE = "noop";
process.env.AILLY_NOOP_RESPONSE = "Edited\n";
process.env.AILLY_NOOP_TIMEOUT = "0";
process.env.AILLY_NOOP_STREAM = "";

suite("Ailly Extension Generate", () => {
  test("generate edit", async () => {
    const path = resolve(__dirname, "..", "testing", "edit.txt");
    const docUri = vscode.Uri.file(path);
    await activate(docUri);
    mock.method(SETTINGS, "getAillyEngine", () => "noop");
    mock.method(SETTINGS, "getPreferStreamingEdit", () => false);

    await generate(path, {
      extensionEdit: { prompt: "Replace with Edited", start: 1, end: 3 },
      manager: new MockStatusManager(),
    });

    assert.equal(getNormalizedText(), "Line 1\nEdited\nLine 4");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("generate edit streaming", async () => {
    const path = resolve(__dirname, "..", "testing", "edit.txt");
    const docUri = vscode.Uri.file(path);
    await activate(docUri);
    process.env.AILLY_NOOP_RESPONSE = "This text\nwas edited\n";
    process.env.AILLY_NOOP_STREAM = "yes";
    mock.method(SETTINGS, "getAillyEngine", () => "noop");
    mock.method(SETTINGS, "getPreferStreamingEdit", () => true);

    await generate(path, {
      extensionEdit: { prompt: "Replace with Edited", start: 1, end: 3 },
      manager: new MockStatusManager(),
    });

    assert.equal(getNormalizedText(), "Line 1\nThis text\nwas edited\nLine 4");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
