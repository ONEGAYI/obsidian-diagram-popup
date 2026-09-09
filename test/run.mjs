// 诊断/回归 harness：在 jsdom 中加载真实 src/main.ts（obsidian 模块替换为 stub），
// 模拟「打开含图表的 md → 图表被其他位置修改后重渲染 → popup 按钮是否恢复」。
//
// 用法：npm test （或 node test/run.mjs）
// 退出码 1 = 存在 FAIL（红灯），0 = 全绿。
//
// 场景矩阵（对应真实工作区状态 × 模式）：
//   S0 基线：打开 md 后按钮出现（源码模式）——harness 自检，必须绿
//   S1/S2 外部程序修改文件，图表视图为活动视图（源码/阅读模式）
//   S3 双分栏：v1(阅读) 重渲染，活动视图=v2(源码) —— 跨模式面板
//   S4 双分栏：v1(源码) 重渲染，活动视图=v2(源码)
//   S5 双分栏：v2(源码,活动) 自身重渲染 —— 第二个面板无 observer
//   S6 中途打开过无图表笔记后，v1 重渲染 —— observer 被误释放/误绑定
//   S7 跨模式弹窗冒烟：阅读目标弹窗在源码视图活动时仍正确定位图表

import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. jsdom 全局环境 + Obsidian 的 DOM 原型扩展
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.MutationObserver = window.MutationObserver;

// Obsidian 给 Node 补的 doc / win 访问器。
// 对 Document 自身，ownerDocument 为 null：生产代码存在 `_doc.doc.createElement`
// 调用且在 Obsidian 中工作正常，说明 Obsidian 的 doc 对 Document 返回自身
Object.defineProperty(window.Node.prototype, 'doc', {
    get() { return this.ownerDocument ?? this; },
    configurable: true,
});
Object.defineProperty(window.Node.prototype, 'win', {
    get() {
        if (this.ownerDocument) return this.ownerDocument.defaultView;
        return this.defaultView ?? window;
    },
    configurable: true,
});

// Obsidian 给 Element 补的样式便捷方法。
// 打在 Element 而非 HTMLElement：adjust 路径会对 <svg>（SVGElement，不继承
// HTMLElement）调用 getCssPropertyValue/setCssStyles，生产环境该路径工作正常，
// 说明 Obsidian 运行时的实现位于 Element 层级。
window.Element.prototype.setCssStyles = function (styles) {
    for (const [k, v] of Object.entries(styles)) {
        this.style.setProperty(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v));
    }
};
window.Element.prototype.getCssPropertyValue = function (prop) {
    return window.getComputedStyle(this).getPropertyValue(prop);
};

// Obsidian 运行时 polyfill 了 String.prototype.contains（旧 ES6 草案名，等价 includes）。
// 依据：生产 dist 中存在 .contains("|") 调用，而插件的初始路径在 Obsidian 中正常工作，
// 说明该非标准 API 在 Obsidian 环境可用。两个 realm（Node 与 jsdom window）都补上。
if (!globalThis.String.prototype.contains) {
    globalThis.String.prototype.contains = function (s) { return this.indexOf(String(s)) !== -1; };
}
if (!window.String.prototype.contains) {
    window.String.prototype.contains = function (s) { return this.indexOf(String(s)) !== -1; };
}

