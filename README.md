# RB19 · Web3D

浏览器里的 F1 赛车 3D 展示页：单页加载 RB19（红牛 2023 赛季赛车）模型，可拖拽旋转，
点击车身部件弹出科普信息。个人作品集 / 学习项目。

> 架构约束、技术选型、禁止事项以 [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) 为准。
> 本 README 只记录「怎么跑」和「当前进度」，规则冲突时一律听 PROJECT_CONTEXT.md。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 先 `tsc --noEmit` 类型检查，再产出 `dist/` |
| `npm run preview` | 本地预览构建产物 |
| `npm run typecheck` | 只做类型检查 |

环境要求：Node ≥ 20（已验证 20.10.0）。

## 当前进度

- ✅ **Phase 1 — 跑通渲染骨架**：Vite + TS strict + Three.js 初始化，SceneManager
  负责场景/相机/灯光/resize/单一 RAF 循环，OrbitControls 可拖拽缩放，
  首屏有占位立方体（`src/dev/placeholderCube.ts`，Phase 2 删除）
- ⬜ Phase 2 — 接入真实模型（待 `rb19.glb`）
- ⬜ Phase 3 — 热点系统（CSS2D 标记 + 代理对象 Raycaster + 信息面板）
- ⬜ Phase 4 — 内容与移动端适配
- ⬜ Phase 5 — 模型压缩、README 完善、部署

## 目录

```
src/
├── main.ts              # 入口：只做装配
├── config/scene.ts      # 相机 / 灯光 / 渲染器 / 控制器常量（无魔法数字）
├── core/SceneManager.ts # 场景、相机、渲染器、灯光、resize、渲染循环
├── dev/placeholderCube.ts # Phase 1 占位物，Phase 2 删除
└── style.css
```

## 已知事项

- **构建体积**：Phase 1 的 JS 产物约 545 kB（gzip 135 kB），几乎全是 three.js，
  `vite build` 会提示 chunk 超过 500 kB。Phase 5 做优化时再处理（模型与热点文案
  接入后体积分布会变），当前不引入代码分割。
- **Vite 停在 6.x**：Vite 7 要求 Node ≥ 20.19，本机是 20.10.0；升级 Node 后才可升 Vite。
- **模型文件**：`rb19.glb` 尚未提供，Phase 2 开始前需放入 `src/assets/` 或 `public/`。
- **热点坐标**：必须由你在浏览器里调试后给出，代码里只放 `[0, 0, 0]` 占位 + TODO。
