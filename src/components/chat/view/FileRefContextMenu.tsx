import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  FolderOpen,
  Monitor,
  TerminalSquare,
  Copy,
  FileCode,
} from "lucide-react";

import { cn } from "../../../lib/utils";
import { authenticatedFetch } from "../../../utils/api";
import { copyTextToClipboard } from "../../../utils/clipboard";
import type { Project } from "../../../types/app";

/**
 * REQ-055 - right-click file actions for chat file references.
 *
 * Document-level contextmenu delegation over the chat area: any inline code
 * (or button title) that looks like a file path gets a menu to open it in the
 * built-in editor, copy relative/absolute paths, open it in a detected
 * external editor, reveal it in the file manager, or open its folder in a
 * terminal. All launches go through POST /api/file-actions/open, which
 * enforces the project-root sandbox; left-click behaviour is untouched.
 */

type MenuState = { x: number; y: number; rawPath: string } | null;

type Probe = {
  platform: string;
  editors: { id: string; label: string }[];
  canReveal: boolean;
  canTerminal: boolean;
};

const WINDOW_PATH_RE = /^[a-zA-Z]:[\\/]/;

function isDirectoryPath(value: string): boolean {
  return value.endsWith("/") || value.endsWith("\\");
}

/**
 * Match inline code spans (markdown `...`) and title-annotated buttons that
 * hold a file path. Excludes command-line-looking content and anything that
 * is clearly not a path (spaces, URLs, single file names without separator
 * and without extension are allowed when they carry a known text extension).
 */
function extractPathFromTarget(target: HTMLElement): string | null {
  const codeEl = target.closest("code");
  const raw = (codeEl ?? target.closest("[title]"))?.textContent?.trim();
  if (!raw || raw.length === 0 || raw.length > 400) return null;
  if (/\s/.test(raw)) return null;
  if (/^(https?:|mailto:|file:\/\/)/i.test(raw)) return null;
  if (
    raw.includes("|") ||
    raw.includes("&") ||
    raw.includes(">") ||
    raw.includes("<")
  )
    return null;
  const looksAbsolute =
    raw.startsWith("/") || WINDOW_PATH_RE.test(raw) || raw.startsWith("~");
  const hasSeparator = raw.includes("/") || raw.includes("\\");
  const extIndex = raw.lastIndexOf(".");
  const hasExt =
    extIndex > 0 &&
    !raw.slice(extIndex).includes("/") &&
    !raw.slice(extIndex).includes("\\") &&
    /^[a-zA-Z0-9]{1,12}$/.test(raw.slice(extIndex + 1));
  if (looksAbsolute || (hasSeparator && (hasExt || !raw.includes("."))))
    return raw;
  if (!hasSeparator && hasExt && !raw.includes(" ")) return raw;
  return null;
}

function joinProjectPath(projectPath: string, rawPath: string): string {
  const sep = WINDOW_PATH_RE.test(projectPath) ? "\\" : "/";
  const base = projectPath.replace(/[\\/]+$/, "");
  return base + sep + rawPath.replace(/^[\\/]+/, "").replace(/\//g, sep);
}

function resolveRelative(
  rawPath: string,
  projectPath: string | undefined,
): string {
  if (!projectPath) return rawPath;
  const base = projectPath.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.toLowerCase().startsWith(base.toLowerCase() + "/")) {
    return rawPath.slice(base.length + 1);
  }
  return rawPath;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT = 320;

function viewportSafe(x: number, y: number) {
  return {
    x: Math.min(Math.max(10, x), window.innerWidth - MENU_WIDTH - 10),
    y: Math.min(Math.max(10, y), window.innerHeight - MENU_HEIGHT - 10),
  };
}

/** Brand mark for VS Code (simple-icons path, CC0). */
function VSCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#007ACC"
        d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .325 8.74L3.899 12 .325 15.26a1 1 0 0 0 .002 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zM17.994 17.448 10.826 12l7.168-5.448v10.896z"
      />
    </svg>
  );
}

/** Isometric-cube stand-in for the Cursor editor mark. */
function CursorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 1.7 21.5 7.05 12 12.4 2.5 7.05Z" fill="#6b6b6b" />
      <path d="M2.5 7.05 12 12.4v9.9L2.5 16.95Z" fill="#2e2e2e" />
      <path d="M21.5 7.05 12 12.4v9.9l9.5-5.35Z" fill="#1c1c1c" />
    </svg>
  );
}

