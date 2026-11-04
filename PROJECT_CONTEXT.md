# PROJECT_CONTEXT.md — Web3D F1 求职项目

> 本文是给 AI 编码助手的长文档（设计与验收依据）。
> 日常先读同目录 `AGENTS.md` 速查表；只有需要设计理由、历史决策或验收细节时，才按 `AGENTS.md` 第 7 节的索引读本文对应章节。
> 文档中的“必须/禁止”是硬约束，不得以“更优雅”为由绕过；如认为约束有问题，先提问，不要直接改。

---

## 1. 项目定位（一句话）

一个用于求职展示的 Web3D 单页应用：浏览器中展示可拖拽旋转的 F1 赛车 3D 模型（红牛 RB22），
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
| 模型 | GLB / glTF 2.0 | `GLTFLoader`（当前模型未压缩，不需要 Draco/KTX2 解码器） |
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
├── main.ts                 # 入口：仅 createApp(App).mount('#app') + 全局 CSS
├── App.vue                 # 根组件：全屏外壳 + 模板引用拿画布宿主 + 装配 + 加载状态
├── config/
│   ├── hotspots.ts         # ★ 热点数据（唯一数据源，见 §5.1）
│   ├── hotspot.ts          # 热点的表现/交互常量（热区、拖拽阈值、卡片尺寸）
│   ├── model.ts            # 模型地址、两档画质、归一化尺寸（Phase 2）
│   ├── lift.ts             # 升降换模舞台：台面/井/舱门/全息提示时序（Phase 3.5）
│   ├── showroom.ts         # 展示间布景：房间 + 每件道具的参数与摆位（Phase 2.5）
│   ├── videoScreen.ts      # ★ 前墙视频：本地 MP4 / 赛事周末信息 / 播控层可见性阈值
│   └── scene.ts            # 相机、灯光、渲染器、OrbitControls、自适应取景参数
├── data/                   # 2026 上海站 Q3 静态遥测（JSON，5 Hz，见 README「遥测数据」）
├── core/
│   ├── SceneManager.ts     # Scene / Camera / 两个 Renderer / resize / 渲染循环 / frameObject
│   ├── ModelLoader.ts      # GLTF 加载、居中、归一化、各向异性
│   ├── Showroom.ts         # 展示间总装：房间（含升降口）+ 按配置摆道具 + 每帧更新 + dispose
│   ├── LiftStage.ts        # ★ 升降台 + 升降井 + 双开滑动地板 + 分段动画（Phase 3.5）
│   ├── dispose.ts          # 统一的几何 / 材质 / 贴图释放
│   ├── ProceduralTextures.ts # canvas 贴图：地坪/后墙三屏/穿孔板/前墙视频海报
│   ├── props/              # 一件道具一个 builder：展台/后墙三屏/前墙视频/桁架/轮胎墙/工具墙
│   └── HotspotSystem.ts    # ★ 圆点 + 代理球拾取 + 背向淡出 + 整体淡入淡出
├── composables/
│   └── useHotspots.ts      # Vue ↔ Three 的桥：选中状态、屏幕锚点、开关、淡入淡出
├── ui/
│   ├── HotspotCard.vue     # 热点浮窗（F1 风格、防溢出、窄屏抽屉）
│   ├── HotspotToggle.vue   # 右上角热点总开关（默认开启，关闭后隐藏圆点）
│   ├── QualitySwitch.vue   # 底部居中的画质切换（只抛 change，不碰 Three）
│   ├── SwapHologram.vue    # 「车辆切换中 / 切换成功」全息提示（屏幕空间固定，含进度条）
│   ├── SwapActions.vue     # 换模失败后的「重试 / 返回上一档」（只操作 DOM）
│   ├── VideoScreen.vue     # ★ 前墙赛事图形 + 墙装播控面板（按屏幕/控制台四角投影贴上去）
│   ├── projectedQuad.ts    # 矩形 → 投影四边形的 8 自由度单应矩阵（纯数学，不碰 Three）
│   ├── hotspots.css        # 圆点/标签的全局样式（DOM 由 HotspotSystem 创建）
│   └── LoadingBar.vue      # 加载进度条（Phase 2）
├── dev/
│   └── hotspotPicker.ts    # 开发期取点工具（?pick，只在 DEV 加载）
├── types/
│   └── hotspot.ts          # Hotspot 接口定义
└── style.css

