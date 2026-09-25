import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { AppError } from "@/shared/utils.js";

/**
 * REQ-055 - file actions for chat file references.
 *
 * The server runs on the user's machine, so it can launch local apps on the
 * user's behalf: open a file in a detected editor, reveal it in the platform
 * file manager, or open its folder in a terminal. Security model mirrors the
 * /files/content route: the requested path must resolve inside the project
 * root, and every launch is argv-direct (no shell) so chat-authored paths
 * can never inject commands.
 */

export type EditorApp = { id: string; label: string };

export type FileActionProbe = {
  platform: NodeJS.Platform;
  editors: EditorApp[];
  canReveal: boolean;
  canTerminal: boolean;
};

export type FileActionKind = "editor" | "reveal" | "terminal";

type EditorDef = EditorApp & {
  macAppName: string;
  winAppPathsExe: string;
  winCliName: string;
  linuxCmd: string;
};

const EDITORS: EditorDef[] = [
  {
    id: "vscode",
    label: "VS Code",
    macAppName: "Visual Studio Code",
    winAppPathsExe: "Code.exe",
    winCliName: "code",
    linuxCmd: "code",
  },
  {
    id: "cursor",
    label: "Cursor",
    macAppName: "Cursor",
    winAppPathsExe: "Cursor.exe",
    winCliName: "cursor",
    linuxCmd: "cursor",
  },
];

/** editorId -> resolved launch info, cached for the process lifetime. */
const editorResolveCache = new Map<
  string,
  { exe: string | null; mac: string | null; linux: string | null }
>();

/** Run a short-lived probe command and capture stdout; null on any failure. */
function runCommand(
  command: string,
  args: string[],
  timeoutMs = 5000,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let output = "";
    const timer = setTimeout(() => child?.kill(), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output : null);
    });
  });
}

/** First non-empty line of probe output, or null. */
function firstLine(output: string | null): string | null {
  const line = output
    ?.split(/\r?\n/)
    .find((candidate) => candidate.trim().length > 0);
  return line ? line.trim() : null;
}

/** Windows: resolve an editor exe via the App Paths registry (HKCU then HKLM). */
async function resolveWindowsExeFromAppPaths(
  exeName: string,
): Promise<string | null> {
  for (const hive of ["HKCU", "HKLM"]) {
    const key =
      hive +
      "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" +
      exeName;
    const output = await runCommand("reg", ["query", key, "/ve"]);
    const match = output?.match(/REG_SZ\s+(.+)/);
    const exe = match?.[1]?.trim();
    if (exe && fs.existsSync(exe)) return exe;
  }
  return null;
}

