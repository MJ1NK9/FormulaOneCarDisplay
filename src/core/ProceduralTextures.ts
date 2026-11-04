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
import raceTelemetryJson from "../data/ver-2024-sao-paulo-race.json";
import { RACE_REPLAY_CONFIG } from "../config/raceReplay";
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

/* ───────────────────── 2024 圣保罗正赛后墙回放 ───────────────────── */

/**
 * 主屏 + 左右副屏共用的一份「比赛回放」状态。
 *
 * 数据来自 OpenF1 的 2024 圣保罗正赛（session_key 9636）：
 * 官方分类 69 圈，展示上补到原定的 71 圈，第 70、71 圈没有遥测，
 * 用红旗占位各停 4s。时间轴常量在 `config/raceReplay.ts`。
 *
 * 为什么把圈数 / 播放头 / 完赛状态放在这里统一算：
 * 三块屏各自只有一张 canvas 贴图，刷新时刻也略有差异；只要它们都从
 * 同一个 `elapsedSeconds` 推同一份状态，就不会出现主屏第 12 圈、副屏第 11 圈。
 */

/** 一行遥测：[圈内秒, km/h, rpm, 挡位, 油门%, 刹车%] */
type RaceSampleRow = readonly [number, number, number, number, number, number];

/** 全场级状态；局部黄旗不改变整圈状态，避免把普通圈误标成黄旗 */
type RaceFlag = "GREEN" | "VSC" | "SC" | "RED" | "CHEQUERED";

interface RaceWeather {
  readonly air: number;
  readonly track: number;
  readonly wind: number;
}

interface RaceLap {
  readonly lap: number;
  /** 官方圈速；70、71 圈没有跑，值为 null */
  readonly time: number | null;
  readonly sectors: readonly [number, number, number] | null;
  readonly position: number;
  readonly flag: RaceFlag;
  readonly topSpeed: number | null;
  readonly avgSpeed: number | null;
  readonly fullThrottle: number | null;
  readonly weather: RaceWeather;
  readonly redFlag: boolean;
  readonly suspendedSeconds: number;
  readonly samples: readonly RaceSampleRow[];
}

interface RaceTelemetry {
  readonly driver: string;
  readonly driverName: string;
  readonly team: string;
  readonly carNumber: number;
  readonly event: string;
  readonly eventOfficialName: string;
  readonly eventName: string;
  readonly session: string;
  readonly round: number;
  readonly date: string;
  readonly dateLabel: string;
  readonly circuit: string;
  readonly location: string;
  readonly laps: number;
  readonly classifiedLaps: number;
  readonly scheduledLaps: number;
  readonly lapDistanceKm: number;
  readonly raceDistanceKm: number;
  readonly classifiedDistanceKm: number;
  readonly sampleRateHz: number;
  readonly source: string;
  readonly sessionKey: number;
  readonly grid: number;
  readonly finishPosition: number;
  readonly finishTimeSeconds: number;
  readonly points: number;
  readonly lapList: readonly RaceLap[];
}

const RACE = raceTelemetryJson as unknown as RaceTelemetry;
const RACE_LAPS = RACE.lapList.length;
const RACE_LAP_SECONDS = RACE_REPLAY_CONFIG.lapSeconds;
const RACE_LAP_LABEL = Number.isInteger(RACE_LAP_SECONDS) ? `${RACE_LAP_SECONDS}S` : `${RACE_LAP_SECONDS.toFixed(1)}S`;
const RACE_RACE_SECONDS = RACE_LAPS * RACE_LAP_SECONDS;
const RACE_CYCLE_SECONDS = RACE_RACE_SECONDS + RACE_REPLAY_CONFIG.finishHoldSeconds;
const EMPTY_SAMPLE: RaceSampleRow = [0, 0, 0, 0, 0, 0];

/** 每个圈位对应的「到这一圈为止的个人最快圈」，右副屏的 Δ 直接用 */
const BEST_LAP_BY_INDEX: readonly (number | null)[] = (() => {
  let best: number | null = null;
  return RACE.lapList.map(lap => {
    if (!lap.redFlag && lap.time !== null) {
      best = best === null ? lap.time : Math.min(best, lap.time);
    }
    return best;
  });
})();

/** 88.412 → "1:28.412" */
function formatLap(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/** 7614.43 → "2:06:54.430" */
function formatRaceTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

function formatSector(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "—" : seconds.toFixed(3);
}

function lapTelemetrySeconds(lap: RaceLap): number {
  return lap.samples[lap.samples.length - 1]?.[0] ?? 0;
}

/** 取圈内最近的采样点；用于大字速度 / 油门 / 刹车读数 */
function sampleAt(lap: RaceLap, seconds: number): RaceSampleRow {
  const samples = lap.samples;
  if (samples.length === 0) return EMPTY_SAMPLE;

  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((samples[middle]?.[0] ?? 0) < seconds) low = middle + 1;
    else high = middle;
  }

  const current = samples[low] ?? EMPTY_SAMPLE;
  const previous = samples[Math.max(0, low - 1)] ?? EMPTY_SAMPLE;
  return Math.abs((previous[0] ?? 0) - seconds) <= Math.abs((current[0] ?? 0) - seconds)
    ? previous
    : current;
}

function flagColor(flag: RaceFlag): string {
  switch (flag) {
    case "RED":
      return "#e10600";
    case "SC":
    case "VSC":
      return "#ffcf00";
    case "CHEQUERED":
      return "#f2f6fb";
    default:
      return "#3ddc84";
  }
}

function flagLabel(flag: RaceFlag): string {
  switch (flag) {
    case "RED":
      return "RED FLAG";
    case "SC":
      return "SAFETY CAR";
    case "VSC":
      return "VIRTUAL SAFETY CAR";
    case "CHEQUERED":
      return "CHEQUERED";
    default:
      return "GREEN FLAG";
  }
}

/** 日志里的圈速列：红旗圈不显示 25:56 这种「假圈速」，直接写 RED FLAG */
function lapTimeLabel(lap: RaceLap): string {
  if (lap.redFlag || lap.time === null) return "RED FLAG";
  return formatLap(lap.time);
}

interface ReplayState {
  readonly phase: "race" | "finish";
  readonly lapIndex: number;
  readonly lap: RaceLap;
  readonly progress: number;
  readonly dataSeconds: number;
}

