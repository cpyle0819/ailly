import { dirname } from "node:path";
import { GenerateManager } from "@ailly/core/lib/actions/generate_manager.js";
import {
  type AillyEdit,
  type Content,
  loadContent,
  makeCLIContent,
  writeContent,
} from "@ailly/core/lib/content/content.js";
import { GitignoreFs } from "@ailly/core/lib/content/gitignore_fs.js";
import { loadTemplateView } from "@ailly/core/lib/content/template.js";
import {
  type PipelineSettings,
  makePipelineSettings,
} from "@ailly/core/lib/index.js";
import { assertExists } from "@davidsouther/jiffies/lib/cjs/assert.js";
import { FileSystem } from "@davidsouther/jiffies/lib/cjs/fs.js";
import * as vscode from "vscode";
import { deleteEdit, insert, updateSelection } from "./editor.js";
import { VSCodeFileSystemAdapter } from "./fs.js";
import { LOGGER, SETTINGS, resetLogger } from "./settings.js";
import type { StatusManager } from "./status_manager";

export interface ExtensionEdit {
  prompt: string;
  start: number;
  end: number;
}

export async function generate(
  path: string,
  {
    extensionEdit,
    manager,
    clean = false,
    continued = false,
    depth = 1,
  }: {
    extensionEdit?: ExtensionEdit;
    manager: StatusManager;
    clean?: boolean;
    continued?: boolean;
    depth?: number;
  },
) {
  resetLogger();
  LOGGER.info(`Generating for ${path}`);

  const engine = await SETTINGS.getAillyEngine();
  const model = await SETTINGS.getAillyModel(engine);
  if (engine === "bedrock") {
    await SETTINGS.prepareBedrock();
  }

  // Prepare configuration
  const fs = new GitignoreFs(new VSCodeFileSystemAdapter());
  // biome-ignore lint/suspicious/noExplicitAny: Monkey patching
  (fs as any).p = (path: string) =>
    // biome-ignore lint/suspicious/noExplicitAny: Monkey patching
    (FileSystem.prototype as any).p.call(
      fs,
      path.replace("~", process.env.HOME ?? "~"),
    );

  const templateView = await loadTemplateView(
    fs,
    ...SETTINGS.getTemplateViews(),
  );

  const stat = await fs.stat(path);
  const root = stat.isFile() ? dirname(path) : path;
  fs.cd(root);

  const settings = await makePipelineSettings({
    root,
    out: root,
    context: "folder",
    continued,
    engine,
    model,
    templateView,
  });

  // Load content
  const [content, context] = await loadContentParts({
    fs,
    path,
    extensionEdit,
    settings,
    depth,
  });

  if (content.length === 0) {
    return;
  }

  const doEdit = extensionEdit && content[0].context.edit;
  switch (true) {
    case clean:
      break;

    default: {
      // Generate
      const generator = await GenerateManager.from(
        content.map((c) => c.path),
        context,
        settings,
      );
      manager.track(generator);
      generator.start();

      if (doEdit) {
        await executeStreaming(content, assertExists(content[0].context.edit));
      }

      await generator.allSettled();
      if (content[0].meta?.debug?.finish === "failed") {
        throw new Error(generator.formatError(content[0]));
      }
    }
  }

  // Write
  if (!doEdit) {
    writeContent(fs, content, { clean });
  }
}

async function executeStreaming(content: Content[], edit: AillyEdit) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  editor.selections = [];
  // Lazy spin until the request starts
  const stream = await assertExists(content[0].responseStream).promise;
  let replace = "";
  let first = true;
  for await (let token of stream) {
    if (vscode.window.activeTextEditor !== editor) {
      LOGGER.debug(
        "Active window changed during streaming, stopping future updates.",
      );
      return;
    }
    if (typeof token !== "string") {
      token = new TextDecoder().decode(token);
    }
    if (first) {
      token = token.trimStart();
      await deleteEdit(edit);
      first = false;
    }
    await insert(edit, replace, token);
    replace += token;
  }
  updateSelection(edit, replace);
}

async function loadContentParts({
  fs,
  path,
  extensionEdit,
  settings,
  depth = 1,
}: {
  fs: FileSystem;
  path: string;
  extensionEdit: ExtensionEdit | undefined;
  settings: PipelineSettings;
  depth: number;
}): Promise<[Content[], Record<string, Content>]> {
  const context = await loadContent(fs, { meta: settings }, depth);
  const content: Content[] = Object.values(context).filter((c) =>
    c.path.startsWith(path),
  );
  if (content.length === 0) {
    return [[], {}];
  }
  if (extensionEdit) {
    const editContext: AillyEdit =
      extensionEdit.start === extensionEdit.end
        ? { file: content[0].path, after: extensionEdit.start + 1 }
        : {
            file: content[0].path,
            start: extensionEdit.start,
            end: extensionEdit.end,
          };
    content.splice(
      -1,
      1,
      makeCLIContent({
        prompt: extensionEdit.prompt,
        argContext: "folder",
        context,
        root: dirname(content[0].path),
        edit: editContext,
        isolated: true,
      }),
    );
    context[content[0].path] = content[0];
    LOGGER.info(`Editing ${content.length} files`);
  } else {
    LOGGER.info(`Generating ${content.length} files`);
  }

  return [content, context];
}