public/
├── models/rb22-lite.glb    # WebP + 量化版，6.6 MB（默认加载）
├── models/rb22.glb         # 未压缩车模，约 35.8 MB（构建时原样拷贝，见 README）
└── videos/                 # 前墙视频 Ver2024.mp4 + 加载海报封面（换片时同步换封面）
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
  label: string;                               // 圆点 hover 时显示的名字（英文缩写）
  position: [number, number, number];          // 车模局部坐标（GLB 单位，车头 +Z）
  normal?: [number, number, number];           // 朝外法线，用于背向淡出，可省略
  hitRadius?: number;                          // 代理球半径（场景单位），可省略
  title: string;                               // 卡片标题
  summary: string;                             // 一句话说明（80~150 字）
  specs?: { label: string; value: string }[];  // 2~4 条关键规格
  source?: { label: string; url: string };     // 官方出处
}
```

- 所有热点从 `src/config/hotspots.ts` 导出 `export const HOTSPOTS: readonly Hotspot[] = [...]`
- **新增热点只允许改这份配置**，不得改 `HotspotSystem` 或 `main.ts`
- 当前覆盖 8 个部件（内容用中文科普文案）：
  `halo`、`power-unit`、`front-wing`、`rear-wing`、`tyre`、`suspension`、`floor`、
  `plank`（车底木地板/防滑块，法线朝下，只在车底视角可见）
- **坐标必须用 `?pick` 工具采集**（`npm run dev` + `http://localhost:5173/?pick`），
  AI 只填 `[0, 0, 0]` 占位并注明 TODO，不得凭空编造
- 坐标单位是**车模局部坐标（GLB 原始单位，车长约 5.4）**，由 `HotspotSystem` 用模型的
  世界矩阵换算；不要写成场景单位（车长 4），两种单位混用是这套配置最容易踩的坑
- 卡片内容用结构化字段渲染（`summary` + `specs` + `source`），**不用 `v-html`**

### 5.2 视觉标记：CSS2DRenderer

- 每个热点 = 一个 `CSS2DObject`（`button` 元素），挂载到场景（不是挂到模型网格上，避免模型层级干扰）
- 标记 DOM 结构固定为：
  ```html
  <button class="hotspot" data-hotspot-id="{id}" aria-expanded="false">
    <span class="hotspot__dot"></span>
    <span class="hotspot__label">{label}</span>
  </button>
  ```
  用 `<button>` 而不是 `<div>`：Tab 聚焦、Enter/Space 打开、aria 状态都是浏览器原生行为
- 样式类名前缀 `hotspot__`，用 BEM 风格；圆点 10px，按钮热区 24px；
  标签只在 hover / focus 时出现，打开状态下隐藏（卡片标题已经写明部件名）
- **`CSS2DRenderer` 不会自己设置 `pointer-events`**，它的全屏容器必须由 `.css2d-layer`
  显式设成 `none`（见 `style.css`），只让 `.hotspot` 自身 `auto`，
  否则整个页面都拖不动，OrbitControls 直接失效
- **热点总开关**：页面右上角常驻 `ui/HotspotToggle.vue`（`role="switch"`），默认开启；
  状态放在 `useHotspots` 的 `enabled`，转发给 `HotspotSystem.setEnabled()`。
  关闭后圆点立刻 `display:none`、代理球不再参与拾取、已打开的卡片自动收起；
  不写 localStorage，刷新后回到开启状态

### 5.3 拾取：Raycaster 只打“代理对象”

**硬性要求**：不要对 RB22 模型的所有网格做 raycast（性能差、依赖模型网格拆分质量）。
唯一例外是 dev 的 `?pick` 取点工具——它只在点击时算一次，且不进生产包。

- 为每个热点创建一个不可见代理球（`SphereGeometry(radius, 12, 8)`），
  用 `material.opacity = 0, transparent = true, depthWrite = false, colorWrite = false` 的方案
  （注意 `visible = false` 的对象不参与 raycast）
- 半径默认 `HOTSPOT_VIEW_CONFIG.defaultHitRadius`（场景单位，约等于屏幕 40px 直径），
  个别部件可用 `hitRadius` 覆盖；**不要**用圆点 DOM 的 10px 当热区
- 拾取路径有两条，都必须能打开同一张卡片：
  1. 圆点 `<button>` 的 `click`（DOM 事件，天然支持键盘）；
  2. canvas 上的 `pointerup` → 代理球 raycast（圆点周围约 40px 的容错热区，移动端靠它）
