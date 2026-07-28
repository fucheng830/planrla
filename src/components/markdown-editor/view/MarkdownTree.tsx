// src/components/markdown-editor/view/MarkdownTree.tsx
//
// REQ-047 — 递归渲染 .md 文件树。点击 file 调 onSelect(path)。

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';

import type { MdFileNode } from '../types';

interface MarkdownTreeProps {
  nodes: MdFileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function MarkdownTree({ nodes, selectedPath, onSelect }: MarkdownTreeProps) {
  if (nodes.length === 0) return null;
  return (
    <ul className="space-y-0.5" role="tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </ul>
  );
}

interface TreeItemProps {
  node: MdFileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}

function TreeItem({ node, selectedPath, onSelect, depth }: TreeItemProps) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.type === 'dir') {
    return (
      <li role="treeitem" aria-expanded={open}>
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          style={pad}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
          <Folder className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <ul className="space-y-0.5">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <li role="treeitem" aria-selected={isSelected}>
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs transition-colors ${
          isSelected
            ? 'bg-primary/15 text-primary font-medium'
            : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground'
        }`}
        style={pad}
        onClick={() => onSelect(node.path)}
      >
        <FileText className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
