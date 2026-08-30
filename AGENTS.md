# obsidian-diagram-popup（fork）

上游 [gitcpy/obsidian-diagram-popup](https://github.com/gitcpy/obsidian-diagram-popup) 的个人 fork：在上游 main 之上叠加已验收的功能与修复。

## 分支模型

- `main`：跟随上游 main，只接收已验收的合并提交
- `feat/download-diagram`：上游 PR #14（弹窗下载图表）+ 本地三轮审查修复，已随 0.3.0 合入 main
- 上游原仓库的只读参照副本位于 `D:\CODE\Project\_ForExplore\obsidian-diagram-popup`（评审 PR 时用，勿在其上开发）

## 构建

```bash
npm install
npm run build   # Rollup + tsc，产物 dist/（main.js + manifest.json + styles.css），类型检查随构建执行
```

## 维护约定

- 同步上游：`git fetch upstream` 后按需 merge/rebase 到 main（remote `upstream` 已配置）
- 修改走功能分支，经子代理审查循环验证后合入；提交信息用中文
- 发布：bump `manifest.json` 版本号 → 更新 `CHANGELOG.md`（Keep a CHANGELOG 格式 + 底部 compare 链接）→ 合入 main → 打纯数字 tag（如 `0.3.0`）→ `gh release create` → **上传 `dist/main.js`、`manifest.json`、`styles.css` 三件套作为 release 附件**（`gh release upload <tag> dist/main.js manifest.json styles.css`，Obsidian 插件惯例，供手动安装与 BRAT 类工具引用）
- 部署：构建后将 `dist/main.js`、`manifest.json`、`styles.css` 三件套覆盖到各 vault 的 `.obsidian/plugins/mermaid-popup/`
