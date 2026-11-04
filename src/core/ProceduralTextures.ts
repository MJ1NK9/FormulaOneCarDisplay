/**
 * 程序化贴图：全部用 canvas 现画，不引入图片资源。
 *
 * 为什么不用图片：
 * 1. 赛事大屏这种「有文字、会变」的贴图，用图片就得每次改文案都重新导图；
 * 2. 计时信息需要定时刷新，本来就必须有 canvas 才能重画；
 * 3. 打包体积为 0，改配色只改代码。
 *
 * 注意：canvas 是 sRGB 内容，生成的纹理必须标 `SRGBColorSpace`，
 * 否则会被当成线性数据，颜色整体发灰发暗。
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import verQ3Lap from "../data/ver-2026-shanghai-q3.json";
import type { RoomConfig } from "../config/showroom";

/** 建一块离屏画布并拿到 2D 上下文；拿不到就抛错，避免后面一堆空判断 */
function createCanvas2D(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 2D 画布上下文");
  return { canvas, context };
}

/** 带字距的文字绘制：canvas 的 letterSpacing 兼容性不稳，自己逐字摆更可靠 */
function fillTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right" = "left"
): number {
  const chars = [...text];
  const widths = chars.map(char => context.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + tracking * (chars.length - 1);
  let cursor = align === "center" ? x - total / 2 : align === "right" ? x - total : x;

  // 自己逐字摆位，必须强制左对齐：调用方可能刚设过 textAlign='center'/'right'，
  // 否则每个字都会以 cursor 为右/中基准再偏一次，整行越走越歪。
  const previousAlign = context.textAlign;
  context.textAlign = "left";
  for (const [index, char] of chars.entries()) {
    context.fillText(char, cursor, y);
    cursor += (widths[index] ?? 0) + tracking;
  }
  context.textAlign = previousAlign;

  return total;
}

/**
 * 0~1 的确定性噪声。
 *
 * 屏幕每 1~2 秒重画一次，如果直接用 Math.random，相邻两帧的噪声完全无关，
 * 细小的状态灯/刻度会像雪花一样闪。用 sin 哈希把 seed 映射成稳定值：
 * 同一个 seed 永远得到同一个结果，画面只在真正跨过刷新间隔时变化。
 */
function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 屏幕「上电」遮罩：一条自上而下的扫描线把内容擦亮。
 *
 * 为什么画在 canvas 里，而不是另做一块动画面板：
 * 1. 三块屏各自只有一张贴图，遮罩和内容共用同一次纹理上传，不增加 draw call；
 * 2. 扫描线和展示台灯带 / 全息提示是同一套视觉语言，但它只存在于 3D 贴图中，
 *    不新增 DOM 层级，因此换模动画的层级和时序完全不受影响；
 * 3. 只在启动后 1 秒多内以 30fps 重画，稳定后回到正常刷新频率。
 */
function drawBootReveal(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  accent: string,
  label: string,
  elapsedSeconds: number
): void {
  if (progress >= 1) return;

  context.save();

  const lineY = Math.max(0, Math.min(height, progress * height));
  const feather = 90;

  // 扫描线以上保持完整内容，以下压到近黑；交界处用 90px 渐变过渡，避免一条硬边
  const fade = context.createLinearGradient(0, Math.max(0, lineY - feather), 0, lineY);
  fade.addColorStop(0, "rgba(2, 6, 10, 0)");
  fade.addColorStop(1, "rgba(2, 6, 10, 0.96)");
  context.fillStyle = fade;
  context.fillRect(0, Math.max(0, lineY - feather), width, Math.min(feather, lineY));

  if (lineY < height) {
    context.fillStyle = "rgba(2, 6, 10, 0.96)";
    context.fillRect(0, lineY, width, height - lineY);
  }

  // 扫描带上方的冷光：和展示台井壁导光条同色
  const glow = context.createLinearGradient(0, Math.max(0, lineY - 130), 0, lineY);
  glow.addColorStop(0, "rgba(99, 233, 255, 0)");
  glow.addColorStop(0.82, "rgba(99, 233, 255, 0.14)");
  glow.addColorStop(1, "rgba(190, 250, 255, 0.55)");
  context.fillStyle = glow;
  context.fillRect(0, Math.max(0, lineY - 130), width, Math.min(130, lineY + 1));

  // 扫描头：2px 实线 + 下方 1px 冷光余辉，远看也能认出「正在上电」
  context.fillStyle = "rgba(220, 255, 255, 0.95)";
  context.fillRect(0, lineY - 1, width, 3);
  context.fillStyle = "rgba(99, 233, 255, 0.35)";
  context.fillRect(0, lineY + 4, width, 1);

  // 刚上电的前 30%：少量横向错位线，像信号还没锁定的遥测总线
  if (progress < 0.3) {
    const tick = Math.floor(elapsedSeconds * 24);
    for (let i = 0; i < 3; i++) {
      const y = hash01(tick + i * 3.7) * height;
      const sliceHeight = 2 + hash01(tick + i * 5.1) * 5;
      context.fillStyle = i % 2 === 0 ? "rgba(99, 233, 255, 0.10)" : "rgba(225, 6, 0, 0.10)";
      context.fillRect(0, y, width, sliceHeight);
    }
  }

  // 引导文字跟着扫描头走；最后 10% 淡出，避免和正常画面叠在一起
  if (progress < 0.9) {
    context.globalAlpha = 0.55 * (1 - progress);
    context.fillStyle = accent;
    context.font = '700 18px Consolas, "Courier New", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    fillTracked(context, label, width / 2, lineY + 34, 6, "center");
    context.globalAlpha = 1;
    context.textAlign = "left";
  }

  context.restore();
}

/**
 * 地坪贴图：白色环氧 + 极淡的斑驳 + 细颗粒，**不画板缝**。
 *
 * 为什么和旧版不一样：
 * 1. 旧的深色水泥地靠「板缝」出质感，但白色 P 房环氧地坪本来就是一整片无缝的，
 *    画缝反而一眼假，平铺时还会出现明显的拼接网格；
 * 2. 白色地面最怕两件事——纯色发假、高光发油。所以底色给一点暖灰，
 *    上面叠大块低透明度斑驳和细颗粒，材质那边再把粗糙度拉高；
 * 3. 贴图重复次数压到 2（每片 20 单位），房间可见范围里连贴图边界都看不到。
 */
export function createFloorTexture(floor: RoomConfig["floor"]): CanvasTexture {
  const { size, repeat, mottleCount, noiseDots } = floor.texture;
  const { canvas, context } = createCanvas2D(size, size);

  context.fillStyle = floor.color;
  context.fillRect(0, 0, size, size);

  // 大块斑驳：像地坪漆在灯下深浅不一的云斑，透明度低到只影响质感、不影响颜色
  for (let i = 0; i < mottleCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = size * (0.06 + Math.random() * 0.16);
    const light = Math.random() > 0.45;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, light ? "rgba(255, 255, 255, 0.035)" : "rgba(122, 119, 110, 0.028)");
    gradient.addColorStop(1, light ? "rgba(255, 255, 255, 0)" : "rgba(122, 119, 110, 0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // 细颗粒：远看是均匀的浅灰，近看才有环氧地坪的细微颗粒
  for (let i = 0; i < noiseDots; i++) {
    const alpha = 0.02 + Math.random() * 0.04;
    const dark = Math.random() < 0.55;
    context.fillStyle = dark ? `rgba(92, 89, 82, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    const dot = 1 + Math.random() * 1.4;
    context.fillRect(Math.random() * size, Math.random() * size, dot, dot);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 主屏遥测曲线的一个采样点 */
interface LapSample {
  readonly t: number;
  readonly speed: number;
  readonly rpm: number;
  readonly gear: number;
  readonly throttle: number;
  readonly brake: number;
}

/**
 * 2026 中国大奖赛排位赛 Q3，VER 第 16 圈（1:33.334）的真实遥测。
 *
 * 数据源是 OpenF1（非官方，源头是 F1 live timing），5 Hz 重采样共 467 点。
 * 为什么不用更快的第 19 圈（1:33.002）：那一圈首尾各有 2~4 秒的丢包
 * （F1 数据流的 104 缺失值），画出来会是两段假平线；第 16 圈整圈干净。
 * 主屏展示的是真实数据；左右副屏的 ERS / 胎温没有公开数据源，仍是程序化示意。
 */
const VER_LAP_SAMPLES: readonly LapSample[] = verQ3Lap.samples.map(row => ({
  t: row[0] ?? 0,
  speed: row[1] ?? 0,
  rpm: row[2] ?? 0,
  gear: row[3] ?? 0,
  throttle: row[4] ?? 0,
  brake: row[5] ?? 0
}));

const VER_LAP_TIME = verQ3Lap.lapTime;
const VER_TOP_SPEED = Math.max(...VER_LAP_SAMPLES.map(sample => sample.speed));
const VER_AVG_SPEED = (verQ3Lap.lapDistanceKm / VER_LAP_TIME) * 3600;
const VER_FULL_THROTTLE = (VER_LAP_SAMPLES.filter(sample => sample.throttle >= 99).length / VER_LAP_SAMPLES.length) * 100;

/** 按圈内时间取最近的采样点；循环播放时超出圈速就夹到圈尾 */
function verSampleAt(seconds: number): LapSample {
  const clamped = Math.min(VER_LAP_TIME, Math.max(0, seconds));
  const index = Math.min(VER_LAP_SAMPLES.length - 1, Math.round(clamped / 0.2));
  return VER_LAP_SAMPLES[index] ?? VER_LAP_SAMPLES[0]!;
}

/** 右边成绩榜里的一行 */
interface QualifyingRow {
  readonly position: string;
  readonly code: string;
  readonly gap: string;
  readonly time: number;
}

/**
 * Q3 前十名，成绩来自 F1 官方计时：
 * https://www.formula1.com/en/results/2026/races/1280/china/qualifying
 */
const Q3_CLASSIFICATION: readonly QualifyingRow[] = [
  { position: "1", code: "ANT", gap: "POLE", time: 92.064 },
  { position: "2", code: "RUS", gap: "+0.222", time: 92.286 },
  { position: "3", code: "HAM", gap: "+0.351", time: 92.415 },
  { position: "4", code: "LEC", gap: "+0.364", time: 92.428 },
  { position: "5", code: "PIA", gap: "+0.486", time: 92.55 },
  { position: "6", code: "NOR", gap: "+0.544", time: 92.608 },
  { position: "7", code: "GAS", gap: "+0.809", time: 92.873 },
  { position: "8", code: "VER", gap: "+0.938", time: 93.002 },
  { position: "9", code: "HAD", gap: "+1.057", time: 93.121 },
  { position: "10", code: "BEA", gap: "+1.228", time: 93.292 }
];

/** 88.412 → "1:28.412" */
function formatLap(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/**
 * 主屏顶栏的速度轨迹。
 *
 * 画的是 2026 上海站 Q3 VER 第 16 圈的真实速度曲线（5 Hz，467 点）：
 * 暗线是整圈轮廓，亮线是已经跑过的部分，圆点跟着圈内时间走。
 * 这样不会出现「循环到圈尾跳回圈头」的断线，曲线形状也是真的。
 */
function drawLiveTelemetry(context: CanvasRenderingContext2D, elapsedSeconds: number, x: number, y: number, width: number, height: number): void {
  const lapSeconds = elapsedSeconds % VER_LAP_TIME;
  const speedMin = 60;
  const speedMax = 340;
  const pointAt = (index: number): [number, number] => {
    const sample = VER_LAP_SAMPLES[index] ?? VER_LAP_SAMPLES[0]!;
    return [x + (index / (VER_LAP_SAMPLES.length - 1)) * width, y + height - ((sample.speed - speedMin) / (speedMax - speedMin)) * height];
  };

  context.save();

  // 网格：三条横线 + 四条竖线，透明度压到只作为读数参照
  context.strokeStyle = "rgba(159, 179, 200, 0.10)";
  context.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const gy = y + (height / 2) * i;
    context.beginPath();
    context.moveTo(x, gy);
    context.lineTo(x + width, gy);
    context.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const gx = x + (width / 4) * i;
    context.beginPath();
    context.moveTo(gx, y);
    context.lineTo(gx, y + height);
    context.stroke();
  }

  // 暗线：整圈轮廓，让还没跑到的部分也有形状
  context.beginPath();
  for (let i = 0; i < VER_LAP_SAMPLES.length; i++) {
    const [px, py] = pointAt(i);
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.strokeStyle = "rgba(99, 233, 255, 0.24)";
  context.lineWidth = 1.4;
  context.stroke();

  // 亮线 + 面积：只画到当前圈内时间。裁剪掉右侧，避免再复制一条路径
  const playheadX = x + (lapSeconds / VER_LAP_TIME) * width;
  context.save();
  context.beginPath();
  context.rect(x, y - 2, Math.max(0, playheadX - x), height + 4);
  context.clip();

  const fill = context.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, "rgba(99, 233, 255, 0.22)");
  fill.addColorStop(1, "rgba(99, 233, 255, 0)");
  context.beginPath();
  context.moveTo(x, y + height);
  for (let i = 0; i < VER_LAP_SAMPLES.length; i++) {
    const [px, py] = pointAt(i);
    context.lineTo(px, py);
  }
  context.lineTo(x + width, y + height);
  context.closePath();
  context.fillStyle = fill;
  context.fill();

  context.beginPath();
  for (let i = 0; i < VER_LAP_SAMPLES.length; i++) {
    const [px, py] = pointAt(i);
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.strokeStyle = "#63e9ff";
  context.lineWidth = 2.5;
  context.shadowColor = "rgba(99, 233, 255, 0.8)";
  context.shadowBlur = 8;
  context.stroke();
  context.shadowBlur = 0;
  context.restore();

  // 播放头：圆点落在当前速度上
  const current = verSampleAt(lapSeconds);
  const currentY = y + height - ((current.speed - speedMin) / (speedMax - speedMin)) * height;
  context.fillStyle = "#d9fbff";
  context.beginPath();
  context.arc(playheadX, currentY, 4, 0, Math.PI * 2);
  context.fill();

  context.restore();

  // 读数：速度大字 + 单位，右侧再塞一个 RPM，正好填满环境数据左边的空档
  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "600 16px Arial, sans-serif";
  fillTracked(context, "Q3 TELEMETRY · VER · LAP 16", x, y - 18, 3);
  context.fillStyle = "#f2f6fb";
  context.font = '700 34px Consolas, "Courier New", monospace';
  context.fillText(current.speed.toFixed(1), x + width + 26, y + height * 0.45);
  context.fillStyle = "rgba(159, 179, 200, 0.7)";
  context.font = "500 18px Arial, sans-serif";
  fillTracked(context, "km/h", x + width + 28, y + height * 0.45 + 25, 2);

  context.fillStyle = "rgba(159, 179, 200, 0.52)";
  context.font = "500 15px Arial, sans-serif";
  fillTracked(context, "RPM", x + width + 178, y - 4, 2);
  context.fillStyle = "rgba(232, 238, 247, 0.92)";
  context.font = '700 24px Consolas, "Courier New", monospace';
  context.fillText(`${(current.rpm / 1000).toFixed(1)}k`, x + width + 178, y + 26);
}

/**
 * 屏幕顶部的赛事字标。
 *
 * 顶部 150px 原本是给桁架让出的安全区，空着会像「屏幕没铺满」。
 * 这里用字体 + 红色分隔线做一个同风格的赛事字标，不复制 F1 官方 logo：
 * 中文主标题按展示需求用「上海大奖赛」，下面保留官方英文名 CHINESE GRAND PRIX
 * 和城市 / 年份，字号比例按 2:1 的屏幕高度排，不压到下面的场次栏。
 */
function drawEventWordmark(context: CanvasRenderingContext2D, width: number): void {
  const centerX = width / 2;

  context.save();
  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  context.fillStyle = "rgba(159, 179, 200, 0.55)";
  context.font = "500 16px Arial, sans-serif";
  fillTracked(context, "FORMULA 1", centerX, 38, 12, "center");

  context.fillStyle = "#f2f6fb";
  context.font = '700 64px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
  fillTracked(context, "FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026", centerX, 106, 8, "center");

  // 红色分隔线：中间实、两端渐隐，做出官方字标的「底座」而不是一条硬横线
  const ruleWidth = 560;
  const rule = context.createLinearGradient(centerX - ruleWidth / 2, 0, centerX + ruleWidth / 2, 0);
  rule.addColorStop(0, "rgba(225, 6, 0, 0)");
  rule.addColorStop(0.18, "rgba(225, 6, 0, 0.9)");
  rule.addColorStop(0.82, "rgba(225, 6, 0, 0.9)");
  rule.addColorStop(1, "rgba(225, 6, 0, 0)");
  context.fillStyle = rule;
  context.fillRect(centerX - ruleWidth / 2, 118, ruleWidth, 3);

  context.fillStyle = "rgba(159, 179, 200, 0.72)";
  context.font = "500 17px Arial, sans-serif";
  fillTracked(context, "CHINESE GRAND PRIX · SHANGHAI 2026", centerX, 140, 6, "center");

  context.restore();
}

/**
 * 赛事大屏：整面墙的主视觉，也是「这是 F1 车库」最直接的证据。
 *
 * 内容不是编的：2026 中国大奖赛排位赛 Q3 的真实成绩与遥测。
 * - 成绩：F1 官方计时（https://www.formula1.com/en/results/2026/races/1280/china/qualifying）
 * - 遥测：OpenF1（非官方，源头是 F1 live timing），VER 第 16 圈，5 Hz 重采样
 * - 官方只提供「看」不提供「导」，所以页脚标注了非官方来源，详见 README
 *
 * 版式按 F1 转播画面的惯例分区：
 * - 顶部 150px：赛事字标（上海大奖赛 / CHINESE GRAND PRIX），原本是给桁架留的安全区，
 *   现在用字标填掉空白，同时和下面的场次栏保持距离；
 * - 顶栏：场次、Q3/圈数、实时温湿度、VER 的圈内速度曲线；
 * - 左区：VER Q3 最好成绩 + 本条遥测圈的速度/油门统计 + 遥测圈速；
 * - 右区：Q3 成绩榜（位置、车手、差距、Q3 圈速、轮胎）；
 * - 底栏：车队字样、车号 3、赛会信息、车型年份。
 */
export function createRaceWallTexture(): {
  texture: CanvasTexture;
  draw: (elapsedSeconds: number, bootProgress?: number) => void;
} {
  const W = 2048;
  const H = 1024;
  const { canvas, context } = createCanvas2D(W, H);

  const draw = (elapsedSeconds: number, bootProgress = 1): void => {
    // ── 底 ──
    const background = context.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, "#0a1019");
    background.addColorStop(0.65, "#070b12");
    background.addColorStop(1, "#04070b");
    context.fillStyle = background;
    context.fillRect(0, 0, W, H);

    // 斜纹：涂装的速度线，低透明度
    context.save();
    context.translate(W * 0.5, 0);
    context.rotate(-0.22);
    for (let i = 0; i < 26; i++) {
      context.fillStyle = i % 2 === 0 ? "rgba(225, 6, 0, 0.05)" : "rgba(255, 255, 255, 0.01)";
      context.fillRect(i * 58, -H, 20, H * 2.4);
    }
    context.restore();

    // 车号水印：压在大屏中部偏右，不抢读数
    context.save();
    context.font = '900 760px "Arial Black", Arial, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(225, 6, 0, 0.1)";
    context.fillText("3", W * 0.46, H * 0.62);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(225, 6, 0, 0.22)";
    context.strokeText("3", W * 0.46, H * 0.62);
    context.restore();

    // 顶部赛事字标：填掉桁架安全区上方的空白，同时不压到下面的场次栏
    drawEventWordmark(context, W);

    // ── 顶栏（150 起，避开桁架）──
    context.fillStyle = "#c8102e";
    context.fillRect(0, 150, 300, 120);
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.font = '900 56px "Arial Black", Arial, sans-serif';
    fillTracked(context, "QUALI", 150, 198, 6, "center");
    context.font = "500 20px Arial, sans-serif";
    context.fillStyle = "rgba(255,255,255,0.72)";
    fillTracked(context, "ROUND 2 · 2026", 150, 244, 2, "center");

    context.textAlign = "left";
    context.fillStyle = "#f2f6fb";
    context.font = "800 50px Arial, sans-serif";
    context.fillText("Q3 · LAP 16", 344, 200);
    context.fillStyle = "#3ddc84";
    context.font = "600 23px Arial, sans-serif";
    fillTracked(context, "SOFT TYRE · TRACK CLEAR", 346, 244, 2);

    // 顶栏中段：真实圈速轨迹 + 速度 / RPM 读数
    drawLiveTelemetry(context, elapsedSeconds, 700, 190, 420, 58);

    // 右上环境数据：2026-03-14 15:51 上海站 Q3 的真实读数（OpenF1 weather）。
    // 仍保留极小幅波动，让画面看起来像传感器在采样，但量级不回退成虚构值。
    const environment = [
      { label: "TRACK", value: `${(29.9 + Math.sin(elapsedSeconds * 0.11) * 0.06).toFixed(1)}°C` },
      { label: "AIR", value: `${(17.7 + Math.sin(elapsedSeconds * 0.17 + 1.2) * 0.05).toFixed(1)}°C` },
      { label: "WIND", value: `${(0.7 + Math.sin(elapsedSeconds * 0.23 + 2.1) * 0.05).toFixed(1)} m/s` }
    ];
    for (const [index, item] of environment.entries()) {
      const x = 1420 + index * 210;
      context.textAlign = "left";
      context.fillStyle = "rgba(159,179,200,0.62)";
      context.font = "500 19px Arial, sans-serif";
      fillTracked(context, item.label, x, 194, 3);
      context.fillStyle = "#e8eef7";
      context.font = "700 36px Arial, sans-serif";
      context.fillText(item.value, x, 236);
    }

    // 顶栏分隔线
    context.fillStyle = "rgba(255,255,255,0.09)";
    context.fillRect(0, 270, W, 2);

    // ── 左区：VER Q3 最好成绩 ──
    context.textAlign = "left";
    context.fillStyle = "rgba(159,179,200,0.78)";
    context.font = "700 28px Arial, sans-serif";
    fillTracked(context, "Q3 BEST", 44, 328, 8);

    // VER 在 Q3 第 19 圈跑出的个人最好成绩，不是全场最快（杆位是 ANT 的 1:32.064）
    context.fillStyle = "#f2f6fb";
    context.font = '800 150px Consolas, "Courier New", monospace';
    context.fillText("1:33.002", 36, 476);

    context.fillStyle = "#e8eef7";
    context.font = "700 42px Arial, sans-serif";
    fillTracked(context, "M. VERSTAPPEN", 44, 542, 4);
    context.fillStyle = "rgba(159,179,200,0.7)";
    context.font = "500 26px Arial, sans-serif";
    fillTracked(context, "ORACLE RED BULL RACING · #3 · P8 · +0.938", 44, 584, 3);

    // 三个派生指标：从同一条真实遥测圈里算出来，不是随机数
    const lapStats = [
      { label: "TOP SPEED · KM/H", value: `${Math.round(VER_TOP_SPEED)}`, color: "#63e9ff" },
      { label: "AVG SPEED · KM/H", value: VER_AVG_SPEED.toFixed(1), color: "#3ddc84" },
      { label: "FULL THROTTLE · %", value: VER_FULL_THROTTLE.toFixed(1), color: "#ffd166" }
    ];
    for (const [index, stat] of lapStats.entries()) {
      const x = 44 + index * 372;
      context.fillStyle = "rgba(255,255,255,0.035)";
      context.fillRect(x, 626, 340, 122);
      context.fillStyle = stat.color;
      context.fillRect(x, 626, 340, 4);

      context.fillStyle = "rgba(159,179,200,0.62)";
      context.font = "500 19px Arial, sans-serif";
      fillTracked(context, stat.label, x + 20, 666, 3);

      context.fillStyle = stat.color;
      context.font = '700 52px Consolas, "Courier New", monospace';
      context.fillText(stat.value, x + 18, 722);
    }

    // 底块：这条遥测圈本身（第 16 圈，画面里的曲线就是它）
    context.fillStyle = "rgba(159,179,200,0.62)";
    context.font = "500 21px Arial, sans-serif";
    fillTracked(context, "TELEMETRY LAP · Q3", 44, 800, 5);

    context.fillStyle = "#f2f6fb";
    context.font = '700 78px Consolas, "Courier New", monospace';
    context.fillText(formatLap(VER_LAP_TIME), 40, 876);
    context.fillStyle = "rgba(159,179,200,0.7)";
    context.font = "500 26px Arial, sans-serif";
    fillTracked(context, "LAP 16 · SHANGHAI · 5.451 KM", 470, 850, 3);

    // ── 右区：Q3 成绩榜 ──
    context.fillStyle = "rgba(255,255,255,0.03)";
    context.fillRect(1236, 296, 776, 588);
    context.fillStyle = "rgba(225,6,0,0.7)";
    context.fillRect(1236, 296, 776, 3);

    context.fillStyle = "rgba(159,179,200,0.75)";
    context.font = "700 22px Arial, sans-serif";
    fillTracked(context, "Q3 CLASSIFICATION", 1264, 338, 6);

    context.fillStyle = "rgba(159,179,200,0.45)";
    context.font = '500 19px Consolas, "Courier New", monospace';
    context.fillText("P", 1264, 378);
    context.fillText("DRIVER", 1316, 378);
    context.fillText("GAP", 1600, 378);
    context.fillText("Q3", 1760, 378);

    for (const [index, row] of Q3_CLASSIFICATION.entries()) {
      // 10 行要塞进 588px：行距从 58 收到 50
      const y = 410 + index * 50;
      const isRedBull = row.code === "VER" || row.code === "HAD";

      if (isRedBull) {
        // 两台红牛用红色底 + 左侧竖条标出来，其余行保持斑马纹
        context.fillStyle = "rgba(225,6,0,0.14)";
        context.fillRect(1252, y - 22, 744, 46);
        context.fillStyle = "rgba(225,6,0,0.9)";
        context.fillRect(1252, y - 22, 4, 46);
      } else if (index % 2 === 0) {
        context.fillStyle = "rgba(255,255,255,0.028)";
        context.fillRect(1252, y - 22, 744, 46);
      }

      context.fillStyle = index === 0 ? "#ffffff" : "rgba(232,238,247,0.92)";
      context.font = '700 25px Consolas, "Courier New", monospace';
      context.fillText(row.position, 1264, y);

      context.font = "700 30px Arial, sans-serif";
      context.fillStyle = index === 0 ? "#ffffff" : "rgba(232,238,247,0.88)";
      context.fillText(row.code, 1316, y);

      context.font = '500 24px Consolas, "Courier New", monospace';
      context.fillStyle = "rgba(159,179,200,0.85)";
      context.fillText(row.gap, 1600, y);

      // 第一名那一行圈速用紫色（全场最快），其余是个人最好成绩
      context.fillStyle = index === 0 ? "#c084fc" : "rgba(125,211,168,0.9)";
      context.fillText(formatLap(row.time), 1760, y);

      // Q3 大家都用软胎：保留轮胎点，避免右侧空一块
      context.fillStyle = "#e10600";
      context.beginPath();
      context.arc(1954, y - 8, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#05080e";
      context.font = '700 13px Consolas, "Courier New", monospace';
      context.textAlign = "center";
      context.fillText("S", 1954, y - 7);
      context.textAlign = "left";
    }

    // ── 底栏 ──
    context.fillStyle = "#05080d";
    context.fillRect(0, 900, W, 124);
    context.fillStyle = "rgba(225,6,0,0.85)";
    context.fillRect(0, 900, W, 4);

    context.fillStyle = "#f2f6fb";
    context.font = '900 40px "Arial Black", Arial, sans-serif';
    const brandWidth = fillTracked(context, "RED BULL RACING", 40, 972, 4);
    context.fillStyle = "#e10600";
    context.font = '900 40px "Arial Black", Arial, sans-serif';
    context.fillText("#3", 40 + brandWidth + 26, 972);

    context.fillStyle = "rgba(159,179,200,0.72)";
    context.font = '500 21px Consolas, "Courier New", monospace';
    context.fillText("RACE CONTROL · SESSION LIVE · TRACK CLEAR", 760, 968);

    context.textAlign = "right";
    context.fillStyle = "rgba(159,179,200,0.55)";
    context.font = "600 23px Arial, sans-serif";
    fillTracked(context, "RB22 · 2026 SEASON", W - 40, 968, 3, "right");

    // ── 压暗四周，避免屏幕边缘发亮像贴纸 ──
    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    // 颗粒：压掉大色块的色带
    for (let i = 0; i < 4200; i++) {
      context.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.022})`;
      context.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }

    // 上电遮罩盖在完整内容之上：扫描线以下先压黑，扫过之后才露出画面。
    // progress=1 时直接返回，稳定刷新只剩数据重绘。
    drawBootReveal(context, W, H, bootProgress, "#63e9ff", "QUALIFYING · SYNC", elapsedSeconds);

    texture.needsUpdate = true;
  };

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  // 初始帧就画成「完全未上电」：屏幕进场景时是黑的，再由 update 逐帧擦亮
  draw(0, 0);

  return { texture, draw };
}

/* ───────────────────── 左右副屏：遥测面板 ───────────────────── */

/** 副屏的两种信息角色：左侧能量管理，右侧空气动力学 / 轮胎 */
export type TelemetrySide = "energy" | "aero";

const TELEMETRY_ACCENT = "#63e9ff";
const TELEMETRY_TEXT = "#e8eef7";
const TELEMETRY_MUTED = "rgba(159, 179, 200, 0.62)";
const TELEMETRY_GREEN = "#3ddc84";
const TELEMETRY_AMBER = "#ffcf00";
const TELEMETRY_RED = "#e10600";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 副屏底板：深色渐变 + 极淡网格 + 顶部的冷光，和主屏保持同一套色板 */
function drawSideBackground(context: CanvasRenderingContext2D, width: number, height: number, accent: string): void {
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#08121b");
  background.addColorStop(0.55, "#050c13");
  background.addColorStop(1, "#03070b");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  // 顶部冷光：让边框和标题有一个发光的「接缝」，不是一块死黑
  const glow = context.createRadialGradient(width * 0.5, 0, 0, width * 0.5, 0, width * 0.68);
  glow.addColorStop(0, "rgba(99, 233, 255, 0.11)");
  glow.addColorStop(0.55, `${accent}0d`);
  glow.addColorStop(1, "rgba(99, 233, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height * 0.55);

  // 网格：只作为读数参照，透明度低到不影响文字
  context.strokeStyle = "rgba(159, 179, 200, 0.055)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

/** 副屏的标题栏：编号、标题、LIVE 状态、信号格，底部压一条强调线 */
function drawSideHeader(context: CanvasRenderingContext2D, width: number, code: string, title: string, elapsedSeconds: number): void {
  context.textBaseline = "middle";
  context.textAlign = "left";

  context.fillStyle = TELEMETRY_MUTED;
  context.font = "600 17px Arial, sans-serif";
  fillTracked(context, code, 40, 44, 3);

  context.fillStyle = TELEMETRY_ACCENT;
  context.font = "700 23px Arial, sans-serif";
  fillTracked(context, title, 40, 78, 4);

  // 右上角 LIVE：圆点随刷新节奏轻微呼吸，不是每帧乱闪
  const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3.4));
  context.fillStyle = `rgba(61, 220, 132, ${blink.toFixed(3)})`;
  context.beginPath();
  context.arc(width - 150, 44, 6, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = TELEMETRY_MUTED;
  context.font = '600 16px Consolas, "Courier New", monospace';
  fillTracked(context, "LIVE", width - 132, 44, 3);

  // 三格信号：最右一格偶尔点亮，像总线在收包。
  // 和 LIVE 之间留 12px，避免在 2.4 宽的副屏上糊成一团。
  for (let i = 0; i < 3; i++) {
    const barHeight = 6 + i * 4;
    const active = i < 2 || Math.sin(elapsedSeconds * 1.7) > 0;
    context.fillStyle = active ? TELEMETRY_ACCENT : "rgba(99, 233, 255, 0.16)";
    context.fillRect(width - 76 + i * 9, 48 - barHeight, 5, barHeight);
  }

  context.fillStyle = "rgba(99, 233, 255, 0.62)";
  context.fillRect(40, 104, width - 80, 2);
}

/** 分段条：电池 / 速度 / 小规格共用，点亮格数越多表示数值越高 */
function drawSegmentedBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  color: string,
  cells: number,
  elapsedSeconds: number
): void {
  const gap = 4;
  const cellWidth = (width - gap * (cells - 1)) / cells;
  const litCells = clamp01(ratio) * cells;

  for (let i = 0; i < cells; i++) {
    const lit = i + 0.35 < litCells;
    context.fillStyle = lit ? color : "rgba(159, 179, 200, 0.11)";
    if (lit) {
      // 亮度沿点亮区做一点波动，近看像在导通，远看仍是一条稳定的读数
      context.globalAlpha = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3 + i * 0.45));
    }
    context.fillRect(x + i * (cellWidth + gap), y, cellWidth, height);
    context.globalAlpha = 1;
  }
}