- 代理球只参与「当前面向镜头」的拾取：背面圆点虽然透明了，代理球还在，
  不筛掉的话点车尾会命中车头那几个已淡出的点
- `raycaster.intersectObjects(proxyObjects, false)`，命中最近的球；从网格反查条目，
  不依赖 `userData`（避免类型断言）
- 点空白处（canvas 上没有命中）回调 `null`，由上层关闭卡片
- 圆点按「法线 vs 镜头方向」点积淡出，背对镜头的面不显示标记；
  **禁止每帧对模型 raycast 做遮挡判断**（28 万三角形会把拖拽拖卡）

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

- 画质两档（见 `config/model.ts`）：`lite` 6.6 MB，**页面默认加载它**；
  `high` 36 MB，只在用户主动切换时按需加载（下载与下降动画并行，见 §5.7）。
  不写 localStorage 记住选择：验收要求"进入页面默认低精度"。
- `GLTFLoader` 直接加载未压缩的 GLB：当前模型是 PNG 贴图，不声明 Draco / KTX2，
  所以不需要接 DRACOLoader / KTX2Loader（之前压缩版留下的 `public/draco`、`public/basis` 已删）
- 换回压缩模型时：重新接上两个解码器，并把 `three/examples/jsm/libs/{draco/gltf,basis}/`
  的文件拷进 `public/`，用 `setDecoderPath` / `setTranscoderPath` 显式指定（不走 CDN，
  也不要用默认 `import.meta.url`——dev 下 Vite 预打包会把它改写坏）
- 当前模型（`public/models/rb22.glb`）：约 35.8 MB；1 个 mesh / 27 个 primitive，
  约 28 万三角形；23 个材质、26 张 PNG 贴图（4096 起，显存约 330 MB）；
  **根节点自带 +90° X 旋转**，加载后已是 Y-up，代码里不要再补坐标轴旋转
- **模型授权（硬约束）**：来源 Sketchfab「2026 Redbull RB22」by Tyler_Dave，协议
  **CC BY 4.0**（允许商用，要求署名）。页面左上角与 README 必须保留作者、来源和协议链接，
  不得移除；Red Bull / F1 等商标不在 CC 协议范围内
- 加载后给所有贴图开各向异性过滤（`MODEL_CONFIG.maxAnisotropy`，上限 8）：
  轮胎、字标这类斜看细节靠它压锯齿；1x 屏仍明显时调 `RENDERER_CONFIG.renderScale`
- 加载后用 `Box3` 计算包围盒：
  - 模型只在 X/Z 居中，Y 保持原生「底面贴地」（否则半辆车会陷进地坪）
  - 按包围盒最大边归一化缩放到 `MODEL_CONFIG.targetSize`（4 个场景单位）
  - 用包围球 + `CAMERA_FIT_CONFIG.padding` 自动算相机距离，并设置 `controls.target`
- `onProgress` 回调驱动 `LoadingBar`；`total` 为 0（没有 Content-Length）时显示不确定进度动画
- 加载失败必须有兜底 UI 文案，不允许白屏
- 环境光：`RoomEnvironment` + `PMREMGenerator` 生成 `scene.environment`，
  车漆 / 碳纤维这类 PBR 材质靠它出反射，不能只靠平行光

### 5.6 背景：程序化「车队工房展示间」

- 背景不是 HDRI，是 `core/Showroom.ts` 用基础几何 + canvas 贴图搭的静态布景：
  **13.6 × 13.6 的封闭房间**——白色无缝环氧地坪、四面墙、踢脚线、四面灯带、天花板 + 天花灯带，
  中间是发光展台与车，后墙挂**三屏遥测墙**（居中主屏 + 左右副屏），前墙挂**8.18 × 4.6（16:9）视频大屏**
  （本地 `Ver2024.mp4`，屏幕下方是一块真实的 3D 控制台，DOM 播控面板贴在台面前表面），侧面是轮胎墙、工具墙，后墙右下角一台移动工具车
- 房间是封闭的：相机在房间里绕车转（默认半径约 4.9），四面墙 + 天花板保证水平环绕
  任何角度都看不到「墙外」；这也是相机 `maxDistance = 6.4`、墙距 6.8 的由来
- 所有尺寸/颜色/坐标在 `config/showroom.ts`：每件道具一个配置块（带 position / rotationY），
  加道具 = 写一个 builder + 注册表加一行 + `props` 数组加一行，`Showroom` 不用改
