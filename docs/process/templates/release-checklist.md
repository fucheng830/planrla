# 发版清单(单轨,主题化)

> 复制本文件为 `releases/v0.x.x.md` 的执行依据,逐项勾。
> 商业预检(License / 签名 / 更新源)见 `docs/commercial/RELEASE_CHECKLIST.md`。

**版本**:vX.Y.Z(填)  **主题**:<填>  **含需求**:REQ-NNN, REQ-NNN(填)

## ① 就绪
- [ ] 本主题 BACKLOG 条目全部 `accepted`
- [ ] git 在 main 分支且工作区干净(`git status`)
- [ ] 预检过(`npm run typecheck && npm run build && git diff --check`)

## ② 版本号
- [ ] 定 minor(feat 主题)或 patch(fix/chore)
- [ ] `git ls-remote --tags origin` 确认 origin 无同号(只认 origin,不认本地 tag)

## ③ release-it(单轨:bump package.json + tag + CHANGELOG + GitHub Release)
- [ ] `npx release-it`(交互确认)或 `npx release-it minor --ci` / `patch --ci`
- [ ] 确认:package.json version 对齐 tag、tag v0.x.x 已 push、GitHub Release 已建
- [ ] (不应有任何 npm publish 动作 —— `.release-it.json` 的 npm 块已移除)

## ④ EBUSY 防护
- [ ] Planrla 桌面应用未运行
- [ ] `rm -rf release/win-unpacked release/win-unpacked.tmp`(如存在)

## ⑤ 打包(读 package.json 版本,无需 extraMetadata)
- [ ] `npm run build`
- [ ] `npx electron-builder --win nsis zip`
- [ ] 产物:`release/planrla-<ver>-x64.exe` + `.zip`

## ⑥ 上传(后台,大文件 5-10 分钟)
- [ ] `gh release upload v0.x.x release/planrla-<ver>-x64.{exe,zip} --clobber`

## ⑦ 记录
- [ ] 写 `docs/process/releases/v0.x.x.md`(版本+主题+需求+验收摘要+产物链接+已知问题+回退方案+下版本预告)
- [ ] BACKLOG:本主题条目 `accepted → released`,填版本号
- [ ] (可选)push 触发 Cloudflare 重建 landing `latest.json`
