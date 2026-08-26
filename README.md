# Sci-Download For Zotero

[![Zotero 7+](https://img.shields.io/badge/Zotero-7+-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Version](https://img.shields.io/github/v/release/chen7447/sci-download-for-zotero?style=flat-square)](https://github.com/chen7447/sci-download-for-zotero/releases)
[![License](https://img.shields.io/github/license/chen7447/sci-download-for-zotero?style=flat-square)](LICENSE)

**Sci-Download** 是一个 Zotero 7+ 插件，通过 Sci-Hub 镜像站按 DOI 搜索并下载论文 PDF，自动提取元数据并归档到你的 Zotero 文库。

当前正式版：**v1.3.1**

## 功能一览

- 🔍 **DOI 搜索下载** — 输入 DOI，自动从 Sci-Hub 镜像站搜索并下载 PDF
- 🧠 **智能提取文献信息** — 支持输入 **DOI / PMID / 标题**，自动从 CrossRef、PubMed 提取标题、作者、期刊、年份等信息并填入表单
- 📚 **目标分类归档** — 选择下载的 PDF 归入哪个分类（含层级分类下拉框），选择会记忆
- 🔁 **智能去重** — 全文库按 DOI 检索，已存在的条目直接复用附加 PDF，不重复创建
- 🪞 **多镜像站支持** — 内置 10 个 Sci-Hub 镜像站，自动逐个尝试、实时显示每个站点的成败状态
- 🎯 **镜像站优先级** — 可给镜像站设置访问优先级，优先尝试高优先级站点
- ➕ **镜像站管理** — 支持添加、删除（用户自加的站点）、一键还原默认
- 🆕 **默认镜像自动合并** — 升级插件后自动合并新增的默认镜像站，无需手动重置
- 🧭 **PDF 阅读器按钮** — 在 PDF 阅读器工具栏一键下载当前条目的 PDF（自动读取当前条目 DOI）
- 📥 **下载进度** — 实时进度条与状态文字（CrossRef → Sci-Hub → 下载）
- 🌙 **暗色模式** — 自动适配 Zotero 主窗口明暗主题
- 🌐 **多语言** — 支持中文（zh-CN）和英文（en-US）

## 安装

1. 下载[最新版插件](https://github.com/chen7447/sci-download-for-zotero/releases/latest)（`.xpi` 文件）
2. 在 Zotero 中打开 **工具 → 附加组件**
3. 点击齿轮图标 → **Install Add-on From File…**，选择下载的 `.xpi` 文件
4. 重启 Zotero

> 需要 Zotero 7 及以上版本。

## 使用

### 入口 1：文库工具栏按钮

安装后，在 Zotero 文库工具栏（搜索框左侧）会出现一个[下载按钮](https://github.com/chen7447/sci-download-for-zotero/blob/master/addon/content/icons/download.svg)。点击即可打开下载面板。

### 入口 2：PDF 阅读器按钮

在任意 PDF 阅读器界面，工具栏会显示一个[下载按钮](https://github.com/chen7447/sci-download-for-zotero/blob/master/addon/content/icons/download.svg)。点击后自动带出当前条目已有的 DOI，直接开始搜索下载，方便边读边补。

### 智能提取文献信息

面板顶部的智能提取输入框支持三种输入方式，自动识别并填充其他字段：

| 输入类型 | 示例 | 数据来源 |
| --- | --- | --- |
| DOI | `10.1038/s41586-020-2649-2` | CrossRef |
| PMID | `32641826` | PubMed |
| 标题 | `A new fossil from the Jurassic` | CrossRef 文献检索 |

提取成功后，**标题** 和 **信息**（期刊 · 年份 · 作者）会自动填充，DOI 也会自动补全。

### 搜索并下载

1. 点击工具栏按钮打开下载面板
2. 输入或智能提取 DOI
3. 选择目标分类（可选，默认归入「我的文库」）
4. 点击 **搜索并下载**
5. 等待进度条完成

下载过程中会按优先级依次尝试各镜像站，并在镜像站列表中实时标注 `[✓]` 成功 / `[✗]` 失败。

### 镜像站管理

- **优先级列**（＋ 按钮）：点击为镜像站设置优先级，数值越小越先访问；再次点击取消优先级
- **地址列**：每行一个镜像站地址，可直接编辑；用户自行添加的站点可点击 `−` 删除（内置站点不可删）
- **状态列**：下载时实时显示该站点的成败状态
- **还原默认**：一键恢复内置镜像站列表

### 科研通

面板底部 **科研通 →** 链接可打开 [tool.yovisun.com/scihub](https://tool.yovisun.com/scihub/) 查询当前可用的 Sci-Hub 镜像站。

### 如何查找 DOI

点击 DOI 输入框旁的 `?` 按钮可查看查找 DOI 的帮助说明。

## 执行流程

```
输入 DOI → 自动剥离 https://doi.org/ 前缀 → 格式校验
  → CrossRef 查询元数据（标题/作者/期刊/年份/卷/期/页码/出版社）
  → 按优先级遍历 Sci-Hub 镜像站
       ├─ 找到 PDF 直链
       └─ 全文库按 DOI 检索
            ├─ 找到且已在所选分类内 → 直接附加 PDF 到该条目
            ├─ 找到但不在所选分类 → 新建条目 → 附加 PDF
            └─ 未找到 → 新建条目（journalArticle，自动填充元数据）→ 附加 PDF
```

## 常见问题

- **缺少 DOI 的条目无法通过此插件下载**
- **已关联附件的条目不会重复下载**（按 DOI 去重，直接复用现有条目）
- **选择的分类不存在时，条目会归入「我的文库」**
- **镜像站状态显示 `[✗]`** — 该站点本次未能找到 PDF，插件会自动尝试下一个镜像站
- **2021 年后的新文章在 Sci-Hub 上往往缺失**，请知悉

## 许可

[AGPL-3.0-or-later](LICENSE)

## 致谢

- 参考了 [zotero-scipdf](https://github.com/syt2/zotero-scipdf) 的 Sci-Hub 抓取逻辑
- 使用 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建