- 相机 **360° 自由环绕**，不再锁方位角。俯仰上限 2.0 rad 允许镜头沉到地面以下看车底；
  相机高度低于地面时，`SceneManager.floorClipPlane` 会把地板和展台沿视线裁掉
  （`UNDERBODY_CLIP_CONFIG`），避免地面挡在镜头和车底之间
- 默认机位方位角约 **22°**（原 36°），取景目标再右移 `targetOffsetX = 0.6`：
  后墙三屏总宽约 12.0，36° 机位会把右副屏完全裁出画面；改完后主屏完整入画、
  右副屏能露出大半。代价是绕车旋转时车略偏画面中心（0.6 约为车长的 15%）
- 地坪是**白色环氧 P 房地板**：canvas 贴图不画板缝，`repeat = 2`（每片 20 单位），
  房间可见范围内不存在贴图接缝；粗糙度 0.82、金属度 0.02，只留柔光不做镜面
- 主光是从天花板下打的 **SpotLight**（y=4.6，天花板 5.2 之下），只有光池，四周压暗；
  桁架与灯头必须 `castShadow = false`，否则横梁影子会落在车上
- 车抬到展台面上（`SHOWROOM_CONFIG.plinth.height`），阴影落在台顶；Y 仍保持模型原生「底面贴地」
- 雾（`ATMOSPHERE_CONFIG`）8 / 26，房间尺度下只让远处墙轻微发灰
- 后墙是**三屏遥测墙**：主屏 6.4 × 3.2（2:1）、左右副屏 2.4 × 1.8（4:3），
  三屏共用 `x=0` 的垂直中轴，间距 0.4；主屏是视觉主导，副屏只做辅助信息层
  （左：ERS 能量 / SOC / 电机；右：地速 / 节气门-刹车曲线 / 四轮胎温；均为程序化示意）
- 主屏顶部 150px 是赛事字标（上海大奖赛 / FORMULA 1 / CHINESE GRAND PRIX · SHANGHAI 2026），
  下面是场次栏；字标只用字体 + 红色分隔线做同风格排版，不复制官方 logo
- 主屏数据是真的：2026 上海站 Q3 成绩来自 F1 官方计时，VER 第 16 圈的遥测来自
  OpenF1（非官方），5 Hz 重采样后放在 `src/data/ver-2026-shanghai-q3.json`；
  F1 公开数据里没有 ERS / 胎温，所以左右副屏仍是程序化示意
- 三块屏都走 canvas 动态刷新：主屏 2s（成绩榜、Q3 最好成绩、真实速度曲线），副屏 0.9s
  （数值、分段条、SOC / 节气门曲线、胎温状态灯）；由 `SceneManager.onFrame` 驱动
- 启动时三块屏各做一次 1.3s 的自上而下扫描上电，主屏先亮、左右副屏延后 0.12s 一起亮；
  遮罩只画在各自贴图里，不新增 DOM / 渲染层级，也不参与 LiftStage 的换模时序
- 前墙（+Z，车头正前方）是**视频大屏**：8.18 × 4.6（16:9，y 0.6–5.2），比后墙主屏更高、
  与主屏同一条水平中轴；屏幕组 `position [0, 2.9, 6.76]`、`rotationY = π`（法线朝房间内），
  屏幕面在 6.74，背板停在墙面之前 0.02，不穿墙、不 z-fighting。相机 `maxDistance ≈ 6.4`，屏幕永远在
  车、升降台、闸口、热点标记、全息层和左右副屏之后，**不参与遮挡判断**
- 视频源是**本地文件** `public/videos/Ver2024.mp4`（1280×720 / H.264 + AAC / 8:46 /
  约 66 MB），由 `config/videoScreen.ts` 的 `src = 'videos/Ver2024.mp4'` 引用，
  `BASE_URL` 拼接成相对路径；**不用 iframe、不引用外部链接**。源文件最初在
  `dist/videos/`，项目复制到 `public/videos/` 供 dev / build 使用（`dist/` 是构建产物）
- `core/props/videoWall.ts` 用 `HTMLVideoElement` + `VideoTexture` 把视频贴到 3D 屏幕：
  8.18 / 4.6 与 1280×720 同为 16:9，画面按 cover 满铺整块屏，不裁不拉伸、也不叠任何图形；
  `MeshBasicMaterial + toneMapped:false`，和后墙三屏一致
