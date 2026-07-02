# 验收清单(模板)

> 本模板由 writing-plans 在 plan 末尾生成。验收时逐项勾选 + 填结论。
> 复制本节到 plan 末尾,替换 `<...>` 占位。

**对应需求**:REQ-NNN
**对应 spec**:docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md

## 预检门(全过才继续)
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 成功
- [ ] `git diff --check` 无空白错误

## 功能门(对照 spec 验收标准,逐项;勿漏)
- [ ] 验收标准 1:<从 spec 复制>
- [ ] 验收标准 2:<从 spec 复制>
- [ ] ...

## 回归门(抽查改动影响的既有功能)
- [ ] 抽查点 1:<填>
- [ ] 抽查点 2:<填>

## 验收结论
- **结论**:通过 / 不通过
- **备注**:<通过则简述;不通过则列问题>
- **验收人**:Archie
- **日期**:YYYY-MM-DD

> 不通过 → BACKLOG 退回 `doing`,在 plan 此处列问题,修复后重验。
> 通过 → BACKLOG 置 `accepted`,在此处写一行结论。