/** 折线图：单条或双条曲线，带网格、面积填充和端点高亮 */
interface TraceSeries {
  readonly values: readonly number[];
  readonly color: string;
  readonly areaColor?: string;
}

function drawTelemetryTrace(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, series: readonly TraceSeries[]): void {
  context.save();

  context.strokeStyle = "rgba(159, 179, 200, 0.10)";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = y + (height / 4) * i;
    context.beginPath();
    context.moveTo(x, gy);
    context.lineTo(x + width, gy);
    context.stroke();
  }
  for (let i = 1; i < 5; i++) {
    const gx = x + (width / 5) * i;
    context.beginPath();
    context.moveTo(gx, y);
    context.lineTo(gx, y + height);
    context.stroke();
  }

  const pointAt = (values: readonly number[], index: number): [number, number] => {
    const step = width / (values.length - 1);
    return [x + step * index, y + height - clamp01(values[index] ?? 0) * height];
  };

  for (const item of series) {
    if (item.values.length < 2) continue;

    if (item.areaColor) {
      context.beginPath();
      context.moveTo(x, y + height);
      for (let i = 0; i < item.values.length; i++) {
        const [px, py] = pointAt(item.values, i);
        context.lineTo(px, py);
      }
      context.lineTo(x + width, y + height);
      context.closePath();
      context.fillStyle = item.areaColor;
      context.fill();
    }

    context.beginPath();
    for (let i = 0; i < item.values.length; i++) {
      const [px, py] = pointAt(item.values, i);
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.strokeStyle = item.color;
    context.lineWidth = 2.4;
    context.shadowColor = item.color;
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;

    const lastIndex = item.values.length - 1;
    const [lastX, lastY] = pointAt(item.values, lastIndex);
    context.fillStyle = "#f2fbff";
    context.beginPath();
    context.arc(lastX, lastY, 4, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

/** 小规格块：一个指标 + 数值 + 迷你分段条 */
function drawStatBlock(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  unit: string,
  ratio: number,
  color: string,
  elapsedSeconds: number
): void {
  context.fillStyle = "rgba(255, 255, 255, 0.032)";
  context.fillRect(x, y, width, 104);
  context.fillStyle = color;
  context.fillRect(x, y, width, 3);

  context.fillStyle = TELEMETRY_MUTED;
  context.font = "600 16px Arial, sans-serif";
  fillTracked(context, label, x + 18, y + 28, 3);

  context.fillStyle = TELEMETRY_TEXT;
  context.font = '700 34px Consolas, "Courier New", monospace';
  const valueWidth = context.measureText(value).width;
  context.fillText(value, x + 18, y + 68);
  context.fillStyle = "rgba(159, 179, 200, 0.72)";
  context.font = "500 15px Arial, sans-serif";
  context.fillText(unit, x + 24 + valueWidth, y + 68);

  drawSegmentedBar(context, x + 18, y + 86, width - 36, 5, ratio, color, 12, elapsedSeconds);
}

/** 轮胎温度块：标签、温度、温度条，颜色按冷 / 正常 / 过热分档 */
function drawTyreBlock(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  corner: string,
  temperature: number,
  color: string,
  elapsedSeconds: number
): void {
  context.fillStyle = "rgba(255, 255, 255, 0.032)";
  context.fillRect(x, y, width, height);
  context.fillStyle = color;
  context.fillRect(x, y, width, 3);

  context.fillStyle = TELEMETRY_MUTED;
  context.font = "700 17px Arial, sans-serif";
  fillTracked(context, corner, x + 16, y + 26, 4);

  context.fillStyle = TELEMETRY_TEXT;
  context.font = '700 42px Consolas, "Courier New", monospace';
  context.fillText(`${Math.round(temperature)}`, x + 14, y + 66);
  const valueWidth = context.measureText(`${Math.round(temperature)}`).width;
  context.fillStyle = color;
  context.font = "700 22px Arial, sans-serif";
  context.fillText("°", x + 18 + valueWidth, y + 66);

  // 温度条压在最底部：和数字之间留 12px，避免分段条从字形下缘穿过去
  drawSegmentedBar(context, x + 14, y + height - 14, width - 28, 5, (temperature - 70) / 40, color, 14, elapsedSeconds);
}

/** 副屏底部：说明文字 + 运行时长，压住最下方的空隙 */
function drawSideFooter(context: CanvasRenderingContext2D, width: number, height: number, elapsedSeconds: number, rightLabel: string): void {
  context.fillStyle = "rgba(99, 233, 255, 0.16)";
  context.fillRect(40, height - 58, width - 80, 1);

  context.fillStyle = "rgba(159, 179, 200, 0.45)";
  context.font = '500 15px Consolas, "Courier New", monospace';
  fillTracked(context, "RB22 · TELEMETRY BUS", 40, height - 36, 2);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = Math.floor(elapsedSeconds % 60);
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  context.textAlign = "right";
  fillTracked(context, `${rightLabel} · T+ ${clock}`, width - 40, height - 36, 2, "right");
  context.textAlign = "left";
}

/**
 * 左右副屏：同一套版式，两种信息角色。
 *
 * - energy：电池 SOC、放电功率、MGU-K / MGU-H、SOC 历史曲线；
 * - aero：地速、速度条、节气门 / 刹车双曲线、四轮胎温、主动空力 / 挡位。
 *
 * 这两块副屏仍是程序化示意：F1 公开数据里没有 ERS 电量、MGU 温度和胎温，
 * 只有主屏那条速度/油门/转速曲线是 2026 上海站的真数据。
 *
 * 两块屏共用背景、标题栏、图表和分段条的绘制函数，只换内容模块，
 * 这样从任何角度看它们都是「同一面墙上的两块辅助屏」，而不是两个风格。
 */
export function createTelemetryScreenTexture(side: TelemetrySide): {
  texture: CanvasTexture;
  draw: (elapsedSeconds: number, bootProgress?: number) => void;
} {
  const W = 1024;
  const H = 768;
  const { canvas, context } = createCanvas2D(W, H);

  const isEnergy = side === "energy";
  const theme = isEnergy ? { code: "AUX 01", title: "ENERGY · ERS" } : { code: "AUX 02", title: "AERO · TYRE" };

  // 数据源：连续时间函数。刷新时取当前值，图上取历史采样，
  // 因此同一帧里的数字和曲线是自洽的，不会出现「读数涨、曲线跌」。
  const socAt = (time: number): number => 84.2 + Math.sin(time * 0.19) * 4.1 + Math.sin(time * 0.83) * 0.9;
  const deployAt = (time: number): number => 72 + Math.sin(time * 0.87) * 14 + Math.sin(time * 2.3) * 5;
  const mgukAt = (time: number): number => 112 + Math.sin(time * 0.44) * 7;
  const mguhAt = (time: number): number => 42000 + Math.sin(time * 0.61) * 1800;
  const fuelAt = (time: number): number => 1.74 + Math.sin(time * 0.25) * 0.09;

  const speedAt = (time: number): number => 309 + Math.sin(time * 0.47) * 7 + Math.sin(time * 1.33) * 3 + Math.sin(time * 3.1) * 1.2;
  const throttleAt = (time: number): number => clamp01(0.52 + 0.38 * Math.sin(time * 0.81) + 0.1 * Math.sin(time * 2.2));
  const brakeAt = (time: number): number => clamp01(0.18 + 0.34 * Math.sin(time * 0.81 + 2.3) + 0.1 * Math.sin(time * 1.9));
  const rpmAt = (time: number): number => 11200 + Math.sin(time * 1.27) * 800 + Math.sin(time * 3.3) * 220;

  const draw = (elapsedSeconds: number, bootProgress = 1): void => {
    const time = elapsedSeconds;

    drawSideBackground(context, W, H, TELEMETRY_ACCENT);
    drawSideHeader(context, W, theme.code, theme.title, time);

    if (isEnergy) {
      // ── 左副屏：能量 / ERS ──
      const soc = socAt(time);
      const deploy = deployAt(time);
      const mguk = mgukAt(time);
      const mguh = mguhAt(time);
      const fuel = fuelAt(time);

      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, "STATE OF CHARGE", 40, 142, 4);

      context.fillStyle = TELEMETRY_TEXT;
      context.font = '800 150px Consolas, "Courier New", monospace';
      context.fillText(`${Math.round(soc)}`, 34, 252);
      context.fillStyle = TELEMETRY_ACCENT;
      context.font = "700 46px Arial, sans-serif";
      context.fillText("%", 254, 250);

      // 电池组：18 串，右侧一格一格点亮
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 15px Arial, sans-serif";
      fillTracked(context, "PACK 01 · 18S", 520, 146, 3);
      drawSegmentedBar(context, 520, 172, 464, 70, soc / 100, TELEMETRY_ACCENT, 18, time);
      context.fillStyle = "rgba(159, 179, 200, 0.48)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      context.fillText("0%", 520, 258);
      context.textAlign = "right";
      context.fillText("100%", 984, 258);
      context.textAlign = "left";

      // 状态行：回收 / 放电
      context.fillStyle = TELEMETRY_GREEN;
      context.beginPath();
      context.arc(46, 306, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(159, 179, 200, 0.78)";
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, "RECOVERY ACTIVE", 60, 306, 3);

      context.fillStyle = TELEMETRY_AMBER;
      context.beginPath();
      context.arc(300, 306, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(159, 179, 200, 0.78)";
      fillTracked(context, `DEPLOY ${deploy.toFixed(1)} kW`, 314, 306, 3);

      // SOC 历史：60s 采样，纵轴只取 78~90，曲线才有起伏
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "SOC HISTORY · 60s", 40, 350, 3);
      context.textAlign = "right";
      context.fillStyle = TELEMETRY_ACCENT;
      context.font = '700 20px Consolas, "Courier New", monospace';
      context.fillText(`${soc.toFixed(1)}%`, 984, 350);
      context.textAlign = "left";

      const socHistory = Array.from({ length: 60 }, (_, index) => clamp01((socAt(time - (59 - index) * 1.1) - 78) / 12));
      drawTelemetryTrace(context, 40, 378, 944, 142, [{ values: socHistory, color: TELEMETRY_ACCENT, areaColor: "rgba(99, 233, 255, 0.14)" }]);

      // 三个小规格：MGU-K / MGU-H / 燃油流量
      drawStatBlock(context, 40, 548, 298, "MGU-K TEMP", `${Math.round(mguk)}`, "°C", mguk / 140, TELEMETRY_RED, time);
      drawStatBlock(context, 363, 548, 298, "MGU-H SPEED", `${(mguh / 1000).toFixed(1)}`, "k rpm", mguh / 50000, TELEMETRY_ACCENT, time);
      drawStatBlock(context, 686, 548, 298, "FUEL FLOW", fuel.toFixed(2), "kg/lap", fuel / 2, TELEMETRY_AMBER, time);

      // 最底一行：把三个状态压成一句话，读屏/远景都能看出总线在跑
      context.fillStyle = "rgba(159, 179, 200, 0.52)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      fillTracked(context, `ERS MODE · ${deploy > 65 ? "DEPLOY" : "HARVEST"}`, 40, 690, 2);
      context.textAlign = "center";
      fillTracked(context, "BATTERY NOMINAL · LINK 04", W / 2, 690, 2);
      context.textAlign = "right";
      context.fillStyle = TELEMETRY_GREEN;
      fillTracked(context, "● SYNCED", W - 40, 690, 2, "right");
      context.textAlign = "left";
    } else {
      // ── 右副屏：空气动力学 / 轮胎 ──
      const speed = speedAt(time);
      const rpm = rpmAt(time);
      const gear = Math.sin(time * 1.27) > 0.45 ? 8 : 7;
      // 2026 没有 DRS：用速度粗判主动空力的直线/弯道模式（副屏本身是示意）
      const aeroStraight = speed > 280;

      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, "GROUND SPEED", 40, 142, 4);

      context.fillStyle = TELEMETRY_TEXT;
      context.font = '800 150px Consolas, "Courier New", monospace';
      context.fillText(`${Math.round(speed)}`, 34, 252);
      context.fillStyle = TELEMETRY_ACCENT;
      context.font = "700 34px Arial, sans-serif";
      context.fillText("km/h", 330, 248);

      // 速度条：0~360 分段，和电池条同一视觉语言
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 15px Arial, sans-serif";
      fillTracked(context, "SPEED · 0—360", 520, 146, 3);
      drawSegmentedBar(context, 520, 172, 464, 70, speed / 360, TELEMETRY_ACCENT, 24, time);
      context.fillStyle = "rgba(159, 179, 200, 0.48)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      context.fillText("0", 520, 258);
      context.textAlign = "center";
      context.fillText("180", 752, 258);
      context.textAlign = "right";
      context.fillText("360", 984, 258);
      context.textAlign = "left";

      // 状态行：主动空力 / 挡位 / 转速
      const aeroColor = aeroStraight ? TELEMETRY_GREEN : TELEMETRY_AMBER;
      context.fillStyle = aeroColor;
      context.beginPath();
      context.arc(46, 306, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(159, 179, 200, 0.78)";
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, aeroStraight ? "AERO STRAIGHT" : "AERO CORNER", 60, 306, 3);
      fillTracked(context, `GEAR ${gear}`, 300, 306, 3);
      fillTracked(context, `RPM ${(rpm / 1000).toFixed(1)}k`, 430, 306, 3);

      // 节气门 / 刹车双曲线：两条线共用 0~1 纵轴，直接可比
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "THROTTLE / BRAKE · 60s", 40, 350, 3);
      context.fillStyle = TELEMETRY_GREEN;
      context.fillRect(700, 344, 18, 3);
      context.fillStyle = "rgba(159, 179, 200, 0.7)";
      context.font = '500 14px Consolas, "Courier New", monospace';
      context.fillText("THROTTLE", 726, 346);
      context.fillStyle = TELEMETRY_RED;
      context.fillRect(840, 344, 18, 3);
      context.fillStyle = "rgba(159, 179, 200, 0.7)";
      context.fillText("BRAKE", 866, 346);

      const throttleHistory = Array.from({ length: 60 }, (_, index) => throttleAt(time - (59 - index) * 1.1));
      const brakeHistory = Array.from({ length: 60 }, (_, index) => brakeAt(time - (59 - index) * 1.1));
      drawTelemetryTrace(context, 40, 378, 944, 142, [
        { values: throttleHistory, color: TELEMETRY_GREEN, areaColor: "rgba(61, 220, 132, 0.10)" },
        { values: brakeHistory, color: TELEMETRY_RED }
      ]);

      // 四轮胎温：FL / FR / RL / RR，按温度分档变色
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "TYRE TEMPS · °C", 40, 552, 3);

      const tyreTemps = [0, 1, 2, 3].map(index => 94 + Math.sin(time * 0.3 + index * 1.3) * 5 + Math.sin(time * 1.7 + index) * 1.5);
      const tyreCorners = ["FL", "FR", "RL", "RR"];
      const tyreColors = tyreTemps.map(temperature => (temperature > 100 ? TELEMETRY_RED : temperature > 95 ? TELEMETRY_AMBER : TELEMETRY_GREEN));
      for (const [index, corner] of tyreCorners.entries()) {
        drawTyreBlock(context, 40 + index * 242, 566, 218, 92, corner, tyreTemps[index]!, tyreColors[index]!, time);
      }

      // 最底一行：气动状态
      context.fillStyle = "rgba(159, 179, 200, 0.52)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      fillTracked(context, `AERO MODE · ${aeroStraight ? "LOW DRAG" : "HIGH DOWNFORCE"}`, 40, 690, 2);
      context.textAlign = "center";
      fillTracked(context, `DOWNFORCE 1.${(38 + Math.floor(hash01(Math.floor(time)) * 12)).toString()}`, W / 2, 690, 2);
      context.textAlign = "right";
      context.fillStyle = TELEMETRY_GREEN;
      fillTracked(context, "● SYNCED", W - 40, 690, 2, "right");
      context.textAlign = "left";
    }

    drawSideFooter(context, W, H, time, isEnergy ? "ERS" : "AERO");

    // 暗角和扫描线：压住四边，补一点 CRT / 工程屏的质感
    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    context.fillStyle = "rgba(0, 0, 0, 0.06)";
    for (let y = 0; y < H; y += 4) {
      context.fillRect(0, y, W, 1);
    }

    // 上电遮罩：和主屏同一套「自上而下扫描」语言，只是标签不同
    drawBootReveal(context, W, H, bootProgress, TELEMETRY_ACCENT, isEnergy ? "ENERGY BUS · LINK" : "AERO BUS · LINK", time);

    texture.needsUpdate = true;
  };

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  draw(0, 0);

  return { texture, draw };
}