- `video-wall` 已加回 `PropKind` / `buildProp` / `SHOWROOM_CONFIG.props`；`ShowroomHandle`
  额外暴露 `videoWall: VideoWallProp`，由 `App.vue` 转交给 `ui/VideoScreen.vue`
- 播放策略：**默认静音 + 自动播放 + 循环**；屏幕第一次进入视锥连续可见 0.25s 后才拉流
  （默认机位背对前墙，不与车模抢首屏带宽）；离开视锥立即暂停解码、保留进度，
  回来时按用户播放意图恢复；用户暂停后不会被自动续播
- 控制器对 DOM 暴露 `snapshot / togglePlay / seek / setVolume / toggleMuted / retry /
  getQuad / getConsoleQuad`：读写的都是真实 `<video>` 的
  `currentTime / paused / volume / muted`，不存在 iframe 的状态不同步；
  两个 `get*Quad` 返回屏幕面 / 控制台前表面的四个投影角点
- 屏幕和屏幕下方控制台都是 **3D 物体**：屏幕有墙面安装板、加厚边框、四角固定螺钉、
  F1 红饰线；控制台 0.5 高、0.16 深，带金属端盖和红色台沿，是真正「钉在墙上」的
  硬件，不是悬浮 DOM 条
- 播控层是 **DOM**（`ui/VideoScreen.vue`）：每帧拿控制台面的四角投影，用 8 自由度单应
  矩阵（`ui/projectedQuad.ts`）把播控面板贴到 3D 台面上，四条边和真实台面严格重合；
  相机绕车旋转时面板跟着透视；`z-index: 1` 在 canvas 之上、CSS2D 热点层（2）之下；
  屏幕太偏 / 太斜 / 出视口时控制台收起
- 屏幕本身不叠任何 DOM：标题条 / ticker / 车手条 / 信号状态都已移除，16:9 视频满铺，
  雨战画面就是屏上唯一的信息层
- 控制台包含：播放 / 暂停（图标随真实 `paused` 切换，加载中转圈、失败变重试）、
  后退 / 前进 10s、原生 `<input type="range">` 进度条（点击 / 拖动 / 键盘，
  带已缓冲区间，拖动时每次 `input` 都 `seek()`，视频画面实时跟随）、
  `当前时间 / 总时长`、独立静音按钮（图标区分静音 / 低 / 高音量）+ 音量滑块 +
  百分比（拖动滑块自动取消静音）；风格与后墙三屏 / 遥测卡统一
- 加载兜底：首帧前显示程序化海报（扫描线 + 缓冲百分比 + 封面压暗底图）；
  文件缺失 / 解码失败 / 30s 没有新数据（`progress` 停住才算超时）回退
  「视频信号暂不可用」海报，控制台播放键变重试；**失败只影响这块屏，不抛未捕获异常，
  不阻塞车模加载、换模动画和其他交互**
- 版权：视频来自 B 站 UP 主「一只萌萌哒chara」的《"Where is Max?"》
  （https://www.bilibili.com/video/BV1AJgP6GEPo/，原片 4K），本项目转码为本地 720p 文件
  只做非商业展示；版权归 UP 主与哔哩哔哩所有，署名写在页面左上角、「素材与授权」和「致谢」
  （封面 `public/videos/sao-paulo-2024-cover.jpg` 来自同一视频）

> 开发预览：`?view=video`（仅 DEV）把相机落到约 1.3 m 高、正对前墙视频屏，
> 整车与整块屏都在画面内；
> `preview.html?view=video` 用无车模布景页看同一块屏。`preview.html` 的
> `?view=tools|tires|front|video|under|low|cart|wall|wall-low` 仍用于核对侧视 /
> 后视 / 车底 / 后墙三屏等构图；它不参与构建，只在本地手动打开。

---

### 5.7 升降换模动画（Phase 3.5）

**触发**：底部画质控件（`ui/QualitySwitch.vue`）只抛 `change` 事件，不碰 Three。
只有状态机停在 `idle` 时才允许发起切换；动画期间控件 `disabled`、回调里也会
直接 return，重复点击不排队（两段动画抢同一个台面只会互相打断）。

**状态机**（硬顺序，写在 `App.vue` 的 `SwapPhase`）：

```
idle → descending → closing → loading → opening → rising → success → idle
                  ↘ 加载失败 → error（闸口保持关闭、车停在井底）
```