/**
 * 把「页面运行了多少秒」映射成「第几圈、圈内进度」。
 *
 * 上电扫描 1.5s 后发车；69 圈真实数据 + 2 圈红旗占位各 4s；
 * 跑完后定格 5s，再从头循环。所有屏都调用这一个函数，状态天然一致。
 */
function replayStateAt(elapsedSeconds: number): ReplayState {
  const local = Math.max(0, elapsedSeconds - RACE_REPLAY_CONFIG.startDelaySeconds);
  const cycleTime = local % RACE_CYCLE_SECONDS;

  if (cycleTime >= RACE_RACE_SECONDS) {
    const lap = RACE.lapList[RACE_LAPS - 1] ?? RACE.lapList[0]!;
    return {
      phase: "finish",
      lapIndex: RACE_LAPS - 1,
      lap,
      progress: 1,
      dataSeconds: lapTelemetrySeconds(lap),
    };
  }

  const lapIndex = Math.min(RACE_LAPS - 1, Math.floor(cycleTime / RACE_LAP_SECONDS));
  const progress = (cycleTime - lapIndex * RACE_LAP_SECONDS) / RACE_LAP_SECONDS;
  const lap = RACE.lapList[lapIndex] ?? RACE.lapList[0]!;
  return {
    phase: "race",
    lapIndex,
    lap,
    progress,
    dataSeconds: progress * lapTelemetrySeconds(lap),
  };
}

/* ── 折线图：整圈轮廓 + 已跑亮线 + 播放头 ── */

interface SweepSeries {
  readonly values: readonly number[];
  readonly color: string;
  readonly areaColor?: string;
}

interface SweepOptions {
  readonly grid?: boolean;
  readonly lineWidth?: number;
  readonly shadowBlur?: number;
  readonly dots?: boolean;
}

