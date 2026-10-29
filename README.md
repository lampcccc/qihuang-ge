# 中医查询站点 · TCM Query Site

一个面向中医学习与研究的多模块检索站点，涵盖**中药材、汤方、中医术语词典、中医著作、中医教材、备考资源**等板块。后端采用 Bun + TypeScript 直接读取 SQLite，前端为 React + Vite，部署无需独立的数据库服务。

> 许可证：[Apache License 2.0](./LICENSE) © 2026 lampcccc

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Bun](https://bun.sh)（TypeScript 运行时 + 内置 `bun:sqlite`） |
| 服务端 | 原生 Bun HTTP（`server/index.ts`），单文件 SQLite 存储 |
| 前端 | React 18 + React Router 6 + Vite 5 + Tailwind CSS 3 |
| 桌面端（可选） | Tauri（`src-tauri/`） |
| 数据源 | 只读源库 `data/zysj.sqlite` + 本站可写库 `data/tcm_rx.sqlite` |

---

## 目录结构

```
tcm-site/
├── server/            # 服务端（Bun HTTP + SQLite 读取/索引/接口）
│   ├── index.ts       # 路由与静态托管（3801 端口，托管 dist/）
│   ├── db.ts          # 只读源库连接
│   ├── prescriptions.ts  # 汤方模块（覆盖层 / 删除名单 / 索引）
│   ├── annotate.ts    # 生成药材结构化标注（herb_attributes.json）
│   └── build_rx.ts    # 构建汤方组成索引
├── src/               # 前端 React 应用
│   ├── pages/         # 各模块页面（Herbs / Prescriptions / ...）
│   ├── components/    # 共享组件（侧边栏、对话框、筛选等）
│   └── lib/           # 类型与 API 封装
├── src-tauri/         # 可选的 Tauri 桌面端封装
├── data/              # 运行时数据（见下方“数据说明”，未纳入版本库）
├── index.html         # Vite 入口
└── dist/              # 前端构建产物（gitignore，由 build 生成）
```

---

## 快速开始

### 1. 安装依赖

需要 [Bun](https://bun.sh)（≥ 1.0）：

```bash
bun install
```

### 2. 准备数据（重要）

数据文件因体积较大**未纳入 Git 仓库**（详见下方“数据说明”），请先将其放入 `data/`：

- 将只读源库 `zysj.sqlite` 放到 `data/zysj.sqlite`（**必需**，约 646 MB）。
- 生成药材结构化标注（可选，首次运行前执行一次）：

  ```bash
  bun run server/annotate.ts
  ```

- 构建汤方组成索引（可选，首次运行前执行一次）：

  ```bash
  bun run server/build_rx.ts
  ```

- `data/tcm_rx.sqlite`（本站可写库：自建汤方 / 源方剂覆盖 / 删除名单 / 索引）会在**服务首次启动时自动创建**，无需手动准备。

### 3. 构建前端

```bash
bun run build      # 产物输出到 dist/
```

### 4. 启动服务

```bash
bun run start      # 默认监听 http://127.0.0.1:3801
```

浏览器打开 <http://127.0.0.1:3801> 即可访问。开发模式下可用 `bun run dev` 启动 Vite 热更新开发服务器。

---

## 数据说明（为何数据文件不在仓库中）

| 文件 | 作用 | 是否入库 | 说明 |
|---|---|---|---|
| `data/zysj.sqlite` | 只读中医源数据库（药材 18,295 条、方剂 52,050 条，同表以 `TypeID` 区分） | ❌ 否 | 约 646 MB，超出 GitHub 单文件 100 MB 限制，需自行放置于 `data/` |
| `data/herb_attributes.json` | 由 `server/annotate.ts` 从源库派生的药材结构化属性 | ❌ 否 | 运行 `annotate.ts` 重新生成 |
| `data/tcm_rx.sqlite` | 本站自有可写库（用户数据） | ❌ 否 | 服务首次启动自动创建 |

> 由于源库 `zysj.sqlite` 为外部数据集，**本仓库不包含该文件**。请将其放置于 `data/zysj.sqlite` 后再启动服务；缺失时服务会报错退出。

---

## 模块简介

- **中药材**：单味药的性味归经、功效、别名、来源等；支持按名称 / 拼音 / 功效筛选。
- **汤方**：在中药材基础上新增的模块，含组成、煎煮法、功效、禁忌、备注，支持自建汤方；
  与中药材**双向互查**（某药材被哪些汤方收录）。
- **中医术语词典 / 中医著作 / 中医教材 / 备考资源**：术语解释、典籍文献、教材与备考资料检索。

---

## 桌面端（可选）

本项目附带 Tauri 封装，可打包为桌面应用：

```bash
bun run tauri dev     # 开发
bun run tauri build   # 打包
```

需要 Rust 工具链与 Tauri CLI。

---

## 许可证

本项目以 **Apache License 2.0** 发布。详见 [LICENSE](./LICENSE)。
第三方依赖按其各自许可证分发（见 [NOTICE](./NOTICE) 与 `package.json`）。