/** 穿孔板：工具墙的底板。深色 + 细孔，配合现代工具才有「车队工位」的感觉 */
export function createPegboardTexture(): CanvasTexture {
  const S = 1024;
  const { canvas, context } = createCanvas2D(S, S);

  const background = context.createLinearGradient(0, 0, 0, S);
  background.addColorStop(0, "#171c24");
  background.addColorStop(1, "#0e1218");
  context.fillStyle = background;
  context.fillRect(0, 0, S, S);

  // 孔洞：24px 一格，比原来更密，远看是一层细密纹理
  const step = 24;
  for (let y = step; y < S; y += step) {
    for (let x = step; x < S; x += step) {
      context.fillStyle = "#05070a";
      context.beginPath();
      context.arc(x, y, 3.4, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(255, 255, 255, 0.045)";
      context.beginPath();
      context.arc(x + 1, y + 1, 2.2, 0, Math.PI * 2);
      context.fill();
    }
  }

  // 使用痕迹
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const length = 40 + Math.random() * 200;
    context.strokeStyle = `rgba(255, 255, 255, ${0.008 + Math.random() * 0.02})`;
    context.lineWidth = 1 + Math.random() * 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (Math.random() - 0.5) * 24);
    context.stroke();
  }

  // 边框
  context.strokeStyle = "rgba(0, 0, 0, 0.7)";
  context.lineWidth = 16;
  context.strokeRect(8, 8, S - 16, S - 16);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ───────────────────── 前墙视频展示区占位贴图 ───────────────────── */

