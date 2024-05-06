import vscode from "vscode";

import * as ailly from "@ailly/core";
import { FileSystem } from "@davidsouther/jiffies/lib/esm/fs.js";
import { VSCodeFileSystemAdapter } from "./fs.js";
import { LOGGER, getAillyEngine, getAillyModel, resetLogger } from "./settings";
import { AillyEdit } from "@ailly/core/src/content/content";
import { dirname } from "path";

export async function generate(
  path: string,
  edit?: { prompt: string; start: number; end: number }
) {
  resetLogger();
  // CommonJS <> ESM Shenanigans
  LOGGER.info(`Generating for ${path}`);

  const fs = new FileSystem(new VSCodeFileSystemAdapter());
  // TODO: Work with multi-workspace editors
  const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath!;
  fs.cd(root);

  const engine = await getAillyEngine();
  const model = await getAillyModel(engine);

  const settings = await ailly.Ailly.makePipelineSettings({
    root,
    out: root,
    context: "folder",
    engine,
    model,
  });

  // Load content
  const context = await ailly.content.load(fs);
  const content = Object.values(context).filter((c) => c.path.startsWith(path));
  if (content.length == 0) return;
  if (edit) {
    const editContext: AillyEdit =
      edit.start === edit.end
        ? { file: content[0].path, after: edit.start + 1 }
        : { file: content[0].path, start: edit.start + 1, end: edit.end + 2 };
    content[0] = {
      context: {
        view: {},
        contents: content[0].context.contents,
        folder: [content[0].path],
        edit: editContext,
      },
      path: "/dev/ailly",
      name: "ailly",
      outPath: "/dev/ailly",
      prompt: edit.prompt,
    };
    context[content[0].path] = content[0];
    LOGGER.info(`Editing ${content.length} files`);
  } else {
    LOGGER.info(`Generating ${content.length} files`);
  }

  // Generate
  let generator = await ailly.Ailly.GenerateManager.from(
    content.map((c) => c.path),
    context,
    settings
  );
  generator.start();
  await generator.allSettled();

  if (content[0].meta?.debug?.finish! == "failed") {
    throw new Error(content[0].meta.debug?.message!);
  }

  // Write
  if (edit && content[0].context.edit) {
    vscode.window.activeTextEditor?.edit((builder) => {
      builder.replace(
        new vscode.Range(
          new vscode.Position(edit.start, 0),
          new vscode.Position(edit.end + 1, 0)
        ),
        (content[0].response ?? "") + "\n"
      );
    });
  } else {
    ailly.content.write(fs as any, content);
  }
}