function drawSweptTrace(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  sampleTimes: readonly number[],
  series: readonly SweepSeries[],
  duration: number,
  seconds: number,
  options: SweepOptions = {},
): void {
  if (sampleTimes.length < 2 || duration <= 0) return;

  const safeDuration = Math.max(0.001, duration);
  const clampedSeconds = Math.min(safeDuration, Math.max(0, seconds));
  const pointX = (time: number): number =>
    x + (Math.min(safeDuration, Math.max(0, time)) / safeDuration) * width;
  const pointY = (value: number): number => y + height - clamp01(value) * height;

  // 网格只作为读数参照，透明度压到不影响曲线
  if (options.grid ?? true) {
    context.strokeStyle = "rgba(159, 179, 200, 0.10)";
    context.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gridY = y + (height / 4) * i;
      context.beginPath();
      context.moveTo(x, gridY);
      context.lineTo(x + width, gridY);
      context.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const gridX = x + (width / 5) * i;
      context.beginPath();
      context.moveTo(gridX, y);
      context.lineTo(gridX, y + height);
      context.stroke();
    }
  }

  let lastIndex = 0;
  for (let i = 0; i < sampleTimes.length; i++) {
    if ((sampleTimes[i] ?? 0) <= clampedSeconds) lastIndex = i;
    else break;
  }
  const playheadX = pointX(clampedSeconds);

  for (const item of series) {
    // 暗线：整圈轮廓，让还没跑到的部分也有形状
    context.beginPath();
    for (let i = 0; i < sampleTimes.length; i++) {
      const px = pointX(sampleTimes[i] ?? 0);
      const py = pointY(item.values[i] ?? 0);
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.strokeStyle = item.color;
    context.globalAlpha = 0.22;
    context.lineWidth = 1.4;
    context.stroke();
    context.globalAlpha = 1;

    // 亮线 + 面积：裁剪到播放头左侧，避免再复制一条完整路径
    context.save();
    context.beginPath();
    context.rect(x, y - 2, Math.max(0, playheadX - x), height + 4);
    context.clip();

    if (item.areaColor && lastIndex > 0) {
      context.beginPath();
      context.moveTo(pointX(sampleTimes[0] ?? 0), y + height);
      for (let i = 0; i <= lastIndex; i++) {
        context.lineTo(pointX(sampleTimes[i] ?? 0), pointY(item.values[i] ?? 0));
      }
      context.lineTo(playheadX, y + height);
      context.closePath();
      context.fillStyle = item.areaColor;
      context.fill();
    }

    context.beginPath();
    for (let i = 0; i <= lastIndex; i++) {
      const px = pointX(sampleTimes[i] ?? 0);
      const py = pointY(item.values[i] ?? 0);
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.strokeStyle = item.color;
    context.lineWidth = options.lineWidth ?? 2.4;
    context.shadowColor = item.color;
    context.shadowBlur = options.shadowBlur ?? 7;
    context.stroke();
    context.shadowBlur = 0;
    context.restore();

    // 播放头：落在当前读数上，4s 扫完整圈
    if (options.dots ?? true) {
      context.fillStyle = "#f2fbff";
      context.beginPath();
      context.arc(
        pointX(sampleTimes[lastIndex] ?? 0),
        pointY(item.values[lastIndex] ?? 0),
        4,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
}

/** 速度曲线：纵轴固定 40–340 km/h，和主屏 / 左副屏保持同一把尺 */
function speedTrace(lap: RaceLap): { times: readonly number[]; series: readonly SweepSeries[] } {
  const times = lap.samples.map(sample => sample[0]);
  const values = lap.samples.map(sample => ((sample[1] ?? 0) - 40) / 300);
  return {
    times,
    series: [{ values, color: "#63e9ff", areaColor: "rgba(99, 233, 255, 0.12)" }],
  };
}

/** 油门 / 刹车曲线：纵轴 0–100%，两条线共用，直接可比 */
function inputTrace(lap: RaceLap): { times: readonly number[]; series: readonly SweepSeries[] } {
  const times = lap.samples.map(sample => sample[0]);
  return {
    times,
    series: [
      {
        values: lap.samples.map(sample => (sample[4] ?? 0) / 100),
        color: "#3ddc84",
        areaColor: "rgba(61, 220, 132, 0.08)",
      },
      { values: lap.samples.map(sample => (sample[5] ?? 0) / 100), color: "#e10600" },
    ],
  };
}

/* ── 主屏 ── */

/**
 * 赛事字标：顶部 150px 原本是给桁架让出的安全区，空着会像屏幕没铺满。
 * 只做字体 + 红色分隔线，不复制 F1 官方 logo。
 */
function drawRaceWordmark(context: CanvasRenderingContext2D, width: number): void {
  const centerX = width / 2;

  context.save();
  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  context.fillStyle = "rgba(159, 179, 200, 0.55)";
  context.font = "500 16px Arial, sans-serif";
  fillTracked(context, "FORMULA 1", centerX, 38, 12, "center");

  context.fillStyle = "#f2f6fb";
  context.font = '700 56px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
  fillTracked(context, RACE.eventOfficialName, centerX, 104, 5, "center");

  const ruleWidth = 640;
  const rule = context.createLinearGradient(centerX - ruleWidth / 2, 0, centerX + ruleWidth / 2, 0);
  rule.addColorStop(0, "rgba(225, 6, 0, 0)");
  rule.addColorStop(0.18, "rgba(225, 6, 0, 0.9)");
  rule.addColorStop(0.82, "rgba(225, 6, 0, 0.9)");
  rule.addColorStop(1, "rgba(225, 6, 0, 0)");
  context.fillStyle = rule;
  context.fillRect(centerX - ruleWidth / 2, 118, ruleWidth, 3);

  context.fillStyle = "rgba(159, 179, 200, 0.72)";
  context.font = "500 17px Arial, sans-serif";
  fillTracked(context, `${RACE.location.toUpperCase()} · ${RACE.dateLabel}`, centerX, 142, 6, "center");

  context.restore();
}

function drawStatusChip(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  flag: RaceFlag,
  elapsedSeconds: number,
): void {
  const color = flagColor(flag);
  // 红旗呼吸是唯一会闪的状态：画面上要有「比赛暂停」的直觉
  const alpha = flag === "RED" ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 5.2)) : 1;
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y - 7, 7, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = "rgba(232, 238, 247, 0.9)";
  context.font = "600 21px Arial, sans-serif";
  fillTracked(context, flagLabel(flag), x + 18, y, 2);
}

function drawRaceTopBar(
  context: CanvasRenderingContext2D,
  width: number,
  state: ReplayState,
  finish: boolean,
  elapsedSeconds: number,
): void {
  const lap = state.lap;

  context.fillStyle = "#c8102e";
  context.fillRect(0, 150, 300, 120);
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.font = '900 56px "Arial Black", Arial, sans-serif';
  fillTracked(context, "RACE", 150, 198, 6, "center");
  context.font = "500 20px Arial, sans-serif";
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  fillTracked(context, `ROUND ${RACE.round} · ${RACE.date.slice(0, 4)}`, 150, 244, 2, "center");

  context.textAlign = "left";
  context.fillStyle = "#f2f6fb";
  context.font = "800 50px Arial, sans-serif";
  context.fillText(`LAP ${String(lap.lap).padStart(2, "0")} / ${RACE_LAPS}`, 344, 200);

  drawStatusChip(context, 346, 244, finish ? "CHEQUERED" : lap.flag, elapsedSeconds);

  // 中段空档放赛事距离 / 分类信息，避免像缺一块
  context.fillStyle = "rgba(232, 238, 247, 0.9)";
  context.font = '600 24px Consolas, "Courier New", monospace';
  context.fillText(`${RACE.raceDistanceKm.toFixed(1)} KM · ${RACE_LAPS} LAPS`, 760, 194);
  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "500 18px Arial, sans-serif";
  fillTracked(
    context,
    `CLASSIFIED ${RACE.classifiedLaps} LAPS · OPENF1`,
    760,
    230,
    2,
  );

  const environment = [
    { label: "TRACK", value: `${lap.weather.track.toFixed(1)}°C` },
    { label: "AIR", value: `${lap.weather.air.toFixed(1)}°C` },
    { label: "WIND", value: `${lap.weather.wind.toFixed(1)} m/s` },
  ];
  for (const [index, item] of environment.entries()) {
    const x = 1440 + index * 200;
    context.textAlign = "left";
    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "500 18px Arial, sans-serif";
    fillTracked(context, item.label, x, 194, 3);
    context.fillStyle = "#e8eef7";
    context.font = "700 31px Arial, sans-serif";
    context.fillText(item.value, x, 236);
  }

  context.fillStyle = "rgba(255, 255, 255, 0.09)";
  context.fillRect(0, 270, width, 2);
}

function drawCurrentLapPanel(
  context: CanvasRenderingContext2D,
  state: ReplayState,
  displayLap: RaceLap,
  finish: boolean,
): void {
  const lap = state.lap;
  const position = finish ? RACE.finishPosition : lap.position;

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "rgba(159, 179, 200, 0.78)";
  context.font = "700 26px Arial, sans-serif";
  fillTracked(context, "CURRENT LAP", 44, 328, 8);

  // 大号圈数：这是「一圈圈加」最直接的读数
  const lapText = String(lap.lap).padStart(2, "0");
  context.fillStyle = "#f2f6fb";
  context.font = '800 150px Consolas, "Courier New", monospace';
  context.fillText(lapText, 36, 476);
  const lapWidth = context.measureText(lapText).width;
  context.fillStyle = "rgba(159, 179, 200, 0.7)";
  context.font = '700 48px Consolas, "Courier New", monospace';
  context.fillText(`/ ${RACE_LAPS}`, 36 + lapWidth + 18, 476);

  // 圈速 / 红旗 / 完赛三种状态共用同一块位置，避免版式跳动
  if (finish) {
    context.fillStyle = "#3ddc84";
    context.font = '800 92px Arial, sans-serif';
    context.fillText("FINISH", 40, 584);
    context.fillStyle = "#f2f6fb";
    context.font = '700 40px Consolas, "Courier New", monospace';
    context.fillText(formatRaceTime(RACE.finishTimeSeconds), 44, 636);
  } else if (lap.redFlag) {
    context.fillStyle = "#e10600";
    context.font = '800 88px Arial, sans-serif';
    context.fillText("RED FLAG", 40, 584);
    context.fillStyle = "rgba(232, 238, 247, 0.9)";
    context.font = "600 27px Arial, sans-serif";
    fillTracked(
      context,
      lap.lap <= RACE.classifiedLaps
        ? `RACE SUSPENDED · ${formatLap(lap.time ?? 0)}`
        : `RACE ENDED · OFFICIAL ${RACE.classifiedLaps} LAPS`,
      44,
      634,
      2,
    );
  } else {
    context.fillStyle = "#f2f6fb";
    context.font = '800 88px Consolas, "Courier New", monospace';
    context.fillText(formatLap(lap.time ?? 0), 36, 596);
  }

  // 名次块：P17 → P1 是这场比赛的故事线
  context.fillStyle = "rgba(6, 10, 16, 0.72)";
  context.fillRect(760, 500, 360, 132);
  context.fillStyle = "#e10600";
  context.fillRect(760, 500, 360, 4);
  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "600 18px Arial, sans-serif";
  fillTracked(context, "POSITION", 780, 534, 4);
  context.fillStyle = "#f2f6fb";
  context.font = '800 86px Consolas, "Courier New", monospace';
  context.fillText(`P${position}`, 780, 610);
  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "500 16px Arial, sans-serif";
  fillTracked(context, `GRID P${RACE.grid} · FINISH P${RACE.finishPosition}`, 780, 646, 2);

  context.fillStyle = "#e8eef7";
  context.font = "700 38px Arial, sans-serif";
  fillTracked(context, "M. VERSTAPPEN", 44, 700, 4);
  context.fillStyle = "rgba(159, 179, 200, 0.7)";
  context.font = "500 22px Arial, sans-serif";
  fillTracked(context, `${RACE.team.toUpperCase()} · #${RACE.carNumber}`, 44, 730, 3);

  const stats = [
    {
      label: "TOP SPEED · KM/H",
      value: displayLap.redFlag || displayLap.topSpeed === null ? "—" : `${Math.round(displayLap.topSpeed)}`,
      color: "#63e9ff",
    },
    {
      label: "AVG SPEED · KM/H",
      value: displayLap.redFlag || displayLap.avgSpeed === null ? "—" : displayLap.avgSpeed.toFixed(1),
      color: "#3ddc84",
    },
    {
      label: "FULL THROTTLE · %",
      value: displayLap.redFlag || displayLap.fullThrottle === null ? "—" : displayLap.fullThrottle.toFixed(1),
      color: "#ffd166",
    },
  ];
  for (const [index, stat] of stats.entries()) {
    const x = 44 + index * 372;
    context.fillStyle = "rgba(6, 10, 16, 0.72)";
    context.fillRect(x, 746, 340, 96);
    context.fillStyle = stat.color;
    context.fillRect(x, 746, 340, 4);
    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "500 17px Arial, sans-serif";
    fillTracked(context, stat.label, x + 20, 778, 3);
    context.fillStyle = stat.color;
    context.font = '700 44px Consolas, "Courier New", monospace';
    context.fillText(stat.value, x + 18, 826);
  }

  // 三段用时：和圈速同一行读数，红旗 / 缺失圈显示破折号
  const sectorLabels = ["S1", "S2", "S3"];
  for (const [index, label] of sectorLabels.entries()) {
    const x = 44 + index * 260;
    context.fillStyle = "rgba(159, 179, 200, 0.55)";
    context.font = "600 17px Arial, sans-serif";
    fillTracked(context, label, x, 872, 3);
    context.fillStyle = "rgba(232, 238, 247, 0.9)";
    context.font = '600 27px Consolas, "Courier New", monospace';
    context.fillText(formatSector(displayLap.sectors?.[index]), x + 38, 872);
  }
}

function drawLapLog(context: CanvasRenderingContext2D, currentIndex: number): void {
  const rows = 5;
  const first = Math.max(0, currentIndex - (rows - 1));
  const rowHeight = 36;
  const top = 636;

  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "700 18px Arial, sans-serif";
  fillTracked(context, "LAP LOG · LATEST 5", 1264, 614, 5);
  context.textAlign = "right";
  fillTracked(context, "POS", 1984, 614, 4, "right");
  context.textAlign = "left";

  for (let index = first; index <= currentIndex; index++) {
    const lap = RACE.lapList[index];
    if (!lap) continue;
    const rowY = top + (index - first) * rowHeight;
    const isCurrent = index === currentIndex;

    if (isCurrent) {
      context.fillStyle = "rgba(225, 6, 0, 0.14)";
      context.fillRect(1252, rowY, 744, rowHeight - 2);
      context.fillStyle = "rgba(225, 6, 0, 0.9)";
      context.fillRect(1252, rowY, 4, rowHeight - 2);
    } else if (index % 2 === 0) {
      context.fillStyle = "rgba(255, 255, 255, 0.025)";
      context.fillRect(1252, rowY, 744, rowHeight - 2);
    }

    context.fillStyle = isCurrent ? "#ffffff" : "rgba(232, 238, 247, 0.72)";
    context.font = '700 23px Consolas, "Courier New", monospace';
    context.fillText(String(lap.lap).padStart(2, "0"), 1264, rowY + 25);

    context.fillStyle = lap.redFlag ? "#e10600" : isCurrent ? "#f2f6fb" : "rgba(232, 238, 247, 0.82)";
    context.font = lap.redFlag ? "700 18px Arial, sans-serif" : '500 22px Consolas, "Courier New", monospace';
    context.fillText(lapTimeLabel(lap), 1320, rowY + 25);

    context.textAlign = "right";
    context.fillStyle = isCurrent ? "#ffffff" : "rgba(159, 179, 200, 0.8)";
    context.font = '600 21px Consolas, "Courier New", monospace';
    context.fillText(`P${lap.position}`, 1984, rowY + 25);
    context.textAlign = "left";
  }
}

function drawLapTimeline(context: CanvasRenderingContext2D, currentIndex: number): void {
  const x = 1264;
  const y = 852;
  const width = 720;
  const tickWidth = width / RACE_LAPS;

  context.fillStyle = "rgba(159, 179, 200, 0.55)";
  context.font = "600 14px Arial, sans-serif";
  fillTracked(context, `LAP TIMELINE · ${RACE_LAPS} LAPS`, x, y - 12, 4);
  context.textAlign = "right";
  fillTracked(context, `${String(currentIndex + 1).padStart(2, "0")} / ${RACE_LAPS}`, x + width, y - 12, 2, "right");
  context.textAlign = "left";

  for (let index = 0; index < RACE_LAPS; index++) {
    const lap = RACE.lapList[index];
    if (!lap) continue;
    const lit = index <= currentIndex;
    const current = index === currentIndex;
    context.fillStyle = current ? "#ffffff" : lit ? flagColor(lap.flag) : "rgba(159, 179, 200, 0.22)";
    context.globalAlpha = current ? 1 : lit ? 0.9 : 1;
    const barHeight = current ? 12 : 8;
    context.fillRect(x + index * tickWidth, current ? y - 2 : y, Math.max(2, tickWidth - 2), barHeight);
    context.globalAlpha = 1;
  }
}

function drawMainSpeedPanel(
  context: CanvasRenderingContext2D,
  displayLap: RaceLap,
  logIndex: number,
  seconds: number,
  finish: boolean,
): void {
  context.fillStyle = "rgba(6, 10, 16, 0.62)";
  context.fillRect(1236, 296, 776, 588);
  context.fillStyle = "rgba(225, 6, 0, 0.7)";
  context.fillRect(1236, 296, 776, 3);

  context.textAlign = "left";
  context.fillStyle = "rgba(159, 179, 200, 0.75)";
  context.font = "700 22px Arial, sans-serif";
  fillTracked(
    context,
    finish ? "RACE COMPLETE" : displayLap.redFlag ? "RED FLAG · NO TELEMETRY" : `LAP ${displayLap.lap} · SPEED TRACE`,
    1264,
    338,
    5,
  );

  if (!displayLap.redFlag) {
    const current = sampleAt(displayLap, seconds);
    context.textAlign = "right";
    context.fillStyle = "#f2f6fb";
    context.font = '700 38px Consolas, "Courier New", monospace';
    context.fillText(`${current[1]}`, 1944, 340);
    context.fillStyle = "rgba(159, 179, 200, 0.62)";
    context.font = "500 17px Arial, sans-serif";
    fillTracked(context, "km/h", 1984, 340, 2, "right");
    context.textAlign = "left";
    const trace = speedTrace(displayLap);
    drawSweptTrace(
      context,
      1264,
      364,
      720,
      210,
      trace.times,
      trace.series,
      lapTelemetrySeconds(displayLap),
      seconds,
      { lineWidth: 2.6, shadowBlur: 8 },
    );
  } else {
    // 红旗 / 缺失圈：红色斜纹 + 明确写「没有遥测」，不画一条假平线
    context.save();
    context.beginPath();
    context.rect(1264, 364, 720, 210);
    context.clip();
    context.fillStyle = "rgba(225, 6, 0, 0.08)";
    context.fillRect(1264, 364, 720, 210);
    context.strokeStyle = "rgba(225, 6, 0, 0.18)";
    context.lineWidth = 10;
    for (let offset = -240; offset < 960; offset += 48) {
      context.beginPath();
      context.moveTo(1264 + offset, 364);
      context.lineTo(1264 + offset + 210, 574);
      context.stroke();
    }
    context.restore();

    context.textAlign = "center";
    context.fillStyle = "#e10600";
    context.font = '800 44px Arial, sans-serif';
    context.fillText("SIGNAL SUSPENDED", 1624, 470);
    context.fillStyle = "rgba(232, 238, 247, 0.75)";
    context.font = "500 20px Arial, sans-serif";
    context.fillText(
      displayLap.lap <= RACE.classifiedLaps ? "RACE SUSPENDED BY RED FLAG" : "NO LAPS RAN · OFFICIAL CLASSIFICATION",
      1624,
      508,
    );
    context.textAlign = "left";
  }

  // 完赛：在曲线上压一条绿色 CHEQUERED 提示
  if (finish) {
    context.fillStyle = "rgba(61, 220, 132, 0.92)";
    context.fillRect(1264, 548, 250, 34);
    context.fillStyle = "#05080e";
    context.font = "800 20px Arial, sans-serif";
    fillTracked(context, "CHEQUERED", 1280, 571, 3);
  }

  drawLapLog(context, logIndex);
  drawLapTimeline(context, logIndex);
}

function drawRaceBottomBar(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = "#05080d";
  context.fillRect(0, height - 124, width, 124);
  context.fillStyle = "rgba(225, 6, 0, 0.85)";
  context.fillRect(0, height - 124, width, 4);

  context.textAlign = "left";
  context.fillStyle = "#f2f6fb";
  context.font = '900 40px "Arial Black", Arial, sans-serif';
  const brandWidth = fillTracked(context, "RED BULL RACING", 40, height - 52, 4);
  context.fillStyle = "#e10600";
  context.font = '900 40px "Arial Black", Arial, sans-serif';
  context.fillText(`#${RACE.carNumber}`, 40 + brandWidth + 26, height - 52);

  context.fillStyle = "rgba(159, 179, 200, 0.72)";
  context.font = '500 21px Consolas, "Courier New", monospace';
  context.fillText(`RACE REPLAY · 1 LAP = ${RACE_LAP_LABEL} · ${RACE_LAPS} LAPS`, 760, height - 56);

  context.textAlign = "right";
  context.fillStyle = "rgba(159, 179, 200, 0.55)";
  context.font = "600 20px Arial, sans-serif";
  fillTracked(context, "DATA · OPENF1 (UNOFFICIAL) · RB22", width - 40, height - 56, 2, "right");
  context.textAlign = "left";
}

/**
 * 后墙主屏：2024 圣保罗正赛逐圈回放。
 *
 * 版式沿用原来的「左侧大字 + 右侧面板」骨架，只把内容换成：
 * - 左：当前圈数 / 圈速 / 名次 / 三个统计 / 三段用时；
 * - 右：本圈速度曲线 + 逐圈日志 + 71 格时间轴；
 * - 顶：RACE、LAP xx/71、赛道状态、天气；
 * - 底：车队、回放节奏、数据来源。
 *
 * 第 33 圈（红旗中断）和第 70/71 圈（没跑的两圈）都不画假曲线，
 * 直接显示 RED FLAG，避免把 25 分钟静止段压成一条平线。
 */
export function createRaceWallTexture(): {
  texture: CanvasTexture;
  draw: (elapsedSeconds: number, bootProgress?: number) => void;
} {
  const W = 2048;
  const H = 1024;
  const { canvas, context } = createCanvas2D(W, H);

  const draw = (elapsedSeconds: number, bootProgress = 1): void => {
    const state = replayStateAt(elapsedSeconds);
    const finish = state.phase === "finish";
    const displayIndex = finish ? RACE.classifiedLaps - 1 : state.lapIndex;
    const displayLap = finish
      ? (RACE.lapList[displayIndex] ?? state.lap)
      : state.lap;
    const seconds = finish ? lapTelemetrySeconds(displayLap) : state.dataSeconds;

    const background = context.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, "#0a1019");
    background.addColorStop(0.65, "#070b12");
    background.addColorStop(1, "#04070b");
    context.fillStyle = background;
    context.fillRect(0, 0, W, H);

    context.save();
    context.translate(W * 0.5, 0);
    context.rotate(-0.22);
    for (let i = 0; i < 26; i++) {
      context.fillStyle = i % 2 === 0 ? "rgba(225, 6, 0, 0.035)" : "rgba(255, 255, 255, 0.01)";
      context.fillRect(i * 58, -H, 20, H * 2.4);
    }
    context.restore();

    // 车号水印：2024 圣保罗站 VER 是 1 号车
    context.save();
    context.font = '900 760px "Arial Black", Arial, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(225, 6, 0, 0.1)";
    context.fillText(String(RACE.carNumber), W * 0.46, H * 0.62);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(225, 6, 0, 0.22)";
    context.strokeText(String(RACE.carNumber), W * 0.46, H * 0.62);
    context.restore();

    drawRaceWordmark(context, W);
    drawRaceTopBar(context, W, state, finish, elapsedSeconds);
    drawCurrentLapPanel(context, state, displayLap, finish);
    drawMainSpeedPanel(context, displayLap, state.lapIndex, seconds, finish);
    drawRaceBottomBar(context, W, H);

    // 压暗四周，避免屏幕边缘发亮像贴纸
    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    // 确定性颗粒：6.7fps 下如果用 Math.random 会闪成雪花
    for (let i = 0; i < 1200; i++) {
      context.fillStyle = `rgba(255, 255, 255, ${(hash01(i * 1.37) * 0.02).toFixed(4)})`;
      context.fillRect(hash01(i * 2.11) * W, hash01(i * 3.73 + 5) * H, 2, 2);
    }

    drawBootReveal(context, W, H, bootProgress, "#63e9ff", "RACE · SYNC", elapsedSeconds);
    texture.needsUpdate = true;
  };

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  draw(0, 0);

  return { texture, draw };
}

/* ───────────────────── 左右副屏：逐圈遥测 ───────────────────── */

/** 左屏看速度 / RPM，右屏看油门 / 刹车 / 挡位 / 分段 */
export type TelemetrySide = "speed" | "inputs";

const TELEMETRY_ACCENT = "#63e9ff";
const TELEMETRY_TEXT = "#e8eef7";
const TELEMETRY_MUTED = "rgba(159, 179, 200, 0.62)";
const TELEMETRY_GREEN = "#3ddc84";
const TELEMETRY_AMBER = "#ffcf00";
const TELEMETRY_RED = "#e10600";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 副屏底板：深色渐变 + 极淡网格 + 顶部冷光，和主屏同一套色板 */
function drawSideBackground(context: CanvasRenderingContext2D, width: number, height: number, accent: string): void {
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#08121b");
  background.addColorStop(0.55, "#050c13");
  background.addColorStop(1, "#03070b");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.5, 0, 0, width * 0.5, 0, width * 0.68);
  glow.addColorStop(0, "rgba(99, 233, 255, 0.11)");
  glow.addColorStop(0.55, `${accent}0d`);
  glow.addColorStop(1, "rgba(99, 233, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height * 0.55);

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

function drawSideHeader(
  context: CanvasRenderingContext2D,
  width: number,
  code: string,
  title: string,
  elapsedSeconds: number,
  status: string,
): void {
  context.textBaseline = "middle";
  context.textAlign = "left";

  context.fillStyle = TELEMETRY_MUTED;
  context.font = "600 17px Arial, sans-serif";
  fillTracked(context, code, 40, 44, 3);

  context.fillStyle = TELEMETRY_ACCENT;
  context.font = "700 23px Arial, sans-serif";
  fillTracked(context, title, 40, 78, 4);

  const statusColor =
    status === "HOLD" ? TELEMETRY_RED : status === "CHEQUERED" ? "#f2f6fb" : TELEMETRY_GREEN;
  const blink = status === "HOLD" ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 5.2)) : 1;
  context.fillStyle = statusColor;
  context.globalAlpha = blink;
  context.beginPath();
  context.arc(width - 150, 44, 6, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = TELEMETRY_MUTED;
  context.font = '600 16px Consolas, "Courier New", monospace';
  fillTracked(context, status, width - 132, 44, 3);

  for (let i = 0; i < 3; i++) {
    const barHeight = 6 + i * 4;
    const active = i < 2 || Math.sin(elapsedSeconds * 1.7) > 0;
    context.fillStyle = active ? TELEMETRY_ACCENT : "rgba(99, 233, 255, 0.16)";
    context.fillRect(width - 76 + i * 9, 48 - barHeight, 5, barHeight);
  }

  context.fillStyle = "rgba(99, 233, 255, 0.62)";
  context.fillRect(40, 104, width - 80, 2);
}

/** 分段条：统计块底部的小刻度，点亮格数表示相对量级 */
function drawSegmentedBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  color: string,
  cells: number,
  elapsedSeconds: number,
): void {
  const gap = 4;
  const cellWidth = (width - gap * (cells - 1)) / cells;
  const litCells = clamp01(ratio) * cells;

  for (let i = 0; i < cells; i++) {
    const lit = i + 0.35 < litCells;
    context.fillStyle = lit ? color : "rgba(159, 179, 200, 0.11)";
    if (lit) {
      context.globalAlpha = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3 + i * 0.45));
    }
    context.fillRect(x + i * (cellWidth + gap), y, cellWidth, height);
    context.globalAlpha = 1;
  }
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
  elapsedSeconds: number,
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

