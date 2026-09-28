# Sci-Download For Zotero

[![Zotero 7+](https://img.shields.io/badge/Zotero-7+-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Version](https://img.shields.io/github/v/release/chen7447/sci-download-for-zotero?style=flat-square)](https://github.com/chen7447/sci-download-for-zotero/releases)
[![License](https://img.shields.io/github/license/chen7447/sci-download-for-zotero?style=flat-square)](LICENSE)

**Sci-Download** 是一个 Zotero 7+ 插件，通过 Sci-Hub 镜像站按 DOI 搜索并下载论文 PDF，自动提取元数据并归档到你的 Zotero 文库。

当前正式版：**v1.4.1**

## 功能一览

- 🔍 **DOI 搜索下载** — 输入 DOI，自动从 Sci-Hub 镜像站搜索并下载 PDF
- 🖱️ **条目右键批量下载** — 选中一个或多个条目，右键一键补全 PDF；条目没有 DOI 时自动按标题检索
- 🧠 **智能提取文献信息** — 支持输入 **DOI / PMID / 标题**，自动从 CrossRef、PubMed 提取标题、作者、期刊、年份等信息并填入表单
- 📚 **目标分类归档** — 选择下载的 PDF 归入哪个分类（含层级分类下拉框，支持群组文库的分类），选择会记忆
- 🔁 **智能去重** — 按 DOI 与 PDF 附件双重去重：目标位置已有条目则复用，条目已有 PDF 则跳过下载
- ⚡ **并发竞速下载** — 每轮同时尝试 3 个镜像站，最先返回有效 PDF 的站点胜出，其余自动中止
- 🎯 **粘性镜像 + 优先级** — 上次成功过的镜像站下次优先尝试；也可手动给镜像站设置长期优先级
- 🪞 **多镜像站支持** — 内置 10 个 Sci-Hub 镜像站，实时显示每个站点的成败状态
- ➕ **镜像站管理** — 支持添加、删除（用户自加的站点）、一键还原默认
- 🆕 **默认镜像自动合并** — 升级插件后自动合并新增的默认镜像站，无需手动重置
- 🧭 **PDF 阅读器按钮** — 在 PDF 阅读器工具栏一键下载当前条目的 PDF（自动读取 DOI；无 DOI 时按标题检索）
- 🛡️ **下载校验** — 候选 PDF 先经内容校验（`%PDF-` 文件头），验证码页/拦截页不会再被存成打不开的「PDF」
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
<img width="1742" height="138" alt="image" src="https://github.com/user-attachments/assets/506aaf87-adea-484d-b7ce-c9210f227169" />


### 入口 2：PDF 阅读器按钮

在任意 PDF 阅读器界面，工具栏会显示一个[下载按钮](https://github.com/chen7447/sci-download-for-zotero/blob/master/addon/content/icons/download.svg)。点击后自动带出当前条目的 DOI 开始下载；条目没有 DOI 时会自动按标题检索补全，方便边读边补。
<img width="2214" height="182" alt="image" src="https://github.com/user-attachments/assets/10fea329-26bd-4afe-8de6-8c3f29990c11" />



### 入口 3：条目右键菜单批量下载

在文库中选中一个或多个条目 → 右键 → **下载 PDF（Sci-Download）**。插件会逐条下载并汇总结果（成功 / 已有 PDF 跳过 / 未找到 / 失败）。目标分类跟随当前左侧选中的分类；未选中分类时按「未选分类」语义处理（见下文）。
<img width="380" height="990" alt="image" src="https://github.com/user-attachments/assets/775d0172-86ea-4c1e-80d1-60f84b8b9d49" />


### 智能提取文献信息
<img width="996" height="1236" alt="image" src="https://github.com/user-attachments/assets/5e189649-9b64-4c07-b7ee-df8ccf058b98" />


面板顶部的智能提取输入框支持三种输入方式，自动识别并填充其他字段：

| 输入类型 | 示例                             | 数据来源          |
| -------- | -------------------------------- | ----------------- |
| DOI      | `10.1038/s41586-020-2649-2`      | CrossRef          |
| PMID     | `32641826`                       | PubMed            |
| 标题     | `A new fossil from the Jurassic` | CrossRef 文献检索 |

提取成功后，**标题** 和 **信息**（期刊 · 年份 · 作者）会自动填充，DOI 也会自动补全。标题检索结果的匹配度偏低时会有黄色提示，请核对后再下载。

### 搜索并下载

1. 点击工具栏按钮打开下载面板
2. 输入或智能提取 DOI
3. 选择目标分类（可选；含「我的文库」与群组文库的分类）
4. 点击 **搜索并下载**
5. 等待进度条完成

下载过程中每轮并发尝试 3 个镜像站（粘性镜像与高优先级站点在前），并在镜像站列表中实时标注各站点状态。

### 镜像站管理

- **优先级列**（＋ 按钮）：点击为镜像站设置优先级，数值越小越先访问；再次点击取消优先级
- **地址列**：每行一个镜像站地址，可直接编辑；用户自行添加的站点可点击 `−` 删除（内置站点不可删）
- **状态列**：下载时实时显示该站点的状态
  - `[✓]` 成功（已通过 PDF 内容校验）
  - `[✗]` 站点有响应但未找到可用 PDF（含验证码/拦截页）
  - `[∅]` 镜像明确表示库中无此文（或 404）
  - `[?]` 网络错误或超时（可稍后重试）
  - `–` 本轮未尝试到（前面的站点已成功，或中途取消）
- **还原默认**：一键恢复内置镜像站列表（同时清除优先级与粘性记忆）

### 科研通

面板底部 **科研通 →** 链接可打开 [tool.yovisun.com/scihub](https://tool.yovisun.com/scihub/) 查询当前可用的 Sci-Hub 镜像站。

### 如何查找 DOI

点击 DOI 输入框旁的 `?` 按钮可查看查找 DOI 的帮助说明。

## 归档语义（重要）

本插件**统一管理**：同一个文库中，一个 DOI 只保留一个父条目，PDF、笔记、批注都挂在这一个条目下；条目可以同时归属多个分类（Zotero 的分类是虚拟分组，不会复制条目）。

| 场景                                          | 行为                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| **选择了目标分类**，目标文库中已有同 DOI 条目 | 复用该条目；不在所选分类时自动**加入**该分类；没有 PDF 则下载附加，已有则跳过 |
| **选择了目标分类**，目标文库中没有同 DOI 条目 | 在所选分类下新建父条目并附加 PDF                                              |
| **未选择分类**                                | 复用库内已有的同 DOI 条目补 PDF；没有才新建（归入「我的文库」）               |

> **你的库里有重复的父条目？** 那是 1.3.1 及更早版本留下的（旧版在「已有条目不在所选分类」时会新建条目）。v1.4.0 起不会再产生新重复；已有的重复建议在 Zotero 左侧「重复条目」分类中勾选合并，合并后笔记与附件自动归一。

## 执行流程

```
输入 DOI → 自动剥离 https://doi.org/ 前缀 → 格式校验
  → CrossRef 查询元数据（标题/作者/期刊/年份/卷/期/页码/出版社）
  → 按 粘性镜像 + 优先级 顺序，每轮并发 3 个镜像站竞速
       ├─ 候选 PDF 直链 → %PDF- 内容校验 → 通过即胜出，其余中止
       └─ 目标文库按 DOI 检索
            ├─ 已有同 DOI 条目 → 复用（按需加入所选分类；已有 PDF 则跳过下载）
            └─ 未找到 → 新建条目（自动填充元数据）→ 附加 PDF
```

## 常见问题

- **缺少 DOI 且标题检索不到的条目无法通过此插件下载**
- **条目已附加 PDF 时不会重复下载**（所有下载入口都会先检查已有 PDF 附件）
- **选择的分类不存在时，条目会归入「我的文库」**
- **「我的文库」里出现重复的父条目** — 旧版本遗留，v1.4.0 起不会再创建；用 Zotero「重复条目」分类合并清理即可（见「归档语义」）
- **镜像站状态 `[?]`** — 网络错误或超时（每个请求最多等待 10 秒），可稍后重试；`[∅]` 表示镜像明确无此文
- **下载到打不开的文件** — v1.4.0 起候选 PDF 均先经内容校验，验证码页不会再被存为 PDF；如遇整站验证码拦截，请换镜像或稍后再试
- **2021 年后的新文章在 Sci-Hub 上往往缺失**，请知悉

## 许可

[AGPL-3.0-or-later](LICENSE)

## 致谢

- 参考了 [zotero-scipdf](https://github.com/syt2/zotero-scipdf) 的 Sci-Hub 抓取逻辑
- 使用 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建

## 本地 CLI / Agent 接口（本 fork v1.4.2）

需要运行 Zotero 桌面端并安装本 fork 的 XPI；CLI 需要 Node.js 20+。
使用 Zotero 自带的本地 HTTP 服务，不另开服务器，也不依赖 MCP。

### 安装与凭据

```bash
npm ci
npm run build
# 将 .scaffold/build 中的 XPI 安装到 Zotero，然后重启
node bin/sci-download.mjs --help
# 可选：注册 sci-download 命令
npm link
```

插件首次启动生成 `extensions.zotero.scidownload.apiToken`。在 Zotero
设置 → 高级 → 配置编辑器中复制其值，设置环境变量 `SCI_DOWNLOAD_TOKEN`，
或写入 `~/.config/sci-download/token`（建议文件权限 `600`）。
`--token-file PATH` 可指定凭据文件；环境变量优先。不要将令牌提交到仓库。

### 一次下载多个 DOI / 补全多个条目

```bash
sci-download download '10.1038/s41586-020-2649-2' '10.1234/example' --json
sci-download download --item-key ABCD1234 --item-key EFGH5678 --json
# 可混合 DOI 与条目 key，添加到指定分类
sci-download download '10.1234/example' --item-key ABCD1234 --collection IJKL1234
# 群组文库需要 Zotero 本地 libraryID（不是 Web API group ID）
sci-download download --item-key ABCD1234 --library 3
```

单次支持 1–100 个输入，先处理 DOI，再处理 item key，分别保持输入顺序。
条目 key 和分类 key 均属于 `--library` 指定的文库，默认“我的文库”。
条目缺少 DOI 时沿用标题查询；指定条目始终作为 PDF 的父条目。
已有 PDF 跳过下载，仍按需加入指定分类。分类无效时整批拒绝，不回落到其他分类。
单篇失败不影响后续条目；重复输入仍各自返回结果，已有附件会跳过。

输出始终为 JSON，`results` 每项包含 `input`、`status`，以及可用的
`doi`、`itemKey`、`attachmentKey`、`message`。
状态为 `downloaded` / `skipped` / `not_found` / `failed`。
退出码：`0` 全部成功或跳过；`1` 至少一项未找到或失败；`2` 参数、连接或 HTTP 错误。
`--port` 默认 `23119`，`--timeout` 默认 `3600` 秒。
客户端超时或退出不会取消 Zotero 已接受的批次；插件正在处理其他 API 批次时返回 HTTP 409。

### 直接通过 HTTP 调用

`POST http://127.0.0.1:23119/scidownload/download`

- 请求头：`Authorization: Bearer <token>`，`Content-Type: application/json`
- 请求体示例：`{"dois":["10.1234/example"],"itemKeys":["ABCD1234"],"libraryID":1,"collectionKey":"IJKL1234"}`
- `dois`、`itemKeys` 至少一项非空；`libraryID`、`collectionKey` 可省略。
- HTTP 200 表示批次已处理，需检查各项状态；400 为参数错误，403 为鉴权失败，409 为忙碌。
- 接口拒绝携带 Origin 的浏览器请求。不要将 Zotero 本地端口公开到网络。

Agent 可以通过 Zotero MCP 获取条目 key，再调用这个 CLI 补 PDF；下载与归档全部由插件在本地完成。

验证命令：`npm run test:cli`、`npm run build`。