// ---------------------------------------------------------------------------
// 2. 用 esbuild 打包真实插件代码（alias 替换 obsidian → stub）
// ---------------------------------------------------------------------------
const bundlePath = path.join(__dirname, '.tmp', 'plugin.bundle.mjs');
await esbuild.build({
    entryPoints: [path.join(root, 'src', 'main.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: bundlePath,
    alias: { obsidian: path.join(__dirname, 'stubs', 'obsidian.mjs') },
    logLevel: 'silent',
});
const { default: MermaidPopupPlugin } = await import(pathToFileURL(bundlePath).href);

// ---------------------------------------------------------------------------
// 3. fake app / view / 图表 DOM
// ---------------------------------------------------------------------------
function makeApp() {
    const handlers = {};
    const leaves = [];
    const workspace = {
        activeView: null,
        leaves,
        on(evt, cb) { (handlers[evt] ??= []).push(cb); return { evt, cb }; },
        trigger(evt) { for (const cb of handlers[evt] ?? []) cb(); },
        // 插件调用 getActiveViewOfType(MarkdownView)；fake 忽略类型直接返回 activeView
        getActiveViewOfType() { return workspace.activeView; },
        // 插件遍历 markdown 叶子同步所有视图（含 popout 同理）
        getLeavesOfType(type) { return leaves.filter((l) => l.viewType === type); },
    };
    return { workspace };
}

function makeView(mode, name = 'doc.md') {
    const containerEl = document.createElement('div');
    containerEl.className = mode === 'preview'
        ? 'markdown-reading-view'
        : 'markdown-source-view mod-cm6';
    const contentEl = document.createElement('div');
    containerEl.appendChild(contentEl);
    return {
        mode,
        file: { name },
        containerEl,
        contentEl,
        getMode: () => mode,
    };
}

// 在工作区打开一个 markdown 叶子并设为活动视图。
// 真实 Obsidian 中打开视图的容器必在 DOM 内（插件的 isConnected 检查依赖这一点）
function openLeaf(app, view) {
    document.body.appendChild(view.containerEl);
    app.workspace.leaves.push({ viewType: 'markdown', view });
    app.workspace.activeView = view;
}

// 模拟一个 mermaid 渲染块：wrapper(parent) > .mermaid > svg
// svg 尺寸故意超出容器与 DiagramHeightMax(600)，使尺寸调整分支可被观察
function addDiagramBlock(view) {
    const parent = document.createElement('div');
    parent.style.width = '600px';
    const mermaid = document.createElement('div');
    mermaid.className = 'mermaid';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '900');
    svg.setAttribute('height', '1200');
    svg.style.width = '900px';
    svg.style.height = '1200px';
    mermaid.appendChild(svg);
    parent.appendChild(mermaid);
    view.contentEl.appendChild(parent);
    return parent;
}

// 模拟「其他位置修改 diagram 后」该视图内图表的重渲染：整块父节点被替换
async function rerenderDiagram(view, oldParent) {
    const fresh = addDiagramBlock(view);
    oldParent.remove();
    await new Promise((r) => setTimeout(r, 0)); // 等待 MutationObserver 回调派发
    return fresh;
}

function buttonIn(parent, mode) {
    const cls = mode === 'preview'
        ? 'mermaid-popup-button-reading'
        : 'mermaid-popup-button';
    return parent.querySelector('.' + cls);
}

async function makePlugin() {
    const app = makeApp();
    const plugin = new MermaidPopupPlugin(app, {
        name: 'diagram-popup-test',
        version: '0.0.0',
    });
    await plugin.onload();
    return { app, plugin };
}

// ---------------------------------------------------------------------------
// 4. 场景
// ---------------------------------------------------------------------------
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const results = [];
async function scenario(id, desc, fn) {
    try {
        await fn();
        results.push({ id, desc, ok: true, msg: '' });
    } catch (e) {
        results.push({ id, desc, ok: false, msg: e.message });
    }
}

// S0 基线：打开 md 后按钮出现（源码/实时预览模式）。此场景必须绿，否则 harness 本身有问题。
await scenario('S0', '基线：打开 md 后按钮出现（源码模式）', async () => {
    const { app } = await makePlugin();
    const v = makeView('source');
    openLeaf(app, v);
    const blk = addDiagramBlock(v);
    app.workspace.trigger('layout-change');
    assert(buttonIn(blk, 'source'), '初始按钮未出现');
});

// S1 外部修改（同视图重渲染，源码模式）：外部程序改文件 → 该视图图表重渲染
await scenario('S1', '外部修改后重渲染，按钮恢复（源码模式，活动视图=本视图）', async () => {
    const { app } = await makePlugin();
    const v = makeView('source');
    openLeaf(app, v);
    const blk = addDiagramBlock(v);
    app.workspace.trigger('layout-change');
    assert(buttonIn(blk, 'source'), '初始按钮未出现');
    const fresh = await rerenderDiagram(v, blk);
    assert(buttonIn(fresh, 'source'), '重渲染后按钮未恢复');
});

// S2 外部修改（同视图重渲染，阅读模式）
await scenario('S2', '外部修改后重渲染，按钮恢复（阅读模式，活动视图=本视图）', async () => {
    const { app } = await makePlugin();
    const v = makeView('preview');
    openLeaf(app, v);
    const blk = addDiagramBlock(v);
    app.workspace.trigger('layout-change');
    assert(buttonIn(blk, 'preview'), '初始按钮未出现');
    const fresh = await rerenderDiagram(v, blk);
    assert(buttonIn(fresh, 'preview'), '重渲染后按钮未恢复');
});

// 双分栏公共搭建：v1 先打开，再分栏 v2 并激活
async function twoPaneSetup(mode1, mode2) {
    const { app, plugin } = await makePlugin();
    const v1 = makeView(mode1, 'doc.md');
    openLeaf(app, v1);
    const blk1 = addDiagramBlock(v1);
    app.workspace.trigger('layout-change'); // 打开 v1
    const v2 = makeView(mode2, 'doc.md');
    openLeaf(app, v2);
    const blk2 = addDiagramBlock(v2);
    app.workspace.trigger('layout-change'); // 创建分栏 → v2 激活
    return { app, plugin, v1, v2, blk1, blk2 };
}

// S3 双分栏：v1 阅读模式，v2 源码模式激活（用户在 v2 编辑 diagram）→ v1 重渲染
await scenario('S3', '双分栏：v1(阅读) 重渲染，活动视图=v2(源码)', async () => {
    const { app, v1, blk1, v2, blk2 } = await twoPaneSetup('preview', 'source');
    assert(buttonIn(blk1, 'preview'), 'v1 初始按钮未出现');
    assert(buttonIn(blk2, 'source'), 'v2 初始按钮未出现');
    const fresh = await rerenderDiagram(v1, blk1);
    assert(buttonIn(fresh, 'preview'), 'v1 重渲染后按钮未恢复');
});

// S4 双分栏：两个分栏同为源码模式 → v1 重渲染
await scenario('S4', '双分栏：v1(源码) 重渲染，活动视图=v2(源码)', async () => {
    const { v1, blk1 } = await twoPaneSetup('source', 'source');
    const fresh = await rerenderDiagram(v1, blk1);
    assert(buttonIn(fresh, 'source'), 'v1 重渲染后按钮未恢复');
});

// S5 双分栏：编辑所在的 v2 自身重渲染（用户改完代码后点击别处，widget 重建）
await scenario('S5', '双分栏：v2(源码,活动) 自身重渲染', async () => {
    const { v2, blk2 } = await twoPaneSetup('source', 'source');
    const fresh = await rerenderDiagram(v2, blk2);
    assert(buttonIn(fresh, 'source'), 'v2 自身重渲染后按钮未恢复');
});

// S6 中途打开过无图表笔记：layout-change 时活动视图无图表 → 旧实现会误释放/误绑定
// observer；之后切回 v1（真实 Obsidian 中纯焦点切换不触发 layout-change）→ v1 重渲染
await scenario('S6', '中途打开无图表笔记后，v1 重渲染按钮恢复', async () => {
    const { app } = await makePlugin();
    const v1 = makeView('source');
    openLeaf(app, v1);
    const blk = addDiagramBlock(v1);
    app.workspace.trigger('layout-change');
    assert(buttonIn(blk, 'source'), '初始按钮未出现');
    const other = makeView('source', '无图表.md'); // 不含 diagram
    openLeaf(app, other);
    app.workspace.trigger('layout-change');
    app.workspace.activeView = v1; // 焦点切回，不触发 layout-change
    const fresh = await rerenderDiagram(v1, blk);
    assert(buttonIn(fresh, 'source'), '重渲染后按钮未恢复');
});

// S7 跨模式弹窗冒烟：阅读目标的弹窗在源码视图活动时，克隆体仍按阅读模式定位按钮与图表
// （覆盖 getMarkByElement 的 data-diagram-popup-mark 回溯路径，波及弹窗尺寸与下载导出）
await scenario('S7', '跨模式弹窗冒烟：阅读目标弹窗在源码视图活动时仍正确', async () => {
    const { plugin, v1, blk1 } = await twoPaneSetup('preview', 'source');
    plugin.openPopup(blk1);
    const overlay = document.body.querySelector('.popup-overlay');
    assert(overlay, '弹窗 overlay 未挂载');
    const clone = document.body.querySelector('.popup-content');
    assert(clone, '弹窗克隆体未挂载');
    assert(clone.dataset.diagramPopupMark === 'reading', '克隆体未携带 reading 模式标记');
    const btnInClone = clone.querySelector('.mermaid-popup-button-reading');
    assert(btnInClone, '克隆体内未按阅读模式 class 找到按钮');
    assert(btnInClone.style.display === 'none', '克隆体内按钮未隐藏');
    const coreDeep = plugin.getCoreDeepElement(clone);
    assert(coreDeep && coreDeep.tagName.toLowerCase() === 'svg',
        '克隆体内未能定位图表 svg（弹窗尺寸/下载导出将失败）');
    document.body.removeChild(overlay); // 清理共享 body
});

// ---------------------------------------------------------------------------
// 5. 汇报
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('=== 诊断 harness 结果 ===');
for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.id} ${r.desc}${r.msg ? `\n       └─ ${r.msg}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
    console.log(`红灯场景：${failed.map((f) => f.id).join(', ')}`);
    process.exit(1);
}