/** 视频屏在「真正出画之前的三种状态」，文案和进度条由这里统一绘制 */
export type VideoWallStatus = "standby" | "loading" | "error";

export interface VideoWallPoster {
  readonly texture: CanvasTexture;
  draw(status: VideoWallStatus, progress: number, elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * 前墙视频屏的静态海报 / 加载遮罩。
 *
 * 为什么用 canvas 而不是一张 poster.jpg：
 * 1. 加载态需要进度条和扫描线，它必须能重画；
 * 2. 失败时回退的是同一张海报，只是把状态文案从「正在载入」换成「信号不可用」，
 *    不需要额外下载任何图片，也不会因为海报 404 再失败一次；
 * 3. 版式沿用后墙遥测屏的深色 + 红色分隔线 + 青色曲线，前后墙才像同一间工房。
 *
 * 可选传入同一条视频的封面：封面只作为压暗后的背景，
 * 图片没加载完 / 404 时海报照常工作，不会因此再失败一次。
 *
 * 只在「屏幕可见」时由 videoWall.ts 以约 12fps 重画，默认机位看不到前墙时
 * 这张贴图就是静态的，不产生额外开销。
 */
export function createVideoWallPoster(aspect: number, posterImageUrl?: string): VideoWallPoster {
  const W = 2048;
  // 屏幕是 2:1 时正好 1024；夹住 aspect 防止异常配置把画布拉成极端比例
  const H = Math.max(512, Math.round(W / Math.min(3, Math.max(1, aspect))));
  const { canvas, context } = createCanvas2D(W, H);

  // 封面异步加载，只置一个标志位；不在 onload 里重画——CanvasTexture 需要在外部
  // 显式置 needsUpdate 才会上传，下一次加载态重绘会自然把封面画进去。
  const cover = new Image();
  let coverReady = false;
  if (posterImageUrl) {
    cover.decoding = "async";
    cover.addEventListener(
      "load",
      () => {
        coverReady = cover.naturalWidth > 0 && cover.naturalHeight > 0;
      },
      { once: true },
    );
    cover.src = posterImageUrl;
  }

  const draw = (status: VideoWallStatus, progress: number, elapsedSeconds: number): void => {
    const clampedProgress = clamp01(progress);
    const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;

    const statusText =
      status === "loading"
        ? "正在载入 2024 圣保罗大奖赛…"
        : status === "error"
          ? "视频信号暂不可用"
          : "视频待载入";
    const statusHint =
      status === "loading"
        ? "SÃO PAULO 2024 · VERSTAPPEN · RACE REPLAY"
        : status === "error"
          ? "不影响其他展示与交互，可点控制台播放键重试"
          : "转向车头前方墙壁后自动开始缓冲";
    const feedLabel =
      status === "loading"
        ? "VIDEO FEED · LOADING"
        : status === "error"
          ? "VIDEO FEED · UNAVAILABLE"
          : "VIDEO FEED · READY";

    // ── 底：比后墙遥测屏再深一档，视频画面的黑色电平才不会和背景糊在一起 ──
    const background = context.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, "#080d15");
    background.addColorStop(0.55, "#05090f");
    background.addColorStop(1, "#03060a");
    context.fillStyle = background;
    context.fillRect(0, 0, W, H);

    // 封面作为压暗背景：让加载 / 失败态也像「这条视频」而不是一块通用占位屏。
    // 用 cover 方式裁切，避免 16:9 封面在 2:1 画布上留下左右黑边。
    if (coverReady) {
      const coverScale = Math.max(W / cover.naturalWidth, H / cover.naturalHeight);
      const coverW = cover.naturalWidth * coverScale;
      const coverH = cover.naturalHeight * coverScale;
      context.save();
      context.globalAlpha = status === "error" ? 0.14 : 0.22;
      context.drawImage(cover, (W - coverW) / 2, (H - coverH) / 2, coverW, coverH);
      context.restore();

      const coverScrim = context.createLinearGradient(0, 0, 0, H);
      coverScrim.addColorStop(0, "rgba(4, 7, 12, 0.6)");
      coverScrim.addColorStop(0.55, "rgba(4, 7, 12, 0.72)");
      coverScrim.addColorStop(1, "rgba(2, 4, 8, 0.88)");
      context.fillStyle = coverScrim;
      context.fillRect(0, 0, W, H);
    }

    // 斜向速度线：和主屏同一套涂装语言，透明度压到只在暗部隐约可见
    context.save();
    context.translate(W * 0.54, 0);
    context.rotate(-0.2);
    for (let i = 0; i < 22; i++) {
      context.fillStyle = i % 4 === 0 ? "rgba(225, 6, 0, 0.05)" : "rgba(255, 255, 255, 0.012)";
      context.fillRect(i * 76, -H, 24, H * 2.4);
    }
    context.restore();

    // 车号水印：2024 圣保罗站维斯塔潘是 1 号车，压在右侧，不抢标题
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '900 760px "Arial Black", Arial, sans-serif';
    context.fillStyle = "rgba(225, 6, 0, 0.075)";
    context.fillText("1", W * 0.79, H * 0.57);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(225, 6, 0, 0.13)";
    context.strokeText("1", W * 0.79, H * 0.57);
    context.restore();

    // 四角压暗：屏幕边缘比中心暗，才像一块真正装进墙里的面板
    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.86);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.46)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    // ── 顶栏：赛段与车手信息 ──
    context.fillStyle = "rgba(0, 0, 0, 0.34)";
    context.fillRect(0, 0, W, 120);
    context.fillStyle = "rgba(255, 255, 255, 0.07)";
    context.fillRect(0, 119, W, 1);