- `descending`：热点先淡出，台面载着车下沉；行程走到 **50%**（`hologramShowAtProgress`）
  时「车辆切换中」全息开始淡入，不等车辆完全到底；
- `closing`：车完全到底后，两扇地板才从左右伸出合拢，完全盖住升降口；
- `loading`：全息持续显示。进度条是**速度模型**而不是关键帧：每帧朝「软上限 ×
  max(真实下载进度, 时间保底曲线)」推进，速度 = min(上限, 剩余差距 / 响应时间)，
  越接近目标越慢但一直在走（不会硬停在 90%）；模型真正到手的那一刻目标切到 100%，
  用同一套速度模型继续收尾，位置和速度都连续，没有第二段动画的感觉；
- **最短 2s**：`hologramFullAt` 记录全息「完全显示」的时刻（淡入开始 + 淡入时长），
  从这一刻起至少停留 `hologramMinSeconds`（2s）。加载提前完成也要等满再开闸；
- `opening`：进度 100% + 全息满 2s + 模型已挂到井底并渲染两帧，三个条件都满足后
  全息才淡出、闸口才滑开；
- `rising`：门完全让开后停 `riseDelaySeconds`（0.16s），台面再把车托上来；
- `success`：「切换成功」完全出现后固定留存 `successHoldSeconds`（1s），
  淡出后才重新挂载并淡入热点；
- `error` 提供两条路：重试（重新显示全息 → 加载）或返回上一档
  （重新加载原档 → 开闸 → 升起），两条都复用同一段 `finishHologramAndOpen`；
- 换模期间不移动相机：两档模型包围盒一致，视角本来就是对的。

**全息提示为什么是 DOM**：需求要求它固定在展示台前端中心、水平居中、不随相机视角 /
车辆旋转 / 升降台移动而漂移或歪斜，且层级高于闸口和地板。3D 面板活在世界空间里，
屏幕位置必然随相机移动，平贴也会被透视拉斜；`ui/SwapHologram.vue` 用屏幕空间锚定，
天然满足这组约束，同一块面板也用于「切换成功」提示。`config/lift.ts` 只留它的时序参数。

**职责划分**：

| 模块 | 只负责 |
| --- | --- |
| `App.vue` | 状态机 + 进度模拟（真实进度映射 / 最低爬升 / 收尾） |
| `core/LiftStage.ts` | 把某一段动画演完（每段返回 Promise），并调度台面灯 / 井壁导光条 / 扫描光 |
| `ui/SwapHologram.vue` | 全息提示本身：固定定位、进度条、扫描线 / 粒子、成功态、淡入淡出 |
| `ui/SwapActions.vue` | 失败后的可点击 / 可聚焦 / 可读屏操作 |

**几何硬约束**（改数字前先读 `config/lift.ts`）：

- 地坪开口与展台开口共用 `SHOWROOM_CONFIG.floor.opening` / `LIFT_OPENING`，
  两处各写一份数字必然出现台阶或缝；
- 台面顶面 = `plinth.height + topPlateThickness / 2` = 0.11，车模落在 0.10
  （轮胎略陷进台面，和原来的展台一致）；
- 开口 **1.8 × 5.0**：宽只比车宽（1.41）多 0.39，刚好够车进出；再宽就收不进台沿；
- 两扇地板各占开口一半（0.9），滑 **0.94** 进左右各 1.0 的台沿口袋：
  滑开后内边缘到 0.94，让开台面（半宽 0.894），外边缘 1.84 仍在台面板
  （到 1.88）下方，不会从台沿侧面露出来；
- 台面比开口单边小 6 mm，上面压一圈 0.05 宽的深色嵌条盖住接缝；
  台面、地板、展台共用同一组材质参数（颜色 / 粗糙度 / 金属度）；
- 升起结束时强制 `snapRaised()` 把台面吸附到 `surfaceY`，不允许靠浮点动画"差不多对上"；
- 升降 / 闸口动画由 `SceneManager.onFrame` 驱动；全息进度是 DOM 侧唯一的 rAF，
  只在前台推进，不引入动画库。

**加载与内存**：

- 高精度模型按需加载：点击时立刻开始下载，和下降动画并行；
- 旧模型一直留在井底（闸口已遮住它），直到新车挂上同一位置才在同一帧里被替换 / 释放；
  正常视角看不到交接，相机沉到地面以下时也不会露出空井，不会出现「车模突然消失」；