/** 分段块：S1 / S2 / S3 用时；没有数据时显示破折号 */
function drawSectorBlock(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  seconds: number | null | undefined,
): void {
  context.fillStyle = "rgba(255, 255, 255, 0.032)";
  context.fillRect(x, y, width, 104);
  context.fillStyle = TELEMETRY_ACCENT;
  context.fillRect(x, y, width, 3);

  context.fillStyle = TELEMETRY_MUTED;
  context.font = "600 16px Arial, sans-serif";
  fillTracked(context, label, x + 18, y + 28, 3);

  context.fillStyle = TELEMETRY_TEXT;
  context.font = '700 38px Consolas, "Courier New", monospace';
  const text = formatSector(seconds);
  const valueWidth = context.measureText(text).width;
  context.fillText(text, x + 18, y + 72);
  if (seconds !== null && seconds !== undefined) {
    context.fillStyle = "rgba(159, 179, 200, 0.72)";
    context.font = "500 15px Arial, sans-serif";
    context.fillText("s", x + 24 + valueWidth, y + 72);
  }
}

/** 副屏底部：说明文字 + 运行时长 */
function drawSideFooter(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedSeconds: number,
  rightLabel: string,
): void {
  context.fillStyle = "rgba(99, 233, 255, 0.16)";
  context.fillRect(40, height - 58, width - 80, 1);

  context.fillStyle = "rgba(159, 179, 200, 0.45)";
  context.font = '500 15px Consolas, "Courier New", monospace';
  fillTracked(context, "RB22 · RACE REPLAY BUS", 40, height - 36, 2);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = Math.floor(elapsedSeconds % 60);
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  context.textAlign = "right";
  fillTracked(context, `${rightLabel} · T+ ${clock}`, width - 40, height - 36, 2, "right");
  context.textAlign = "left";
}

