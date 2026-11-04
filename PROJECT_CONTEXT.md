# PROJECT_CONTEXT.md — Web3D F1 求职项目

> 本文档是给 AI 编码助手的项目上下文。开始任何任务前必须先读完本文档。
> 文档中的“必须/禁止”是硬约束，不得以“更优雅”为由绕过；如认为约束有问题，先提问，不要直接改。

---

## 1. 项目定位（一句话）

一个用于求职展示的 Web3D 单页应用：浏览器中展示可拖拽旋转的 F1 赛车 3D 模型（红牛 RB19），
点击车身部件（如 Halo、动力单元）弹出该部件的科普信息面板。

**项目性质：个人作品集 / 学习项目，不是商业产品。**
作者是前端开发者，本项目的主要目的是学习 Three.js 并向面试官展示 3D 交互开发能力。
因此**代码的可讲解性、架构清晰度，优先级高于功能完备度**。

---

## 2. 目标与非目标

### 2.1 目标（In Scope）
- 单页加载一个 `.glb` 赛车模型，首屏可见，可 OrbitControls 拖拽旋转/缩放
- 模型加载进度反馈
- 车身若干热点标记（HTML 标签形式），点击弹出信息面板（标题 + 正文）
- 热点数据由独立配置文件驱动，新增热点 = 改配置，不改逻辑代码
- 桌面与移动端触摸均可用
- 部署为静态站点（Vercel/Netlify）

### 2.2 非目标（Out of Scope，禁止主动实现）
- ❌ 用户系统、登录、后端 API、数据库
- ❌ 热点内容的后台管理 / CMS / 编辑器
- ❌ 物理引擎（Cannon/Rapier）、车辆行驶动画、碰撞
- ❌ 多模型切换、模型加载器的通用化封装
- ❌ 国际化、主题切换、单元测试全量覆盖（可写少量关键逻辑测试）
- ❌ 服务端渲染（SSR）

---

## 3. 技术栈（已定，禁止替换）

| 层 | 选型 | 备注 |
|---|---|---|
| 构建 | Vite | 不换 Next.js / Nuxt / Webpack |
| 语言 | TypeScript（strict 模式） | |
| 3D | Three.js（原生 API） | **禁止引入 @react-three/fiber / drei / tresjs 等封装层** |
| 模型 | GLB / glTF 2.0 | 加载器用 `GLTFLoader`（含 Draco 解码器） |
| 相机控制 | `OrbitControls`（`three/addons/controls/`） | 禁止手写球面坐标控制器 |
| 热点标记 | `CSS2DRenderer`（`three/addons/renderers/`） | 用 HTML 做标记，不用 3D Mesh 做标记 |
| 拾取 | `Raycaster` | 只对“热点代理对象”做检测，见 §5.3 |
| UI 层 | **Vue 3**（SFC + `<script setup>` + TS + 组合式 API） | 只负责信息面板 / 加载条 / 页面外壳；3D 层保持纯 Three.js |
| 部署 | Vercel / Netlify 静态托管 | |

**关于 UI 框架（已定）**：作者确认引入 Vue 3，用途严格限定在 DOM 层。

- 允许：`App.vue`（页面外壳 + 装配 SceneManager）、`ui/*.vue`（信息面板、加载条）、
  `composables/*`（Vue 与 Three 之间的唯一桥）
- 禁止：用 Vue 渲染 3D（没有 r3f / tresjs 之类封装层）、引入 Pinia / Vuex / 组件库、
  用选项式 API 写新组件
- 桥接方式：Three 侧不认识 Vue；方向是 **Three → composable 的 ref → Vue 组件**
- 为此新增 3 个官方依赖：`vue`、`@vitejs/plugin-vue`（编译 `.vue`）、
  `vue-tsc`（`tsc` 无法检查 `.vue`，类型检查用它）

---

## 4. 目录结构（约定）