- 新车挂上后在闸口关着时先渲染两帧（完成贴图上传 / 着色器编译），闸口才打开；
  开门瞬间井底已有完整的车，不会「边开门边加载」；
- 加载失败不打开闸口；失败后闸口保持关闭，全息收起，直到重试成功或回滚成功；
- 失败文案来自 `ModelLoader` 抛出的异常，`SwapActions` 展示原始信息。

**热点**：下降开始即 `fade(0, 0.26)` 整体淡出；升起完成、**「切换成功」提示淡出之后**
才重新 `attach` —— `HotspotSystem` 的世界坐标是构造时算好的，台面没归位就重建会错位。

### 5.8 换模动画的验收点

1. 进入页面默认低精度，台面与展台齐平、两扇地板滑在台沿口袋里；
2. 点击高精度：圆点随下降开始淡出，车随台面下沉；
3. 下降到约 50% 时「车辆切换中」全息开始淡入，位置固定居中、不歪斜；
4. 车完全到底后，两扇地板从左右合拢盖住升降口，全程不穿模；
5. 闸口关闭后全息持续显示，进度条按速度模型平滑推进（真实进度 + 时间保底），
   加载完成时目标切到 100% 并连续收尾，不静止、不硬停在某个档位、不跳满；
6. 全息从完全显示起至少 2s；加载提前完成也要等满 2s 再开闸，车在底部等待；
7. 满足条件后全息淡出，闸口向两侧打开，高精度车随台面升起，终点严格齐平、无可见缝；
8. 升起后显示「切换成功」并留存 1s，淡出后才恢复热点标记；
9. 加载失败停住、可重试 / 返回上一档；动画期间点不动切换控件。

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
- 模型压缩（可选，当前未启用）：`.tools/rb22-compressed.glb` 是 10.5 MB 的 Draco + KTX2 版；
  想减体积时接回解码器并换用它，文档 §5.5 有对应说明
- 纹理按需，单张不超过 2048
- 前墙视频屏：66 MB 本地 MP4 懒加载，屏幕进入视锥 0.25s 后才拉流；离开视锥 / 页面隐藏
  立即暂停解码，进度保留；`VideoTexture` 固定 1280×720，不做 4K 解码；控制台面板是 DOM，
  只读写同一个 `<video>`；跟随投影的回调挂在 `SceneManager.onFrame` 上，**没有第二条 rAF**
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

**Phase 1.5（已完成）— 接入 Vue 3 外壳**
- [x] 安装 vue / @vitejs/plugin-vue / vue-tsc，新增 `vite.config.ts`
- [x] `main.ts` 改为 `createApp(App).mount('#app')`，3D 初始化移出入口
- [x] `App.vue`：模板引用 + `onMounted` 装配 SceneManager（作者本人完成）
- [x] 验收：`npm run typecheck` 零错误（`npm run dev` 拖拽验收由作者确认）

**Phase 2（已完成）— 接入真实模型**
- [x] ModelLoader：GLTF 加载（未压缩 PNG 模型）+ 进度 + 包围盒居中缩放 + 相机自动适配
- [x] LoadingBar
- [x] 灯光/环境贴图调优（RoomEnvironment + PMREM，曝光 1.1）
- [x] P 房背景：程序化地坪/墙/灯带/道具 + 雾 + 主光阴影（见 §5.6）
- [x] 画质：贴图各向异性过滤 8 + 可调超采样（`RENDERER_CONFIG.renderScale`）
- [x] 模型换回未压缩版（35.8 MB，PNG 贴图；压缩版留在 `.tools/` 备查）
- [x] 验收：headless 截图确认车模正面 3/4 视角、比例正常、加载进度可见（拖拽手感待作者确认）

