import { createContext, useContext } from 'react';

export interface ComposerApi {
  /** 在 composer 当前 input 末尾追加文本(换行分隔)。*/
  insertText: (text: string) => void;
}

const ComposerContext = createContext<ComposerApi | null>(null);

export const ComposerProvider = ComposerContext.Provider;

export function useComposer(): ComposerApi | null {
  return useContext(ComposerContext);
}