```
src/
├── main.ts                 # 入口：仅 createApp(App).mount('#app')
├── App.vue                 # 根组件：全屏外壳 + 模板引用拿画布宿主 + 装配 SceneManager
├── config/
│   ├── hotspots.ts         # ★ 热点数据（唯一数据源，见 §5.1）
│   └── scene.ts            # 相机、灯光、渲染器、OrbitControls 参数常量
├── core/
│   ├── SceneManager.ts     # Scene / Camera / Renderer / resize / 渲染循环
│   ├── ModelLoader.ts      # GLTF 加载 + 进度回调 + 包围盒居中缩放
│   └── HotspotSystem.ts    # ★ 热点系统：标记渲染 + Raycaster 拾取（见 §5）
├── composables/
│   └── useHotspots.ts      # Vue ↔ Three 的桥：把 3D 状态暴露成 ref（Phase 3 引入）
├── ui/
│   ├── InfoPanel.vue       # 信息面板（Vue 组件）
│   └── LoadingBar.vue      # 加载进度条（Vue 组件）
├── dev/
│   └── placeholderCube.ts  # Phase 1 占位立方体，Phase 2 删除
├── types/
│   └── hotspot.ts          # Hotspot 接口定义
└── assets/
    └── rb19.glb            # 或放 public/，按体积决定
```

**模块边界规则**：
- `core/` 下的模块不得直接操作业务数据，只接收参数
- `HotspotSystem` 不得 import `config/hotspots.ts`，数据由根组件注入
- `ui/` 下的 `.vue` 组件只操作 DOM，**不得 import `three` / `three/addons/*`**
- 只有根组件 `App.vue` 允许 `import './core/SceneManager'`（装配职责）；
  Three API 的具体调用都在 `core/` 里

---

## 5. 核心架构约定（AI 必须遵守）

### 5.1 热点数据模型（唯一数据源）

```typescript
// src/types/hotspot.ts
export interface Hotspot {
  id: string;                                  // 唯一标识，kebab-case
  label: string;                               // 标记点上显示的文字
  position: [number, number, number];          // 模型局部坐标系中的位置
  title: string;                               // 面板标题
  content: string;                             // 科普正文（纯文本或受限 HTML）
  // 预留字段（当前不实现，但接口里保留注释）：
  // media?: string;
  // focusTarget?: [number, number, number];
}
```

- 所有热点从 `src/config/hotspots.ts` 导出 `export const HOTSPOTS: Hotspot[] = [...]`
- **新增热点只允许改这份配置**，不得改 `HotspotSystem` 或 `main.ts`
- 当前需要覆盖的部件（内容用中文科普文案）：
  `halo`（Halo 头部保护装置）、`power-unit`（动力单元）、`front-wing`（前翼）、
  `rear-wing`（尾翼）、`suspension`（悬挂）、`floor`（底板/地面效应）
  具体坐标待模型确定后由用户在浏览器中调试填入，AI 不要凭空编造精确坐标。

### 5.2 视觉标记：CSS2DRenderer

- 每个热点 = 一个 `CSS2DObject`，挂载到场景（不是挂到模型网格上，避免模型层级干扰）
- 标记 DOM 结构固定为：
  ```html
  <div class="hotspot" data-hotspot-id="{id}"><span class="hotspot__dot"></span><span class="hotspot__label">{label}</span></div>
  ```
- 样式类名前缀 `hotspot__`，用 BEM 风格
- `CSS2DRenderer` 的 DOM 容器必须 `pointer-events: none`，
  但标记元素本身 `pointer-events: auto`（否则会挡住 OrbitControls 拖拽）

### 5.3 拾取：Raycaster 只打“代理对象”

**硬性要求**：不要对 RB19 模型的所有网格做 raycast（性能差、依赖模型网格拆分质量）。

- 为每个热点创建一个不可见代理对象（`SphereGeometry` 低面数 或 `PlaneGeometry`），
  用 `material.opacity = 0, transparent = true` 的方案（注意 `visible = false` 的对象不参与 raycast）
