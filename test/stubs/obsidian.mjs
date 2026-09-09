// obsidian 模块的最小 stub：仅覆盖 src/main.ts 与 src/settings.ts 实际用到的 API 面。
// 测试通过 esbuild alias 把 'obsidian' 解析到本文件。
// 注意：刻意不在这里做 instanceof 判定 —— fake workspace.getActiveViewOfType() 直接
// 忽略类型参数返回 activeView，避免「bundle 内外的类副本身份不一致」问题。

export class Plugin {
    constructor(app, manifest) {
        this.app = app;
        this.manifest = manifest;
    }
    registerEvent(ref) { (this._events ??= []).push(ref); }
    registerDomEvent(el, type, cb, opts) { el.addEventListener(type, cb, opts); }
    addSettingTab(_tab) { /* 测试不打开设置页 */ }
    async loadData() { return null; }
    async saveData(_data) { /* 空实现 */ }
}

export class MarkdownView { /* 仅作类型标记，测试中不被实例化 */ }

export class PluginSettingTab {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = globalThis.document.createElement('div');
    }
}

export class Modal {
    constructor(app) {
        this.app = app;
        this.containerEl = globalThis.document.createElement('div');
        this.contentEl = globalThis.document.createElement('div');
    }
    open() { /* 空实现 */ }
    close() { /* 空实现 */ }
}

export class Notice {
    static last = null;
    constructor(msg) { Notice.last = String(msg); }
}

export class Setting {
    setName() { return this; }
    setDesc() { return this; }
    addDropdown(_cb) { return this; }
    addButton(_cb) { return this; }
    setCta() { return this; }
    setButtonText() { return this; }
    onClick() { return this; }
    setDisabled() { return this; }
    setValue() { return this; }
    onChange() { return this; }
    addOption() { return this; }
    addSlider(_cb) { return this; }
    addText(_cb) { return this; }
    addToggle(_cb) { return this; }
}

export function setIcon(el, icon) {
    el.setAttribute('data-icon', String(icon));
}
