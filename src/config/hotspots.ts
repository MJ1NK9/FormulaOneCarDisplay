/**
 * 热点数据 —— 唯一数据源。
 *
 * 加一个热点 = 在下面的数组里加一项；不要改 HotspotSystem / App.vue。
 *
 * 坐标怎么来（必须走这一步，不要凭空填）：
 * 1. `npm run dev`，浏览器打开 `http://localhost:5173/?pick`
 * 2. 在车身上点一下要标注的位置，面板会给出 `position` + `normal`
 * 3. 把这两个值粘到对应条目的 [0, 0, 0] 位置，刷新页面确认圆点贴住车身
 *
 * 坐标单位是 GLB 原始单位（车长约 5.4，车头朝 +Z），由 HotspotSystem 换算到场景里，
 * 所以展台高度、归一化缩放怎么改都不会让热点跑位。
 */
import type { Hotspot } from '../types/hotspot';

/** 所有卡片共用的官方出处：FIA 规则库的 F1 分类页（深链 PDF 会随版本失效，这里只给稳定入口） */
const FIA_REGULATIONS: NonNullable<Hotspot['source']> = {
  label: 'FIA 2026 F1 技术规则 · Section C',
  url: 'https://www.fia.com/regulation/category/110',
};

export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'halo',
    label: 'HALO',
    // 车顶 Halo 弧顶中点；法线朝上，正常俯视/环绕都看得见
    position: [0, 0.907, 0.5],
    normal: [0, 1, 0],
    title: 'Halo 头部保护装置',
    summary:
      '座舱正上方那道钛合金弧形护环，2018 年起成为 F1 的强制安全装置。它挡住飞溅的碎片，也能在翻车时撑住车手头顶的空间。',
    specs: [
      { label: '引入', value: '2018 赛季' },
      { label: '材质', value: '钛合金' },
      { label: '性质', value: '强制安全结构' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'rear-wing',
    label: 'REAR WING',
    // 尾翼顶面上表面；法线朝上偏后，从车尾看也不会立刻淡出
    position: [0, 0.974, -2.363],
    normal: [0.548, 0.836, 0.036],
    title: '尾翼',
    summary:
      '车尾最高的一片翼面，把气流向上偏转来制造下压力。2026 规则下它改为主动气动：直道切低阻、弯道切高下压，旧规则的 DRS 已被取代。',
    specs: [
      { label: '作用', value: '产生下压力' },
      { label: '可动部分', value: '主动式翼片' },
      { label: '直道状态', value: '低阻模式' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'front-wing',
    label: 'FRONT WING',
    // 右前翼主翼面上表面（不是在鼻锥上：鼻锥会盖住前翼中心）
    position: [0.55, 0.158, 2.35],
    normal: [0, 1, 0],
    title: '前翼',
    summary:
      '车头最前端的翼片组。它既直接产生前部下压力，也负责把气流分向车身两侧，是整台车气动平台的第一道关口；2026 起同样参与主动气动。',
    specs: [
      { label: '位置', value: '车头前端' },
      { label: '作用', value: '下压力 + 气流导向' },
      { label: '约束', value: '尺寸与形变受规则限制' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'tyre',
    label: 'TYRE',
    // 右前轮外侧胎壁；法线朝外（+X），从默认右前 3/4 视角可见
    position: [0.886, 0.356, 1.53],
    normal: [0.911, -0.125, -0.394],
    title: '轮胎',
    summary:
      '全车唯一接地的部件：加速、制动和转向最终都靠这四块橡胶传到地面。配方越软抓地越强，但工作窗口更窄、寿命更短。',
    specs: [
      { label: '供应商', value: 'Pirelli' },
      { label: '类型', value: '干地光头胎' },
      { label: '状态', value: '需保持在温度窗口内' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'power-unit',
    label: 'POWER UNIT',
    // 引擎盖上表面（座舱后方黄色/红色整流罩的顶部，红牛涂装处）
    position: [0, 1.029, -0.6],
    normal: [0, 1, 0],
    title: '动力单元',
    summary:
      '由 1.6 升 V6 涡轮增压内燃机、能量回收系统与电池组成的混动总成。2026 规则取消了 MGU-H，把回收与部署集中到 MGU-K，并要求使用 100% 可持续燃料。',
    specs: [
      { label: '排量', value: '1.6L V6 涡轮' },
      { label: '组成', value: '内燃机 + 能量回收 + 电池' },
      { label: '燃料', value: '100% 可持续燃料' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'floor',
    label: 'FLOOR',
    // 底板右侧边缘；法线朝外而不是朝下，侧视角也能看到标记（车底视角仍可看）
    position: [0.91, 0.212, 0.748],
    normal: [1, 0, 0],
    title: '底板与地面效应',
    summary:
      '车底那块几乎贴地的碳纤维板。气流从底板边缘进入文丘里通道后被加速，车底形成低压区，把车「吸」向地面——2022 规则回归的核心。',
    specs: [
      { label: '原理', value: '地面效应' },
      { label: '材质', value: '碳纤维' },
      { label: '规则回归', value: '2022 赛季' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'plank',
    label: 'PLANK',
    // 车底正中那块木地板（防滑块）的下表面。法线朝下：默认视角它完全淡出，
    // 只有把镜头沉到车底（OrbitControls 允许）才会亮起来，不会浮在车身上抢注意力
    position: [0, 0.051, 0.2],
    normal: [0, -1, 0],
    title: '木地板 · 防滑块',
    summary:
      '钉在底板正下方的那块 10 毫米厚木复合板。它其实是一把量尺：赛后被 FIA 量厚度，磨掉超过 1 毫米就取消成绩。高速擦过地面时那道火花，来自嵌在板上的钛合金滑块。',
    specs: [
      { label: '材质', value: 'Jabroc 木复合材料' },
      { label: '尺寸', value: '约 300 mm 宽 / 10 mm 厚' },
      { label: '磨损上限', value: '1 mm（1994 年起）' },
    ],
    source: FIA_REGULATIONS,
  },
  {
    id: 'suspension',
    label: 'SUSPENSION',
    // 左前悬挂上叉臂的顶面；从默认视角能看到它跨在车轮与鼻锥之间
    position: [-0.57, 0.445, 1.371],
    normal: [0.047, 0.999, -0.008],
    title: '悬挂',
    summary:
      '把车身和四个车轮连起来的推杆或拉杆结构。它决定轮胎能否在颠簸和侧倾中稳定贴地，同时也要为流经车轮的气流让出通道。',
    specs: [
      { label: '形式', value: '推杆 / 拉杆' },
      { label: '作用', value: '维持轮胎接地' },
      { label: '可调', value: '高度 / 刚度 / 倾角' },
    ],
    source: FIA_REGULATIONS,
  },
];