- `object.userData.hotspotId = id`，raycast 命中后从 `userData` 取 id
- `raycaster.intersectObjects(proxyObjects, false)`

### 5.4 渲染循环与交互

- 单一 `requestAnimationFrame` 循环，由 `SceneManager` 统一调度
- 每帧必须调用 `controls.update()`（因为开启了 damping）
- 每帧渲染 `WebGLRenderer` + `CSS2DRenderer` 两个 renderer
- `enableDamping = true`, `dampingFactor = 0.05`
- 设置 `minDistance / maxDistance` 防止相机穿模
- 监听 `resize`，同步更新 camera 宽高比与两个 renderer 尺寸
- 监听 `pointerdown` 做拾取；**拾取需区分“点击”与“拖拽”**：
  记录 pointerdown 位置，pointerup 时位移 < 5px 才视为点击

### 5.5 模型加载

- `GLTFLoader` + `DRACOLoader`（decoder path 用 CDN 或本地拷贝，二选一固定）
- 加载后用 `Box3` 计算包围盒：
  - 模型居中到原点
  - 按包围盒最大边归一化缩放到约定尺寸（如 4 个单位）
  - 依据尺寸自动设置相机初始距离与 `controls.target`
- `onProgress` 回调驱动 `LoadingBar`
- 加载失败必须有兜底 UI 文案，不允许白屏

---

## 6. 编码规范

- TypeScript strict，禁止 `any`（确需时用 `unknown` + 类型收窄）
- 每个模块单一职责，导出 class 或纯函数，不写巨型 `main.ts`
- 常量集中在 `config/`，**禁止在逻辑代码里出现魔法数字**（相机距离、颜色、尺寸等）
- 注释用中文，解释“为什么”而非“是什么”；每个模块顶部有一段职责说明
- 不使用 `console.log` 作为长期日志，调试日志提交前删除
- CSS 用独立 `.css` 文件 + BEM 命名，不用内联样式（动态定位除外）

---

## 7. 性能约束（AI 在实现时须主动考虑）