    context.fillStyle = "#e10600";
    context.fillRect(64, 38, 6, 44);

    context.textBaseline = "middle";
    context.textAlign = "left";
    context.fillStyle = "#f2f6fb";
    context.font = "800 34px Arial, sans-serif";
    fillTracked(context, "2024 SÃO PAULO GP", 88, 60, 5);

    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "500 18px Arial, sans-serif";
    fillTracked(context, "FORMULA 1 · INTERLAGOS · RACE REPLAY", 88, 92, 3);

    context.textAlign = "right";
    context.fillStyle = "#f2f6fb";
    context.font = "700 28px Arial, sans-serif";
    fillTracked(context, "M. VERSTAPPEN", W - 64, 60, 3, "right");

    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "500 18px Arial, sans-serif";
    fillTracked(context, "#1 · ORACLE RED BULL RACING", W - 64, 92, 2, "right");

    // ── 标题区 ──
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#e10600";
    context.fillRect(64, 250, 120, 8);

    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "600 22px Arial, sans-serif";
    fillTracked(context, "2024 FORMULA 1 · SÃO PAULO GRAND PRIX", 64, 306, 4);

    context.fillStyle = "#f2f6fb";
    context.font = '700 104px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    context.fillText("Where is Max?", 60, 428);

    context.fillStyle = "rgba(207, 216, 227, 0.72)";
    context.font = "600 28px Arial, sans-serif";
    fillTracked(context, "MAX VERSTAPPEN · INTERLAGOS · RACE REPLAY", 66, 482, 4);