/** Known editors get their brand mark; anything else falls back to generic. */
function editorIcon(id: string): ReactNode {
  if (id === "vscode") return <VSCodeIcon className="h-4 w-4" />;
  if (id === "cursor") return <CursorIcon className="h-4 w-4" />;
  return <ExternalLink className="h-4 w-4" />;
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  disabled,
  showDividerBefore = false,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  showDividerBefore?: boolean;
}) {
  return (
    <>
      {showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
          "focus:outline-none focus:bg-accent",
          disabled ? "cursor-not-allowed opacity-50" : "hover:bg-accent",
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-500 dark:text-gray-400">
          {Icon}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </>
  );
}

export default function FileRefContextMenu({
  children,
  selectedProject,
  onOpenInEditor,
}: {
  children: React.ReactNode;
  selectedProject: Project | null;
  onOpenInEditor?: (filePath: string) => void;
}) {
  const { t } = useTranslation("chat");
  const [menu, setMenu] = useState<MenuState>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch("/api/file-actions/probe")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.data) setProbe(data.data as Probe);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      )
        return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Arrow-key navigation + Enter activation, mirroring the shared
  // ContextMenu (src/shared/view/ContextMenu.tsx) interaction model.
  useEffect(() => {
    if (!menu) return;
    const handleKeyboardMenuNavigation = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      const menuItems = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      if (!menuItems || menuItems.length === 0) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = Array.from(menuItems).findIndex(
        (menuItem) => menuItem === activeElement,
      );
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex =
          currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const previousIndex =
          currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[previousIndex]?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        if (activeElement?.getAttribute("role") === "menuitem") {
          event.preventDefault();
          activeElement.click();
        }
      }
    };
    document.addEventListener("keydown", handleKeyboardMenuNavigation);
    return () => {
      document.removeEventListener("keydown", handleKeyboardMenuNavigation);
    };
  }, [menu]);

  // Focus the first enabled item when the menu opens (keyboard entry point).
  useEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])',
    );
    first?.focus();
  }, [menu]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      // Respect the app's own context menus (file tree, sidebar, editor).
      const existing = target.closest(
        "[data-filetree-node],[data-sidebar-item]",
      );
      if (existing) return;
      const rawPath = extractPathFromTarget(target);
      if (!rawPath) return;
      event.preventDefault();
      setMenu({ ...viewportSafe(event.clientX, event.clientY), rawPath });
    },
    [],
  );

  const runAction = useCallback(
    async (action: "editor" | "reveal" | "terminal", editorId?: string) => {
      if (!menu || !selectedProject?.projectId) return;
      setMenu(null);
      try {
        const res = await authenticatedFetch("/api/file-actions/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProject.projectId,
            path: menu.rawPath,
            action,
            editorId,
          }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          showToast(detail?.message || t("fileActions.actionFailed"));
        }
      } catch {
        showToast(t("fileActions.actionFailed"));
      }
    },
    [menu, selectedProject, showToast, t],
  );

  const copyPath = useCallback(
    async (absolute: boolean) => {
      if (!menu) return;
      setMenu(null);
      const text = absolute
        ? WINDOW_PATH_RE.test(selectedProject?.fullPath || "") ||
          menu.rawPath.includes("\\") ||
          menu.rawPath.startsWith("/")
          ? menu.rawPath.startsWith("/") || WINDOW_PATH_RE.test(menu.rawPath)
            ? menu.rawPath
            : joinProjectPath(selectedProject?.fullPath || "", menu.rawPath)
          : joinProjectPath(selectedProject?.fullPath || "", menu.rawPath)
        : resolveRelative(menu.rawPath, selectedProject?.fullPath);
      const ok = await copyTextToClipboard(text);
      showToast(ok ? t("fileActions.copied") : t("fileActions.actionFailed"));
    },
    [menu, selectedProject, showToast, t],
  );

  const openInBuiltIn = useCallback(() => {
    if (!menu) return;
    setMenu(null);
    onOpenInEditor?.(menu.rawPath);
  }, [menu, onOpenInEditor]);

  const position = useMemo(
    () => (menu ? { left: menu.x, top: menu.y } : null),
    [menu],
  );

  return (
    <>
      <div onContextMenu={handleContextMenu} className="contents">
        {children}
      </div>
      {menu &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("fileActions.menuLabel")}
            style={{ position: "fixed", ...position, zIndex: 9999 }}
            className="animate-in fade-in-0 zoom-in-95 min-w-[200px] rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            <div
              className="truncate px-3 py-1.5 text-xs font-medium text-gray-400"
              title={menu.rawPath}
            >
              {menu.rawPath.split("/").pop() || menu.rawPath}
            </div>
            <MenuItem
              icon={<FileCode className="h-4 w-4" />}
              label={t("fileActions.openBuiltIn")}
              onSelect={openInBuiltIn}
              disabled={!onOpenInEditor}
            />
            {(probe?.editors ?? []).map((editor) => (
              <MenuItem
                key={editor.id}
                icon={editorIcon(editor.id)}
                label={t("fileActions.openInApp", { app: editor.label })}
                onSelect={() => void runAction("editor", editor.id)}
              />
            ))}
            {(probe?.canTerminal ?? false) && (
              <MenuItem
                icon={
                  probe?.platform === "win32" ? (
                    <TerminalSquare className="h-4 w-4" />
                  ) : (
                    <Monitor className="h-4 w-4" />
                  )
                }
                label={t("fileActions.openTerminal")}
                onSelect={() => void runAction("terminal")}
                showDividerBefore
              />
            )}
            {probe?.canReveal && (
              <MenuItem
                icon={<FolderOpen className="h-4 w-4" />}
                label={t("fileActions.reveal")}
                onSelect={() => void runAction("reveal")}
                disabled={isDirectoryPath(menu.rawPath)}
              />
            )}
            <MenuItem
              icon={<Copy className="h-4 w-4" />}
              label={t("fileActions.copyRelative")}
              onSelect={() => void copyPath(false)}
              showDividerBefore
            />
            <MenuItem
              icon={<Copy className="h-4 w-4" />}
              label={t("fileActions.copyAbsolute")}
              onSelect={() => void copyPath(true)}
            />
          </div>,
          document.body,
        )}
      {toast &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-gray-700">
            {toast}
          </div>,
          document.body,
        )}
    </>
  );
}
