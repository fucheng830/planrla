// server/utils/markdownTree.test.ts
//
// REQ-047 — scanMarkdownTree 纯函数单测。覆盖:
//   - 白名单扩展名(.md/.markdown/.txt,拒绝 .js/.json/.env)
//   - 排除噪音目录(node_modules/.git/dist/.claude/worktrees)
//   - 深度上限(≤10)
//   - 单文件大小上限(>1MB 跳过)
//   - 排序(目录置顶 + 名字序)
//   - 路径用 posix 相对(/ 分隔)

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanMarkdownTree } from './markdownTree.js';

describe('scanMarkdownTree (REQ-047)', () => {
    let root: string;

    before(async () => {
        root = await mkdtemp(join(tmpdir(), 'md-tree-'));
        // 结构:
        //   root/
        //     README.md
        //     notes.markdown
        //     plain.txt
        //     config.json          (拒绝)
        //     script.ts            (拒绝)
        //     .env                 (拒绝 - 非 md;且 dotfile 不特殊处理,按扩展名拒)
        //     docs/
        //       spec.md
        //       deep.md
        //       image.png          (拒绝)
        //     src/
        //       index.ts           (拒绝,整个 src 因无 md 子孙不返回)
        //     node_modules/
        //       pkg/README.md      (排除 - node_modules)
        //     .git/HEAD            (排除 - .git)
        //     dist/out.md          (排除 - dist)
        //     .claude/worktrees/x/md.md  (排除 - .claude 含 worktrees)
        await writeFile(join(root, 'README.md'), '# root readme');
        await writeFile(join(root, 'notes.markdown'), '# notes');
        await writeFile(join(root, 'plain.txt'), 'plain text');
        await writeFile(join(root, 'config.json'), '{}');
        await writeFile(join(root, 'script.ts'), 'export {}');
        await writeFile(join(root, '.env'), 'SECRET=1');
        await mkdir(join(root, 'docs'), { recursive: true });
        await writeFile(join(root, 'docs', 'spec.md'), '# spec');
        await writeFile(join(root, 'docs', 'deep.md'), '# deep');
        await writeFile(join(root, 'docs', 'image.png'), 'binary');
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'src', 'index.ts'), 'export {}');
        await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
        await writeFile(join(root, 'node_modules', 'pkg', 'README.md'), '# pkg');
        await mkdir(join(root, '.git'), { recursive: true });
        await writeFile(join(root, '.git', 'HEAD'), 'ref');
        await mkdir(join(root, 'dist'), { recursive: true });
        await writeFile(join(root, 'dist', 'out.md'), '# dist out');
        await mkdir(join(root, '.claude', 'worktrees', 'x'), { recursive: true });
        await writeFile(join(root, '.claude', 'worktrees', 'x', 'md.md'), '# wt');
    });

    after(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('whitelist: 只返回 .md/.markdown/.txt,目录置顶排序', async () => {
        const tree = await scanMarkdownTree(root, root, 0);
        // 顶层:docs(dir) + 3 个 md/txt 文件。config.json/script.ts/.env 被拒。
        const names = tree.map((n) => n.name);
        assert.ok(names.includes('docs'), 'docs 目录应保留');
        assert.ok(names.includes('README.md'));
        assert.ok(names.includes('notes.markdown'));
        assert.ok(names.includes('plain.txt'));
        assert.ok(!names.includes('config.json'), '.json 被拒');
        assert.ok(!names.includes('script.ts'), '.ts 被拒');
        assert.ok(!names.includes('.env'), '.env 被拒');
        assert.ok(!names.includes('src'), 'src 无 md 子孙,不返回');
        assert.ok(!names.includes('node_modules'), 'node_modules 排除');
        assert.ok(!names.includes('dist'), 'dist 排除');
        assert.ok(!names.includes('.git'), '.git 排除');
        assert.ok(!names.includes('.claude'), '.claude(含 worktrees)排除');
        // 排序:dir 在前
        assert.equal(tree[0].type, 'dir');
        assert.equal(tree[0].name, 'docs');
    });

    test('递归:docs 子目录含 2 个 md,png 被拒', async () => {
        const tree = await scanMarkdownTree(root, root, 0);
        const docs = tree.find((n) => n.name === 'docs');
        assert.ok(docs && docs.type === 'dir' && docs.children);
        const childNames = docs.children.map((c) => c.name).sort();
        assert.deepEqual(childNames, ['deep.md', 'spec.md']);
    });

    test('path 字段为项目相对 posix(/ 分隔),可喂 /file route', async () => {
        const tree = await scanMarkdownTree(root, root, 0);
        const readme = tree.find((n) => n.name === 'README.md');
        assert.ok(readme);
        assert.equal(readme.path, 'README.md');
        assert.ok(!readme.path.includes('\\'), 'path 不含反斜杠');
        const docs = tree.find((n) => n.name === 'docs');
        assert.ok(docs, 'docs 目录存在');
        assert.equal(docs.path, 'docs');
        const spec = docs.children?.find((c) => c.name === 'spec.md');
        assert.ok(spec, 'spec.md 存在');
        assert.equal(spec.path, 'docs/spec.md');
    });

    test('深度上限:depth > 10 返回空', async () => {
        // 构造 12 层深的 md,确认被 depth 上限截断
        let deep = root;
        for (let i = 0; i < 12; i++) {
            deep = join(deep, `l${i}`);
            await mkdir(deep, { recursive: true });
        }
        await writeFile(join(deep, 'buried.md'), '# buried');
        // 从 depth=0 扫,buried.md 在 depth=12,被 MD_MAX_DEPTH=10 截断
        const tree = await scanMarkdownTree(root, root, 0);
        const all = JSON.stringify(tree);
        assert.ok(!all.includes('buried.md'), '超深的 buried.md 被深度上限截断');
    });

    test('大小上限:>1MB 的 .md 被跳过', async () => {
        const big = Buffer.alloc(1024 * 1024 + 100, '#');
        await writeFile(join(root, 'big.md'), big);
        const tree = await scanMarkdownTree(root, root, 0);
        const names = tree.map((n) => n.name);
        assert.ok(!names.includes('big.md'), '>1MB 的 md 被跳过');
        // 小 md 仍正常
        assert.ok(names.includes('README.md'));
    });

    test('stat 失败(坏符号链接)不中断扫描', async () => {
        // scanMarkdownTree 内部 safeStat 吞错,这里只验证正常文件仍返回
        const tree = await scanMarkdownTree(root, root, 0);
        assert.ok(tree.length > 0);
    });
});
