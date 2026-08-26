# Sci-Download For Zotero

[![Zotero 7+](https://img.shields.io/badge/Zotero-7+-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Version](https://img.shields.io/github/v/release/your-username/zotero-scidownload?style=flat-square)](https://github.com/your-username/zotero-scidownload/releases)

**Sci-Download** 是一个 Zotero 7+ 插件，允许你通过 Sci-Hub 镜像站手动输入 DOI 来搜索并下载 PDF。

## 功能

- 🔍 **输入 DOI 搜索下载** — 手动输入 DOI，从 Sci-Hub 镜像站搜索并下载 PDF
- 📂 **自定义目标分类** — 选择下载的 PDF 归入哪个分类（如不同课题分类）
- 🌐 **多镜像支持** — 内置多个 Sci-Hub 镜像站，自动切换，可自定义添加
- 🔄 **还原默认站点** — 一键恢复默认 Sci-Hub 镜像站列表
- 🌗 **暗色模式** — 自动适配 Zotero 主题
- 🌍 **多语言** — 支持中文和英文
- 📊 **下载进度** — 实时显示下载进度条和状态文字

## 安装

1. 下载 [最新版插件](https://github.com/your-username/zotero-scidownload/releases/latest/download/sci-download.xpi)
2. 在 Zotero 中打开 **工具 → 附加组件**
3. 将下载的 `.xpi` 文件拖入附加组件窗口
4. 重启 Zotero

## 使用

### 工具栏按钮

安装后，在 Zotero 文库工具栏（搜索框左侧）会出现一个下载按钮 ![](addon/content/icons/download.svg)。

### 搜索并下载

1. 点击工具栏按钮，打开下载面板
2. 输入 DOI
3. 选择目标分类（可选，默认归入"我的文库"）
4. 点击 **搜索并下载**
5. 等待进度条完成

### 自定义镜像站

- 在下载面板的"Sci-Hub 镜像站点"文本框中编辑
- 每行一个镜像站地址
- 点击 **还原默认** 恢复内置站点列表

### 科研通

面板右下角点击 **科研通 →** 可打开 [tool.yovisun.com/scihub](https://tool.yovisun.com/scihub/) 查询可用镜像站。

## 执行流程

```
输入 DOI → CrossRef 查元数据 → 遍历 Sci-Hub 镜像站 → 找到 PDF 直链
  → 全文库搜索 DOI
      ├─ 找到且在所选分类内 → 直接挂 PDF
      ├─ 找到但不在所选分类 → 新建条目 → 归入选定分类 → 挂 PDF
      └─ 没找到 → 新建条目 → 归入选定分类 → 挂 PDF
```

## 常见问题

- **缺少 DOI 的条目无法通过此插件下载**
- **已关联附件的条目不会重复下载**
- **选择的分类不存在时，条目会归入"我的文库"**

## 许可

AGPL-3.0-or-later

## 致谢

- 参考了 [zotero-scipdf](https://github.com/syt2/zotero-scipdf) 的 Sci-Hub 抓取逻辑
- 使用 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建