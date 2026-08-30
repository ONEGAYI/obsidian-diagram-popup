# Changelog

本文件记录本 fork 相对上游（[gitcpy/obsidian-diagram-popup](https://github.com/gitcpy/obsidian-diagram-popup)）的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.3.0] - 2026-08-30

拉入上游 PR #14（弹窗下载图表），并修复对该 PR 三轮代码审查发现的问题。

### 新功能

- 弹窗控制栏新增下载按钮，支持把图表导出为 SVG 或 PNG（1x–4x 倍率可选），格式与倍率选择使用 Obsidian 原生 Modal（#14）

### Bug 修复

- 修复图表位于 popout 独立窗口时点击下载抛异常的问题：原实现硬编码 `window`/`document`，跨窗口调用 `getComputedStyle` 会抛 "Illegal invocation"；现统一使用元素所属文档（`ele.win`/`ele.doc`，与插件其余部分一致）
- 修复导出尺寸被弹窗缩放污染的问题：弹窗对内容整体施加 `transform: scale()`，原实现经 `getBoundingClientRect` 取到缩放后的视觉尺寸；现按 viewBox → px 形式 width/height 属性 → computed style → rect 四级回退取原始尺寸
- 修复 PlantUML 类无 viewBox 图表的导出裁剪：这类图会被插件本体以 inline style 缩小，属性分支保证导出使用图原始尺寸而非缩小值
- SVG 转 PNG 加载失败（`img.onerror`）与零尺寸导出补充 Notice 提示，不再静默失败或假报成功

### 其他改进

- 导出前清除克隆节点上弹窗强加的 inline 尺寸样式（width/height/max-width），导出文件不依赖弹窗当前状态
- canvas 超 Chromium 16384px 边长上限时自动降档，图本身超限时钳制为分数倍率，均有提示
- 含 foreignObject（mermaid htmlLabels）的图导出 PNG 时提示外部字体/图片可能缺失，建议改用 SVG
- img 路径导出补画白底；跨域图片导出失败转为 Notice 提示
- 选择 SVG 格式时禁用倍率下拉（倍率仅对 PNG 有效）

<!-- 变更链接 -->
[0.3.0]: https://github.com/ONEGAYI/obsidian-diagram-popup/compare/0.2.69...0.3.0