**Phase 2.5（进行中）— 展示间布景（方案 B：车队工房）**
- [x] `config/showroom.ts` + `core/Showroom.ts` + `core/props/*` + `core/ProceduralTextures.ts`
- [x] 灯光重做：平行光 → SpotLight 光池、环境压暗、灯带溢光、相机方位/俯仰限位
- [x] 相机改成 360° 自由环绕 + 车底视角（地面/展台跟随相机高度裁剪）、默认取景拉到 padding 0.96（前翼完整入画，0.88 时前翼会被裁掉）
- [x] 地面换成白色无缝环氧地坪（无板缝、低反射），工具车从车右前方挪到后墙右下角
- [x] 发光展台 + 后墙三屏遥测墙（主屏 + 左右副屏）+ 顶部灯桁架 + 轮胎墙（12 只，三色胎圈）
- [x] 主屏顶部 150px 加赛事字标（上海大奖赛 / FORMULA 1 / CHINESE GRAND PRIX · SHANGHAI 2026），填掉桁架安全区的空白；只用字体 + 红色分隔线，不复制官方 logo
- [x] 后墙主屏水平居中、三屏共用垂直中轴；默认机位收到约 22°、取景目标右移 0.6，保证主屏完整、右副屏大半入画
- [x] 车抬到展台面、取景目标上移 0.45（车落到画面下半部，上方留给背墙/桁架）
- [x] 前墙视频大屏（2024 圣保罗大奖赛，本地 `Ver2024.mp4`）：8.18 × 4.6（16:9）；
      静音自动播放 + 循环、懒加载、离开视锥暂停、加载 / 失败海报；
      屏幕加装墙面安装板 / 加厚边框 / 螺钉 / F1 红饰线，下方新增真实 3D 控制台；
      画面不叠标题条 / ticker，播控面板用单应矩阵贴到 3D 台面投影上，
      控制台不是悬浮 HUD，z-index 1 在热点层之下
- [x] 移除旧 B 站 iframe / 旧 2026 上海站前墙视频，前墙只保留本地视频源；
      新增 `?view=video` 开发视角与 `preview.html?view=video` 前墙预览
- [ ] 工具墙重定位：现在它在车侧面，默认机位看不到，只有转到最左侧才入画
- [ ] 陈列柜（头盔/奖杯）/ 推车 / 卷帘门 / 地面导视贴花 / 尘埃粒子
- [ ] 验收：作者在浏览器里确认构图、光比、道具位置

**Phase 3（已完成）— 热点系统**
- [x] Hotspot 类型定义 + `config/hotspots.ts`（8 个热点）
- [x] HotspotSystem：CSS2D 圆点 + 代理球 Raycaster + 点击/拖拽区分 + 背向淡出
- [x] `useHotspots` 桥 + `HotspotCard` 浮窗（投影跟随、防溢出、窄屏抽屉、Esc/空白关闭）
- [x] `?pick` 开发期取点工具（DEV + 动态 import，不进生产包）
- [x] 用 `?pick` 采集 8 个热点的 position / normal 并填回配置（已贴在 Halo、尾翼、前翼、
      轮胎、动力单元、底板、悬挂、车底木地板上）
- [x] 右上角热点总开关：默认开启，关闭后隐藏圆点、停用拾取并收起卡片
- [ ] 验收：点击 Halo 圆点弹卡片、拖拽不误触发、转到背面圆点淡出

**Phase 3.5（当前）— 升降换模动画**
- [x] 展台改成带开口的框架，地坪用 `ShapeGeometry` 挖出升降口（共用 `LIFT_OPENING`）
- [x] `core/LiftStage.ts`：升降台 / 升降井 / 双开舱门 / 灯效 / 分段 Promise 动画
- [x] `ui/SwapHologram.vue`：屏幕空间固定的全息提示（进度模拟 / 扫描线 / 粒子 / 成功态）
- [x] `core/dispose.ts`：展台、升降舞台、车模共用一套 GPU 资源释放
- [x] 热点系统支持整体淡入淡出；切换成功提示结束后才按世界坐标重建
- [x] `App.vue` 多阶段状态机 + 重复点击锁定 + 失败重试 / 返回上一档
- [x] 默认低精度（不再读 localStorage），高精度点击时才按需加载
- [x] `ui/SwapActions.vue` 失败操作条（可点击 / 可聚焦 / 可读屏）
- [ ] 验收：作者在浏览器里确认下降 / 合闸 / 全息 / 升起全流程与接缝
- [ ] 验收：断网或改坏 URL 制造加载失败，确认闸口不打开、重试与回滚都可用

**Phase 4 — 内容与适配**
- [ ] 微调 8 个热点坐标（若贴点不理想，继续用 `?pick`），校对科普文案（初稿已写入配置）
- [ ] 移动端触摸适配、面板响应式
- [x] 错误兜底、加载失败文案（WebGL 2 预检 / 场景初始化失败 / 上下文丢失 / 重新加载）

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
- **RB22**：红牛车队 2026 赛季赛车（新动力单元规则首年，福特合作的动力单元）
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