import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { CodeEditorFile } from '../types/types';
import { isBinaryFile } from '../utils/binaryFile';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
  // REQ-047 — AI 选段改接受后,父组件清 file.diffInfo 但要求保留当前编辑器内容
  // (即 AI 改后的 new_full)。默认 false:清 diffInfo 触发重新读盘(旧行为)。
  // true:diffInfo 从有变无时跳过 reload,保留 content。
  retainContentOnDiffClear?: boolean;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const useCodeEditorDocument = ({ file, projectPath, retainContentOnDiffClear = false }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  // REQ-047 — 追踪上一次 diffInfo 是否存在,以便在"从有变无 + retain"时跳过 reload。
  const hadDiffRef = useRef(Boolean(file.diffInfo && file.diffInfo.old_string !== undefined && file.diffInfo.new_string !== undefined));
  // `fileProjectId` is the DB primary key passed down from the editor sidebar;
  // the fallback to `projectPath` preserves older callers that didn't yet
  // propagate the identifier.
  const fileProjectId = file.projectId ?? projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;
  const hasDiffNow = Boolean(file.diffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined);

  useEffect(() => {
    const loadFileContent = async () => {
      // REQ-047 — AI 选段改"接受"路径:父组件把 file.diffInfo 清空,但要求保留
      // 当前编辑器内容(AI 改后的 new_full)。此时跳过整个 load,避免读盘覆盖。
      if (retainContentOnDiffClear && hadDiffRef.current && !hasDiffNow) {
        hadDiffRef.current = hasDiffNow;
        return;
      }
      hadDiffRef.current = hasDiffNow;
      try {
        setLoading(true);
        setIsBinary(false);

        // Check if file is binary by extension
        if (isBinaryFile(file.name)) {
          setIsBinary(true);
          setLoading(false);
          return;
        }

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (hasDiffNow) {
          setContent(fileDiffNewString as string);
          setLoading(false);
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, filePath);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        setContent(`// Error loading file: ${message}\n// File: ${fileName}\n// Path: ${filePath}`);
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [file.diffInfo, file.name, fileDiffNewString, fileDiffOldString, fileName, filePath, fileProjectId, hasDiffNow, retainContentOnDiffClear]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, filePath, content);

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [content, filePath, fileProjectId]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = file.name;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [content, file.name]);

  return {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    handleSave,
    handleDownload,
  };
};
