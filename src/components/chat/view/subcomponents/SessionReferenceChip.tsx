import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { SessionReference } from '../../utils/sessionReferenceFormat';

interface SessionReferenceChipProps {
  reference: SessionReference;
  onRemove: (id: string) => void;
}

export default function SessionReferenceChip({
  reference,
  onRemove,
}: SessionReferenceChipProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 text-xs">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="truncate">🔗 {t('references.queryableFrom', { defaultValue: '可查:「{{title}}」', title: reference.title })}</span>
        <span className="flex-shrink-0 text-muted-foreground">(id={reference.sessionId.slice(0, 8)})</span>
        <button type="button" onClick={() => onRemove(reference.id)} className="rounded p-0.5 hover:bg-accent"><X className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
