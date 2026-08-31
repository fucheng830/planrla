import React, { useMemo } from 'react';
import { CheckCircle2, ChevronsUpDown, Circle, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Shimmer,
} from '../../../../shared/view/ui';
import { usePermission } from '../../../../contexts/PermissionContext';
import { parsePlanSteps, type PlanStep } from '../utils/planSteps';

import { MarkdownContent } from './ContentRenderers';

interface PlanDisplayProps {
  title: string;
  content: string;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  showRawParameters?: boolean;
  rawContent?: string;
  toolName: string;
  toolId?: string;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({
  title,
  content,
  defaultOpen = false,
  isStreaming = false,
  showRawParameters = false,
  rawContent,
  toolName: _toolName,
}) => {
  const { t } = useTranslation('chat');
  const permissionCtx = usePermission();

  const pendingRequest = permissionCtx?.pendingPermissionRequests.find(
    (r) => r.toolName === 'ExitPlanMode' || r.toolName === 'exit_plan_mode'
  );

  const handleBuild = () => {
    if (pendingRequest && permissionCtx) {
      permissionCtx.handlePermissionDecision(pendingRequest.requestId, { allow: true });
    }
  };

  const handleRevise = () => {
    if (pendingRequest && permissionCtx) {
      permissionCtx.handlePermissionDecision(pendingRequest.requestId, {
        allow: false,
        message: 'User asked to revise the plan',
      });
    }
  };

  const steps = useMemo(() => parsePlanSteps(content), [content]);

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card className="my-1 flex flex-col shadow-none">
        {/* Header — always visible */}
        <CardHeader className="flex flex-row items-start justify-between space-y-0 px-4 pb-0 pt-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">
              {isStreaming ? <Shimmer>{title}</Shimmer> : title}
            </CardTitle>
          </div>
          <CollapsibleTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
            <ChevronsUpDown className="h-4 w-4" />
            <span className="sr-only">{t('plan.toggle')}</span>
          </CollapsibleTrigger>
        </CardHeader>

        {/* Collapsible content */}
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-3">
            {content ? (
              steps ? (
                <ol className="space-y-2">
                  {steps.map((step: PlanStep, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {step.checked === true ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      ) : step.checked === false ? (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                          {i + 1}
                        </span>
                      )}
                      <span className="flex-1 text-foreground">
                        <MarkdownContent
                          content={step.text}
                          className="prose prose-sm max-w-none dark:prose-invert [&>:last-child]:mb-0"
                        />
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <MarkdownContent
                  content={content}
                  className="prose prose-sm max-w-none dark:prose-invert"
                />
              )
            ) : isStreaming ? (
              <div className="py-2">
                <Shimmer>{t('plan.generating')}</Shimmer>
              </div>
            ) : null}

            {showRawParameters && rawContent && (
              <Collapsible className="mt-3">
                <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                  <svg
                    className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {t('tools.rawParams')}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded border border-border/40 bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                    {rawContent}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </CollapsibleContent>

        {/* Footer — always visible when permission is pending */}
        {pendingRequest && (
          <CardFooter className="justify-end gap-2 border-t border-border/40 px-4 pb-3 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevise}
              className="text-muted-foreground"
            >
              {t('plan.revise')}
            </Button>
            <Button size="sm" onClick={handleBuild}>
              {t('plan.build')}{' '}
              <kbd className="ml-1 rounded bg-primary-foreground/20 px-1 py-0.5 font-mono text-[10px]">
                ⌘↩
              </kbd>
            </Button>
          </CardFooter>
        )}
      </Card>
    </Collapsible>
  );
};
