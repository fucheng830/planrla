import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import type { LLMProvider } from '../types/app';

export type PaletteOps = {
  openFile: (path: string) => void;
  // REQ-051 session context menu: optional provider pins the agents tab to a
  // specific agent (used by "go to configuration" from a session's provider).
  openSettings: (tab?: string, provider?: LLMProvider) => void;
  refreshProjects: () => Promise<void> | void;
};

type Registry = MutableRefObject<Partial<PaletteOps>>;

const PaletteOpsContext = createContext<Registry | null>(null);

const defaultOps: PaletteOps = {
  openFile: () => undefined,
  openSettings: () => undefined,
  refreshProjects: () => undefined,
};

export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Partial<PaletteOps>>({});
  return <PaletteOpsContext.Provider value={ref}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const ref = useContext(PaletteOpsContext);
  return useMemo<PaletteOps>(
    () => ({
      openFile: (path) => (ref?.current.openFile ?? defaultOps.openFile)(path),
      openSettings: (tab, provider) => (ref?.current.openSettings ?? defaultOps.openSettings)(tab, provider),
      refreshProjects: () => (ref?.current.refreshProjects ?? defaultOps.refreshProjects)(),
    }),
    [ref],
  );
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const ref = useContext(PaletteOpsContext);
  const { openFile, openSettings, refreshProjects } = partial;

  useEffect(() => {
    if (!ref) return undefined;
    const prev = { ...ref.current };
    if (openFile) ref.current.openFile = openFile;
    if (openSettings) ref.current.openSettings = openSettings;
    if (refreshProjects) ref.current.refreshProjects = refreshProjects;
    return () => {
      if (openFile && ref.current.openFile === openFile) ref.current.openFile = prev.openFile;
      if (openSettings && ref.current.openSettings === openSettings) ref.current.openSettings = prev.openSettings;
      if (refreshProjects && ref.current.refreshProjects === refreshProjects) ref.current.refreshProjects = prev.refreshProjects;
    };
  }, [ref, openFile, openSettings, refreshProjects]);
}