/** Windows fallback: resolve via where, real exe sits near the CLI shim. */
async function resolveWindowsExeFromPath(
  cliName: string,
): Promise<string | null> {
  const shim = firstLine(await runCommand("where", [cliName]));
  if (!shim) return null;
  const base = path.basename(shim).replace(/\.(cmd|exe)$/i, "");
  for (const dir of [path.dirname(path.dirname(shim)), path.dirname(shim)]) {
    const exe = path.join(dir, base + ".exe");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

async function resolveWindowsEditorExe(def: EditorDef): Promise<string | null> {
  return (
    (await resolveWindowsExeFromAppPaths(def.winAppPathsExe)) ??
    (await resolveWindowsExeFromPath(def.winCliName))
  );
}

function macAppExists(appName: string): boolean {
  return (
    fs.existsSync(path.join("/Applications", appName + ".app")) ||
    fs.existsSync(path.join(homedir(), "Applications", appName + ".app"))
  );
}

async function whichExists(command: string): Promise<boolean> {
  const output = await runCommand("which", [command]);
  return Boolean(output && output.trim().length > 0);
}

async function resolveEditorLaunchInfo(def: EditorDef) {
  const cached = editorResolveCache.get(def.id);
  if (cached) return cached;
  let info: { exe: string | null; mac: string | null; linux: string | null };
  if (process.platform === "win32") {
    info = { exe: await resolveWindowsEditorExe(def), mac: null, linux: null };
  } else if (process.platform === "darwin") {
    info = {
      exe: null,
      mac: macAppExists(def.macAppName) ? def.macAppName : null,
      linux: null,
    };
  } else {
    info = {
      exe: null,
      mac: null,
      linux: (await whichExists(def.linuxCmd)) ? def.linuxCmd : null,
    };
  }
  editorResolveCache.set(def.id, info);
  return info;
}

/** Which editors are usable on this machine, for the client menu. */
export async function probeFileActions(): Promise<FileActionProbe> {
  const editors: EditorApp[] = [];
  for (const def of EDITORS) {
    const info = await resolveEditorLaunchInfo(def);
    if (info.exe || info.mac || info.linux) {
      editors.push({ id: def.id, label: def.label });
    }
  }
  return {
    platform: process.platform,
    editors,
    canReveal: true,
    canTerminal: true,
  };
}

function detachSpawn(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): void {
  try {
    spawn(command, args, {
      detached: true,
      stdio: "ignore",
      ...options,
    }).unref();
  } catch (error) {
    // AppErrorOptions has no cause slot; log here, surface a stable message.
    console.error("[file-actions] spawn failed:", command, error);
    throw new AppError("failed to launch " + command, {
      code: "FILE_ACTION_LAUNCH_FAILED",
      statusCode: 500,
    });
  }
}

async function launchEditor(
  editorId: string,
  targetPath: string,
): Promise<void> {
  const def = EDITORS.find((candidate) => candidate.id === editorId);
  if (!def)
    throw new AppError("unknown editor", {
      code: "UNKNOWN_EDITOR",
      statusCode: 400,
    });
  const info = await resolveEditorLaunchInfo(def);
  if (process.platform === "win32" && info.exe) {
    detachSpawn(info.exe, [targetPath]);
  } else if (process.platform === "darwin" && info.mac) {
    detachSpawn("open", ["-a", info.mac, targetPath]);
  } else if (
    process.platform !== "win32" &&
    process.platform !== "darwin" &&
    info.linux
  ) {
    detachSpawn(info.linux, [targetPath]);
  } else {
    throw new AppError("editor not available", {
      code: "EDITOR_UNAVAILABLE",
      statusCode: 400,
    });
  }
}

function revealInFileManager(targetPath: string): void {
  if (process.platform === "win32") {
    detachSpawn("explorer", ["/select,", targetPath]);
  } else if (process.platform === "darwin") {
    detachSpawn("open", ["-R", targetPath]);
  } else {
    detachSpawn("xdg-open", [path.dirname(targetPath)]);
  }
}

async function openFolderInTerminal(dirPath: string): Promise<void> {
  if (process.platform === "win32") {
    const wtPath = firstLine(await runCommand("where", ["wt"]));
    if (wtPath) {
      detachSpawn(wtPath, ["-d", dirPath]);
    } else {
      // Fallback: a fresh cmd.exe console rooted at the folder.
      detachSpawn("cmd.exe", [], { cwd: dirPath });
    }
    return;
  }
  if (process.platform === "darwin") {
    const terminalApp = macAppExists("Ghostty") ? "Ghostty" : "Terminal";
    detachSpawn("open", ["-a", terminalApp, dirPath]);
    return;
  }
  if (await whichExists("gnome-terminal")) {
    detachSpawn("gnome-terminal", ["--working-directory=" + dirPath]);
    return;
  }
  if (await whichExists("konsole")) {
    detachSpawn("konsole", ["--workdir", dirPath]);
    return;
  }
  throw new AppError("no supported terminal found", {
    code: "TERMINAL_UNAVAILABLE",
    statusCode: 400,
  });
}

export async function openFileAction(options: {
  root: string;
  rawPath: string;
  action: FileActionKind;
  editorId?: string;
}): Promise<void> {
  const { root, rawPath, action, editorId } = options;
  const resolved = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(root, rawPath);
  const rootPrefix = path.resolve(root) + path.sep;
  if (!resolved.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
    throw new AppError("path must be under the project root", {
      code: "PATH_NOT_ALLOWED",
      statusCode: 403,
    });
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    throw new AppError("file not found", {
      code: "FILE_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (action === "editor" && editorId) {
    await launchEditor(editorId, resolved);
  } else if (action === "reveal") {
    revealInFileManager(resolved);
  } else if (action === "terminal") {
    await openFolderInTerminal(
      stat.isDirectory() ? resolved : path.dirname(resolved),
    );
  } else {
    throw new AppError("editorId required for editor action", {
      code: "INVALID_ACTION",
      statusCode: 400,
    });
  }
}