/** 红旗卡片：第 33 圈是真实中断，第 70/71 圈是没跑的两圈，文案要区分 */
function drawRedFlagCard(context: CanvasRenderingContext2D, width: number, height: number, lap: RaceLap): void {
  const missingLaps = lap.lap > RACE.classifiedLaps;

  context.fillStyle = "rgba(225, 6, 0, 0.12)";
  context.fillRect(40, 140, width - 80, height - 280);
  context.strokeStyle = "rgba(225, 6, 0, 0.6)";
  context.lineWidth = 3;
  context.strokeRect(41.5, 141.5, width - 83, height - 283);

  context.save();
  context.beginPath();
  context.rect(42, 142, width - 84, height - 284);
  context.clip();
  context.strokeStyle = "rgba(225, 6, 0, 0.12)";
  context.lineWidth = 14;
  for (let offset = -240; offset < width + 240; offset += 56) {
    context.beginPath();
    context.moveTo(offset, 142);
    context.lineTo(offset + 180, height - 142);
    context.stroke();
  }
  context.restore();

  context.textAlign = "left";
  context.fillStyle = "#e10600";
  context.font = '800 92px Arial, sans-serif';
  context.fillText("RED FLAG", 72, 310);

  context.fillStyle = "#f2f6fb";
  context.font = "700 32px Arial, sans-serif";
  fillTracked(context, missingLaps ? "RACE ENDED" : "RACE SUSPENDED", 76, 366, 5);

  context.fillStyle = "rgba(232, 238, 247, 0.78)";
  context.font = '500 22px Consolas, "Courier New", monospace';
  context.fillText(
    missingLaps
      ? `LAP ${lap.lap} / ${RACE_LAPS} · OFFICIAL ${RACE.classifiedLaps} LAPS`
      : `LAP ${lap.lap} / ${RACE_LAPS} · OFFICIAL ${formatLap(lap.time ?? 0)}`,
    76,
    416,
  );

  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = '500 17px Consolas, "Courier New", monospace';
  fillTracked(context, "TELEMETRY SIGNAL SUSPENDED", 76, 470, 3);
}

