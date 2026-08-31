import React from 'react';
import { MessageSquare, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useComposer } from '../../../../contexts/ComposerContext';

interface DiffLineCommentsProps {
  filePath: string;
  commentsByLine: Record<number, string>;
}

export const DiffLineComments: React.FC<DiffLineCommentsProps> = ({ filePath, commentsByLine }) => {
  const { t } = useTranslation('chat');
  const composer = useComposer();
  const [copied, setCopied] = React.useState(false);

  const entries = Object.entries(commentsByLine).filter(([, text]) => text && text.trim());
  const commentCount = entries.length;

  const handleCopyAsMessage = () => {
    // commentsByLine 的 key 是 DiffLine.lineNum(真实文件 1-based 行号,见
    // messageTransforms.ts calculateDiff),直接用作 :L# 标签。
    const text = entries
      .map(([lineNum, text]) => `${filePath}:L${lineNum}\n> ${text.trim()}`)
      .join('\n');
    composer?.insertText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!composer) return null;

  return (
    <div className="flex items-center gap-2 border-t border-gray-200/60 px-2.5 py-1 dark:border-gray-700/50">
      {commentCount > 0 && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MessageSquare className="h-3 w-3" />
          {commentCount}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopyAsMessage}
        disabled={commentCount === 0}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        {copied ? t('diffComments.copied') : t('diffComments.copyAsMessage')}
      </button>
    </div>
  );
};
