import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MessageSquare } from 'lucide-react';

import { getLanguageFromPath } from '../utils/languageDetect';

import { DiffLineComments } from './DiffLineComments';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolDiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileClick?: () => void;
  badge?: string;
  badgeColor?: 'gray' | 'green';
}

/**
 * Compact diff viewer — VS Code-style
 */
export const ToolDiffViewer: React.FC<ToolDiffViewerProps> = ({
  oldContent,
  newContent,
  filePath,
  createDiff,
  onFileClick,
  badge = 'Diff',
  badgeColor = 'gray'
}) => {
  const { t } = useTranslation('chat');
  const badgeClasses = badgeColor === 'green'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';

  const diffLines = useMemo(
    () => {
      if (oldContent === undefined || newContent === undefined) {
        return [];
      }
      return createDiff(oldContent, newContent)
    },
    [createDiff, oldContent, newContent]
  );

  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);
  const DIFF_HIGHLIGHT_THRESHOLD = 200;
  const shouldHighlight = language !== 'text' && diffLines.length <= DIFF_HIGHLIGHT_THRESHOLD;

  const [comments, setComments] = useState<Record<number, string>>({});
  const [openCommentLine, setOpenCommentLine] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const setComment = (lineNum: number, text: string) => {
    setComments((prev) => {
      const next = { ...prev };
      if (text.trim()) next[lineNum] = text;
      else delete next[lineNum];
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded border border-gray-200/60 dark:border-gray-700/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200/60 bg-gray-50/80 px-2.5 py-1 dark:border-gray-700/50 dark:bg-gray-800/40">
        {onFileClick ? (
          <button
            onClick={onFileClick}
            className="cursor-pointer truncate font-mono text-[11px] text-primary transition-colors hover:text-primary/80"
          >
            {filePath}
          </button>
        ) : (
          <span className="truncate font-mono text-[11px] text-gray-600 dark:text-gray-400">
            {filePath}
          </span>
        )}
        <span className={`rounded px-1.5 py-px text-[10px] font-medium ${badgeClasses} ml-2 flex-shrink-0`}>
          {badge}
        </span>
      </div>

      {/* Diff lines */}
      <div className="font-mono text-[11px] leading-[18px]">
        {diffLines.map((diffLine, i) => (
          <React.Fragment key={i}>
            <div className="group flex">
              <span
                className={`w-6 flex-shrink-0 select-none text-center ${
                  diffLine.type === 'removed'
                    ? 'bg-red-50 text-red-400 dark:bg-red-950/30 dark:text-red-500'
                    : 'bg-green-50 text-green-400 dark:bg-green-950/30 dark:text-green-500'
                }`}
              >
                {diffLine.type === 'removed' ? '-' : '+'}
              </span>
              <span
                className={`flex-1 whitespace-pre-wrap px-2 ${
                  diffLine.type === 'removed'
                    ? 'bg-red-50/50 text-red-800 dark:bg-red-950/20 dark:text-red-200'
                    : 'bg-green-50/50 text-green-800 dark:bg-green-950/20 dark:text-green-200'
                }`}
              >
                {shouldHighlight ? (
                  <SyntaxHighlighter
                    language={language}
                    style={oneDark}
                    PreTag="span"
                    CodeTag="span"
                    customStyle={{
                      margin: 0,
                      padding: 0,
                      background: 'transparent',
                      fontSize: '11px',
                      lineHeight: '18px',
                      display: 'inline',
                    }}
                    codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
                  >
                    {diffLine.content}
                  </SyntaxHighlighter>
                ) : (
                  diffLine.content
                )}
              </span>
              <button
                type="button"
                title={t('diffComments.commentTitle')}
                onClick={() => {
                  const ln = diffLine.lineNum;
                  setOpenCommentLine(openCommentLine === ln ? null : ln);
                  setCommentDraft(comments[ln] ?? '');
                }}
                className="flex-shrink-0 self-center px-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
              >
                <MessageSquare className="h-3 w-3" />
                {comments[diffLine.lineNum] && <span className="ml-0.5 align-middle text-[10px]">●</span>}
              </button>
            </div>
            {openCommentLine === diffLine.lineNum && (
              <div className="flex gap-2 border-l-2 border-blue-300 bg-blue-50/50 px-2 py-1.5 dark:border-blue-700 dark:bg-blue-950/20">
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder={t('diffComments.placeholder')}
                  className="flex-1 resize-none rounded border border-gray-300 bg-white px-2 py-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
                  rows={2}
                />
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setComment(diffLine.lineNum, commentDraft);
                      setOpenCommentLine(null);
                    }}
                    className="rounded bg-primary px-2 py-0.5 text-[10px] text-white hover:bg-primary/90"
                  >
                    {t('diffComments.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComment(diffLine.lineNum, '');
                      setOpenCommentLine(null);
                    }}
                    className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {t('diffComments.delete')}
                  </button>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <DiffLineComments filePath={filePath} commentsByLine={comments} />
    </div>
  );
};