function drawFinishCard(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = "rgba(61, 220, 132, 0.08)";
  context.fillRect(40, 140, width - 80, height - 280);
  context.strokeStyle = "rgba(61, 220, 132, 0.5)";
  context.lineWidth = 3;
  context.strokeRect(41.5, 141.5, width - 83, height - 283);

  context.textAlign = "left";
  context.fillStyle = "#f2f6fb";
  context.font = '800 88px Arial, sans-serif';
  context.fillText("CHEQUERED", 72, 310);

  context.fillStyle = TELEMETRY_GREEN;
  context.font = "700 34px Arial, sans-serif";
  fillTracked(context, `P${RACE.finishPosition} · M. VERSTAPPEN`, 76, 366, 4);

  context.fillStyle = "rgba(232, 238, 247, 0.82)";
  context.font = '500 24px Consolas, "Courier New", monospace';
  context.fillText(
    `${formatRaceTime(RACE.finishTimeSeconds)} · ${RACE.classifiedLaps} LAPS CLASSIFIED`,
    76,
    418,
  );

  context.fillStyle = "rgba(159, 179, 200, 0.62)";
  context.font = "500 17px Arial, sans-serif";
  fillTracked(context, `GRID P${RACE.grid} → FINISH P${RACE.finishPosition} · ${RACE.points} PTS`, 76, 470, 2);
}