- 目标：桌面端首屏模型可见 < 5s（中等网络），移动端可用
- 模型压缩：`@gltf-transform/cli` 做 Draco 几何压缩 + 纹理转 WebP/缩放
- 纹理按需，单张不超过 2048
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`
- 静态场景可考虑按需渲染（damping 停止后暂停 RAF），但**不强制**，作为可选优化项记录在 README

---

## 8. 当前阶段与任务清单

> AI 每次工作前请确认当前阶段，只做该阶段内的事。

**Phase 1 — 跑通渲染骨架（已完成）**
- [x] Vite + TS + Three.js 初始化
- [x] SceneManager：场景、相机、灯光、渲染循环、resize
- [x] OrbitControls 接入，用占位立方体验证拖拽旋转
- [x] 验收：headless 浏览器截图确认立方体渲染正常、类型检查零错误

**Phase 1.5（当前）— 接入 Vue 3 外壳**
- [x] 安装 vue / @vitejs/plugin-vue / vue-tsc，新增 `vite.config.ts`
- [x] `main.ts` 改为 `createApp(App).mount('#app')`，3D 初始化移出入口
- [ ] `App.vue`：模板引用 + `onMounted` 装配 SceneManager ← **由作者本人完成（已留白）**
- [ ] 验收：`npm run dev` 看到立方体可拖拽；`npm run typecheck` 零错误

**Phase 2 — 接入真实模型**
- [ ] ModelLoader：GLTF 加载 + 进度 + 包围盒居中缩放 + 相机自动适配
- [ ] LoadingBar
- [ ] 灯光/环境贴图调优
- [ ] 验收：车模正确显示、比例正常、可自由旋转、加载有进度反馈

**Phase 3 — 热点系统**
- [ ] Hotspot 类型定义 + `config/hotspots.ts`（先放 2 个热点验证链路）
- [ ] HotspotSystem：CSS2D 标记 + 代理对象 + Raycaster + 点击/拖拽区分
- [ ] InfoPanel：点击弹出、关闭、点击空白处关闭
- [ ] 验收：点击 Halo 标记弹面板，拖拽不误触发

**Phase 4 — 内容与适配**
- [ ] 补齐 6 个热点的科普文案与坐标
- [ ] 移动端触摸适配、面板响应式
- [ ] 错误兜底、加载失败文案

**Phase 5 — 优化与包装**
- [ ] 模型压缩并记录优化前后数据
- [ ] README（架构图、技术决策、优化对比、已知简化）
- [ ] 部署

---

## 9. 禁止事项（AI 常见越界行为清单）

1. 禁止替换技术栈（Vite / TS / Three.js 原生 / OrbitControls 已定）
2. 禁止引入 R3F、drei、tresjs 等 Three.js 封装层
3. 禁止引入状态管理库（Redux/Pinia/Zustand）——本项目无全局状态需求
4. 禁止引入 UI 组件库（Ant Design/Element/Naive 等）——手写 DOM 即可
5. 禁止引入物理引擎、动画库（GSAP 可用但需先询问）
6. 禁止把热点硬编码进 `HotspotSystem`——必须走 `config/hotspots.ts`
7. 禁止对全模型网格做 raycast——只用代理对象
8. 禁止凭空编造热点 3D 坐标——坐标由用户调试后提供，AI 只填 `[0, 0, 0]` 占位并注明 TODO
9. 禁止一次性实现多个 Phase 的任务
10. 禁止在未确认的情况下改动 `package.json` 依赖（新增依赖必须先说明理由并征得同意）
11. 禁止把 3D 渲染逻辑写进 `main.ts` 或任何 UI 模块
12. 禁止用 `console.log` 交付调试代码
13. 禁止在 `ui/*.vue` 里 `import three`（装配只允许出现在 `App.vue`）
14. 禁止用选项式 API（Options API）写新组件，统一 `<script setup lang="ts">`
15. 禁止用 `tsc` 代替 `vue-tsc` 做类型检查——`tsc` 看不见 `.vue` 文件
16. 禁止绕过 §13 的教学流程直接给出完整实现（作者明确要求时除外）

---

## 10. 术语与背景知识（供生成文案时参考）

- **F1**：一级方程式赛车锦标赛
- **RB19**：红牛车队 2023 赛季赛车，该赛季统治级表现
- **Halo**：2018 年起 F1 强制使用的驾驶舱头部保护装置（钛合金弧形结构），
  用于防护飞溅碎片与翻车时保护车手头部；曾因外观受争议，后因多次挽救车手生命被广泛认可
- **动力单元（Power Unit）**：F1 混动时代术语，含 1.6L V6 涡轮增压内燃机 + 涡轮 + MGU-K + MGU-H + 电池
- **地面效应 / 底板（Floor）**：通过底板文丘里通道产生下压力，2022 规则回归的核心概念
- **DRS（尾翼）**：可调尾翼减阻系统，用于直道超车

> 生成科普文案时：面向普通读者，每段 80–150 字，说清“是什么 + 为什么重要”，
> 不确定的具体数据（如功率数值）不要编造，用定性表述或留 TODO 让用户补充。

---

## 11. 验证与交付标准

- 本地：`npm run dev` 无控制台报错；`npm run build` 通过；`vue-tsc --noEmit` 无类型错误
  （注意：`tsc` 检查不到 `.vue`，必须用 `vue-tsc`）
- 每次交付需说明：改了哪些文件、对应哪个 Phase 的哪个条目、如何手动验证
- 不通过标准时不得声称“已完成”

---

## 12. 交互协议（给 AI 的工作方式约定）

- 每次任务开始：先复述你要做的 Phase 与条目，再动手
- 涉及坐标、模型文件、外部资源时：先问用户要，不要假设
- 架构层面的改动（目录、模块职责、数据模型）：先提议，得到确认再改
- 遇到本文档未覆盖的决策：列出选项 + 推荐 + 理由，等用户选择