    // ── 参考轨迹：只作为海报底纹，不标注成某一圈的真实遥测 ──
    const traceX = 64;
    const traceY = 552;
    const traceWidth = W - 128;
    const traceHeight = 216;
    const speedMin = 60;
    const speedMax = 340;

    context.fillStyle = "rgba(159, 179, 200, 0.5)";
    context.font = "500 16px Arial, sans-serif";
    fillTracked(context, "VIDEO FEED · SIGNAL TRACE · 5 HZ", traceX, traceY - 16, 3);

    context.save();
    context.beginPath();
    VER_LAP_SAMPLES.forEach((sample, index) => {
      const x = traceX + (index / Math.max(1, VER_LAP_SAMPLES.length - 1)) * traceWidth;
      const y = traceY + traceHeight - ((sample.speed - speedMin) / (speedMax - speedMin)) * traceHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "rgba(99, 233, 255, 0.16)";
    context.lineWidth = 2;
    context.stroke();

    const traceFill = context.createLinearGradient(0, traceY, 0, traceY + traceHeight);
    traceFill.addColorStop(0, "rgba(99, 233, 255, 0.05)");
    traceFill.addColorStop(1, "rgba(99, 233, 255, 0)");
    context.lineTo(traceX + traceWidth, traceY + traceHeight);
    context.lineTo(traceX, traceY + traceHeight);
    context.closePath();
    context.fillStyle = traceFill;
    context.fill();
    context.restore();

    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    context.fillRect(traceX, traceY + traceHeight + 1, traceWidth, 1);

    // 加载扫描线：只在 loading 状态出现，12fps 下也足够顺
    if (status === "loading") {
      const scanY = 120 + ((elapsed * 0.22) % 1) * (H - 340);
      context.fillStyle = "rgba(99, 233, 255, 0.06)";
      context.fillRect(0, scanY, W, 3);
      context.fillStyle = "rgba(99, 233, 255, 0.12)";
      context.fillRect(0, scanY + 5, W, 1);
    }

    // ── 底栏：状态 + 进度 ──
    context.fillStyle = "rgba(0, 0, 0, 0.42)";
    context.fillRect(0, H - 190, W, 190);
    context.fillStyle = "rgba(255, 255, 255, 0.07)";
    context.fillRect(0, H - 190, W, 1);

    const iconX = 64;
    const iconY = H - 150;
    const iconSize = 72;

    if (status === "error") {
      context.fillStyle = "rgba(225, 6, 0, 0.18)";
      context.fillRect(iconX, iconY, iconSize, iconSize);
      context.strokeStyle = "#e10600";
      context.lineWidth = 3;
      context.strokeRect(iconX + 1.5, iconY + 1.5, iconSize - 3, iconSize - 3);
      context.fillStyle = "#ffffff";
      context.font = '800 46px Arial, sans-serif';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("!", iconX + iconSize / 2, iconY + iconSize / 2 + 2);
    } else {
      context.fillStyle = "#e10600";
      context.fillRect(iconX, iconY, iconSize, iconSize);
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.moveTo(iconX + 28, iconY + 22);
      context.lineTo(iconX + 28, iconY + 50);
      context.lineTo(iconX + 52, iconY + 36);
      context.closePath();
      context.fill();
    }

    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#f2f6fb";
    context.font = '700 42px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    context.fillText(statusText, 164, H - 108);

    context.fillStyle = "rgba(159, 179, 200, 0.66)";
    context.font = "500 24px Arial, sans-serif";
    context.fillText(statusHint, 164, H - 70);

    // 右侧：信号状态 + 百分比 + 进度条
    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "600 20px Arial, sans-serif";
    fillTracked(context, feedLabel, 1180, H - 112, 3);

    const percentText =
      status === "error"
        ? "OFFLINE"
        : status === "standby"
          ? "STANDBY"
          : clampedProgress > 0.01
            ? `${Math.round(clampedProgress * 100)}%`
            : "BUFFER";
    context.textAlign = "right";
    context.fillStyle = status === "error" ? "#e10600" : "#f2f6fb";
    context.font = '700 34px Consolas, "Courier New", monospace';
    context.fillText(percentText, W - 64, H - 108);

    const barX = 1180;
    const barY = H - 82;
    const barWidth = W - 64 - barX;
    const barHeight = 8;

    context.fillStyle = "rgba(255, 255, 255, 0.16)";
    context.fillRect(barX, barY, barWidth, barHeight);

    if (status === "loading") {
      if (clampedProgress > 0.01) {
        context.fillStyle = "#e10600";
        context.fillRect(barX, barY, barWidth * clampedProgress, barHeight);
        context.fillStyle = "rgba(255, 160, 160, 0.9)";
        context.fillRect(barX + barWidth * clampedProgress - 2, barY - 2, 3, barHeight + 4);
      } else {
        // 没有 buffered 信息时用一段来回扫的红色指示，而不是一条永远不动的空槽
        const sweep = (elapsed * 0.45) % 1;
        const sweepWidth = 200;
        const sweepX = barX + sweep * (barWidth + sweepWidth) - sweepWidth;
        const left = Math.max(barX, sweepX);
        const right = Math.min(barX + barWidth, sweepX + sweepWidth);
        if (right > left) {
          context.fillStyle = "rgba(225, 6, 0, 0.85)";
          context.fillRect(left, barY, right - left, barHeight);
        }
      }
    }

    // 取景框角标：像一块接进转播系统的监看屏
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.lineWidth = 2;
    const inset = 26;
    const length = 46;
    const corners: readonly [number, number, number, number, number, number][] = [
      [inset, inset + length, inset, inset, inset + length, inset],
      [W - inset - length, inset, W - inset, inset, W - inset, inset + length],
      [inset, H - inset - length, inset, H - inset, inset + length, H - inset],
      [W - inset - length, H - inset, W - inset, H - inset, W - inset, H - inset - length]
    ];
    for (const [x1, y1, x2, y2, x3, y3] of corners) {
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.lineTo(x3, y3);
      context.stroke();
    }
  };

  draw("standby", 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  return {
    texture,
    draw,
    dispose: () => texture.dispose()
  };
}