/**
 * 左右副屏：同一套版式，两种信息角色。
 *
 * - speed：当前速度 / 挡位 / RPM + 整圈速度曲线 + TOP / AVG / FULL；
 * - inputs：当前油门 / 刹车 / 挡位 + 油门刹车曲线 + 三段用时 + 圈速差。
 *
 * 两块屏都读同一份 `replayStateAt`，所以永远和主屏同一圈、同一播放头。
 */
export function createTelemetryScreenTexture(side: TelemetrySide): {
  texture: CanvasTexture;
  draw: (elapsedSeconds: number, bootProgress?: number) => void;
} {
  const W = 1024;
  const H = 768;
  const { canvas, context } = createCanvas2D(W, H);

  const isSpeed = side === "speed";
  const theme = isSpeed
    ? { code: "AUX 01", title: "LAP TELEMETRY · SPEED", footer: "SPEED" }
    : { code: "AUX 02", title: "LAP TELEMETRY · INPUTS", footer: "INPUTS" };

  const draw = (elapsedSeconds: number, bootProgress = 1): void => {
    const state = replayStateAt(elapsedSeconds);
    const finish = state.phase === "finish";
    const displayIndex = finish ? RACE.classifiedLaps - 1 : state.lapIndex;
    const displayLap = finish ? (RACE.lapList[displayIndex] ?? state.lap) : state.lap;
    const seconds = finish ? lapTelemetrySeconds(displayLap) : state.dataSeconds;
    const current = sampleAt(displayLap, seconds);

    drawSideBackground(context, W, H, TELEMETRY_ACCENT);
    drawSideHeader(
      context,
      W,
      theme.code,
      theme.title,
      elapsedSeconds,
      finish ? "CHEQUERED" : displayLap.redFlag ? "HOLD" : "LIVE",
    );

    if (finish) {
      drawFinishCard(context, W, H);
    } else if (displayLap.redFlag) {
      drawRedFlagCard(context, W, H, displayLap);
    } else if (isSpeed) {
      context.textAlign = "left";
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, "GROUND SPEED", 40, 142, 4);

      context.fillStyle = TELEMETRY_TEXT;
      context.font = '800 150px Consolas, "Courier New", monospace';
      context.fillText(`${current[1]}`, 34, 252);
      context.fillStyle = TELEMETRY_ACCENT;
      context.font = "700 34px Arial, sans-serif";
      context.fillText("km/h", 330, 248);

      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "GEAR", 520, 146, 4);
      fillTracked(context, "RPM", 720, 146, 4);
      context.fillStyle = TELEMETRY_TEXT;
      context.font = '700 72px Consolas, "Courier New", monospace';
      context.fillText(`${current[3]}`, 520, 216);
      context.font = '700 52px Consolas, "Courier New", monospace';
      context.fillText(`${(current[2] / 1000).toFixed(1)}k`, 720, 214);

      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "LAP SPEED · 0—340 KM/H", 40, 302, 3);
      const trace = speedTrace(displayLap);
      drawSweptTrace(
        context,
        40,
        318,
        944,
        206,
        trace.times,
        trace.series,
        lapTelemetrySeconds(displayLap),
        seconds,
        { lineWidth: 2.3, shadowBlur: 6 },
      );

      const stats = [
        {
          label: "TOP SPEED",
          value: displayLap.topSpeed === null ? "—" : `${Math.round(displayLap.topSpeed)}`,
          unit: "km/h",
          ratio: (displayLap.topSpeed ?? 0) / 340,
          color: TELEMETRY_ACCENT,
        },
        {
          label: "AVG SPEED",
          value: displayLap.avgSpeed === null ? "—" : displayLap.avgSpeed.toFixed(1),
          unit: "km/h",
          ratio: (displayLap.avgSpeed ?? 0) / 240,
          color: TELEMETRY_GREEN,
        },
        {
          label: "FULL THROTTLE",
          value: displayLap.fullThrottle === null ? "—" : displayLap.fullThrottle.toFixed(1),
          unit: "%",
          ratio: (displayLap.fullThrottle ?? 0) / 100,
          color: TELEMETRY_AMBER,
        },
      ];
      for (const [index, stat] of stats.entries()) {
        drawStatBlock(
          context,
          40 + index * 323,
          548,
          298,
          stat.label,
          stat.value,
          stat.unit,
          stat.ratio,
          stat.color,
          elapsedSeconds,
        );
      }

      context.fillStyle = "rgba(159, 179, 200, 0.52)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      fillTracked(context, `VER · LAP ${displayLap.lap}/${RACE_LAPS}`, 40, 690, 2);
      context.textAlign = "right";
      fillTracked(context, `${RACE_LAP_LABEL} / LAP`, W - 40, 690, 2, "right");
      context.textAlign = "left";
    } else {
      context.textAlign = "left";
      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 17px Arial, sans-serif";
      fillTracked(context, "THROTTLE", 40, 142, 4);
      fillTracked(context, "BRAKE", 380, 142, 4);
      fillTracked(context, "GEAR", 720, 142, 4);

      context.fillStyle = TELEMETRY_GREEN;
      context.font = '800 118px Consolas, "Courier New", monospace';
      context.fillText(`${current[4]}`, 34, 252);
      context.fillStyle = TELEMETRY_GREEN;
      context.font = "700 30px Arial, sans-serif";
      context.fillText("%", 300, 248);

      context.fillStyle = TELEMETRY_RED;
      context.font = '800 118px Consolas, "Courier New", monospace';
      context.fillText(`${current[5]}`, 374, 252);
      context.font = "700 30px Arial, sans-serif";
      context.fillText("%", 640, 248);

      context.fillStyle = TELEMETRY_TEXT;
      context.font = '800 150px Consolas, "Courier New", monospace';
      context.fillText(`${current[3]}`, 720, 252);

      context.fillStyle = TELEMETRY_MUTED;
      context.font = "600 16px Arial, sans-serif";
      fillTracked(context, "THROTTLE / BRAKE · 0—100%", 40, 302, 3);
      const trace = inputTrace(displayLap);
      drawSweptTrace(
        context,
        40,
        318,
        944,
        206,
        trace.times,
        trace.series,
        lapTelemetrySeconds(displayLap),
        seconds,
        { lineWidth: 2.3, shadowBlur: 6 },
      );

      const sectors = displayLap.sectors;
      const sectorLabels = ["SECTOR 1", "SECTOR 2", "SECTOR 3"];
      for (const [index, label] of sectorLabels.entries()) {
        drawSectorBlock(context, 40 + index * 323, 548, 298, label, sectors?.[index]);
      }

      const best = BEST_LAP_BY_INDEX[displayIndex] ?? null;
      const delta =
        displayLap.time === null || best === null
          ? "—"
          : displayLap.time - best <= 0.0005
            ? "BEST"
            : `+${(displayLap.time - best).toFixed(3)}`;

      context.fillStyle = "rgba(159, 179, 200, 0.52)";
      context.font = '500 15px Consolas, "Courier New", monospace';
      fillTracked(
        context,
        `LAP ${displayLap.time === null ? "—" : formatLap(displayLap.time)} · Δ ${delta}`,
        40,
        690,
        2,
      );
      context.textAlign = "right";
      fillTracked(context, `${RACE_LAP_LABEL} / LAP`, W - 40, 690, 2, "right");
      context.textAlign = "left";
    }

    drawSideFooter(context, W, H, elapsedSeconds, theme.footer);

    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    context.fillStyle = "rgba(0, 0, 0, 0.06)";
    for (let y = 0; y < H; y += 4) {
      context.fillRect(0, y, W, 1);
    }

    drawBootReveal(
      context,
      W,
      H,
      bootProgress,
      TELEMETRY_ACCENT,
      isSpeed ? "SPEED BUS · LINK" : "INPUT BUS · LINK",
      elapsedSeconds,
    );

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

    // ── 参考轨迹：用第 69 圈（完赛圈）的速度曲线做海报底纹 ──
    const referenceLap = RACE.lapList[RACE.classifiedLaps - 1] ?? RACE.lapList[0]!;
    const referenceSamples = referenceLap.samples;
    const traceX = 64;
    const traceY = 552;
    const traceWidth = W - 128;
    const traceHeight = 216;
    const speedMin = 60;
    const speedMax = 340;

    context.fillStyle = "rgba(159, 179, 200, 0.5)";
    context.font = "500 16px Arial, sans-serif";
    fillTracked(context, "VIDEO FEED · SIGNAL TRACE · FINAL LAP", traceX, traceY - 16, 3);

    context.save();
    context.beginPath();
    referenceSamples.forEach((sample, index) => {
      const x = traceX + (index / Math.max(1, referenceSamples.length - 1)) * traceWidth;
      const y = traceY + traceHeight - (((sample[1] ?? 0) - speedMin) / (speedMax - speedMin)) * traceHeight;
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
