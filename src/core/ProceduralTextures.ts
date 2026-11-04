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
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { RoomConfig } from '../config/showroom';

/** 建一块离屏画布并拿到 2D 上下文；拿不到就抛错，避免后面一堆空判断 */
function createCanvas2D(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 2D 画布上下文');
  return { canvas, context };
}

/** 带字距的文字绘制：canvas 的 letterSpacing 兼容性不稳，自己逐字摆更可靠 */
function fillTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right' = 'left',
): number {
  const chars = [...text];
  const widths = chars.map((char) => context.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + tracking * (chars.length - 1);
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

  for (const [index, char] of chars.entries()) {
    context.fillText(char, cursor, y);
    cursor += (widths[index] ?? 0) + tracking;
  }

  return total;
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
export function createFloorTexture(floor: RoomConfig['floor']): CanvasTexture {
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
    gradient.addColorStop(0, light ? 'rgba(255, 255, 255, 0.035)' : 'rgba(122, 119, 110, 0.028)');
    gradient.addColorStop(1, light ? 'rgba(255, 255, 255, 0)' : 'rgba(122, 119, 110, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // 细颗粒：远看是均匀的浅灰，近看才有环氧地坪的细微颗粒
  for (let i = 0; i < noiseDots; i++) {
    const alpha = 0.02 + Math.random() * 0.04;
    const dark = Math.random() < 0.55;
    context.fillStyle = dark
      ? `rgba(92, 89, 82, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`;
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

/** 右边圈速榜里的一行 */
interface StandingRow {
  readonly position: string;
  readonly code: string;
  readonly gap: string;
  readonly baseLap: number;
  readonly compound: string;
  readonly compoundColor: string;
}

const STANDINGS: readonly StandingRow[] = [
  { position: '1', code: 'VER', gap: 'LEADER', baseLap: 88.412, compound: 'S', compoundColor: '#e10600' },
  { position: '2', code: 'NOR', gap: '+1.204', baseLap: 89.111, compound: 'M', compoundColor: '#ffcf00' },
  { position: '3', code: 'LEC', gap: '+3.887', baseLap: 89.402, compound: 'M', compoundColor: '#ffcf00' },
  { position: '4', code: 'PIA', gap: '+5.310', baseLap: 89.554, compound: 'H', compoundColor: '#f2f2f2' },
  { position: '5', code: 'HAM', gap: '+7.221', baseLap: 89.301, compound: 'S', compoundColor: '#e10600' },
  { position: '6', code: 'RUS', gap: '+9.004', baseLap: 89.660, compound: 'H', compoundColor: '#f2f2f2' },
  { position: '7', code: 'TSU', gap: '+12.418', baseLap: 89.882, compound: 'M', compoundColor: '#ffcf00' },
  { position: '8', code: 'ALO', gap: '+15.772', baseLap: 90.104, compound: 'H', compoundColor: '#f2f2f2' },
];

/** 88.412 → "1:28.412" */
function formatLap(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

/**
 * 赛事大屏：整面墙的主视觉，也是「这是 F1 车库」最直接的证据。
 *
 * 版式按 F1 转播画面的惯例分区：
 * - 顶部 150px 是安全区：灯桁架会从前面横过墙顶，正文不能放进去；
 * - 顶栏：场次、圈数、DRS/赛道状态、气温/赛道温度/风速；
 * - 左区：最快圈（紫色）+ 三段刷圈时间（紫/绿/黄）+ 测速点；
 * - 右区：圈速榜（位置、车手、差距、圈速、轮胎配方）；
 * - 底栏：车队字样、车号 3、赛会信息、车型年份。
 */
export function createRaceWallTexture(): {
  texture: CanvasTexture;
  draw: (elapsedSeconds: number) => void;
} {
  const W = 2048;
  const H = 1024;
  const { canvas, context } = createCanvas2D(W, H);

  const draw = (elapsedSeconds: number): void => {
    // ── 底 ──
    const background = context.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, '#0a1019');
    background.addColorStop(0.65, '#070b12');
    background.addColorStop(1, '#04070b');
    context.fillStyle = background;
    context.fillRect(0, 0, W, H);

    // 斜纹：涂装的速度线，低透明度
    context.save();
    context.translate(W * 0.5, 0);
    context.rotate(-0.22);
    for (let i = 0; i < 26; i++) {
      context.fillStyle = i % 2 === 0 ? 'rgba(225, 6, 0, 0.05)' : 'rgba(255, 255, 255, 0.01)';
      context.fillRect(i * 58, -H, 20, H * 2.4);
    }
    context.restore();

    // 车号水印：压在大屏中部偏右，不抢读数
    context.save();
    context.font = '900 760px "Arial Black", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(225, 6, 0, 0.1)';
    context.fillText('3', W * 0.46, H * 0.62);
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(225, 6, 0, 0.22)';
    context.strokeText('3', W * 0.46, H * 0.62);
    context.restore();

    // ── 顶栏（150 起，避开桁架）──
    context.fillStyle = '#c8102e';
    context.fillRect(0, 150, 300, 120);
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.font = '900 56px "Arial Black", Arial, sans-serif';
    fillTracked(context, 'RACE', 150, 198, 6, 'center');
    context.font = '500 20px Arial, sans-serif';
    context.fillStyle = 'rgba(255,255,255,0.72)';
    fillTracked(context, 'ROUND 21 · 2026', 150, 244, 2, 'center');

    context.textAlign = 'left';
    const lap = 42 + Math.floor(elapsedSeconds / 90);
    context.fillStyle = '#f2f6fb';
    context.font = '800 50px Arial, sans-serif';
    context.fillText(`LAP ${lap} / 57`, 344, 200);
    context.fillStyle = '#3ddc84';
    context.font = '600 23px Arial, sans-serif';
    fillTracked(context, 'DRS ENABLED · TRACK CLEAR', 346, 244, 3);

    // 右上环境数据
    const environment = [
      { label: 'TRACK', value: '34°C' },
      { label: 'AIR', value: '24°C' },
      { label: 'WIND', value: '1.4 m/s' },
    ];
    for (const [index, item] of environment.entries()) {
      const x = 1420 + index * 210;
      context.textAlign = 'left';
      context.fillStyle = 'rgba(159,179,200,0.62)';
      context.font = '500 19px Arial, sans-serif';
      fillTracked(context, item.label, x, 194, 3);
      context.fillStyle = '#e8eef7';
      context.font = '700 36px Arial, sans-serif';
      context.fillText(item.value, x, 236);
    }

    // 顶栏分隔线
    context.fillStyle = 'rgba(255,255,255,0.09)';
    context.fillRect(0, 270, W, 2);

    // ── 左区：最快圈 ──
    context.textAlign = 'left';
    context.fillStyle = 'rgba(176,106,179,0.9)';
    context.font = '700 28px Arial, sans-serif';
    fillTracked(context, 'FASTEST LAP', 44, 328, 8);

    context.fillStyle = '#c084fc';
    context.font = '800 150px Consolas, "Courier New", monospace';
    context.fillText('1:28.412', 36, 476);

    context.fillStyle = '#e8eef7';
    context.font = '700 42px Arial, sans-serif';
    fillTracked(context, 'M. VERSTAPPEN', 44, 542, 4);
    context.fillStyle = 'rgba(159,179,200,0.7)';
    context.font = '500 26px Arial, sans-serif';
    fillTracked(context, 'ORACLE RED BULL RACING · #3', 44, 584, 3);

    // 三段刷圈时间
    const sectors = [
      { label: 'SECTOR 1', time: '28.914', color: '#c084fc' },
      { label: 'SECTOR 2', time: '34.226', color: '#3ddc84' },
      { label: 'SECTOR 3', time: '25.272', color: '#ffd166' },
    ];
    for (const [index, sector] of sectors.entries()) {
      const x = 44 + index * 372;
      context.fillStyle = 'rgba(255,255,255,0.035)';
      context.fillRect(x, 626, 340, 122);
      context.fillStyle = sector.color;
      context.fillRect(x, 626, 340, 4);

      context.fillStyle = 'rgba(159,179,200,0.62)';
      context.font = '500 21px Arial, sans-serif';
      fillTracked(context, sector.label, x + 20, 666, 4);

      context.fillStyle = sector.color;
      context.font = '700 52px Consolas, "Courier New", monospace';
      context.fillText(sector.time, x + 18, 722);
    }

    // 测速点
    context.fillStyle = 'rgba(159,179,200,0.62)';
    context.font = '500 21px Arial, sans-serif';
    fillTracked(context, 'SPEED TRAP', 44, 800, 6);

    context.fillStyle = '#f2f6fb';
    context.font = '700 78px Consolas, "Courier New", monospace';
    context.fillText('342.8', 40, 876);
    context.fillStyle = 'rgba(159,179,200,0.8)';
    context.font = '500 30px Arial, sans-serif';
    context.fillText('km/h', 300, 874);

    context.fillStyle = 'rgba(159,179,200,0.7)';
    context.font = '600 24px Arial, sans-serif';
    fillTracked(context, 'NOR · SECTOR 3', 470, 846, 4);

    // ── 右区：圈速榜 ──
    context.fillStyle = 'rgba(255,255,255,0.03)';
    context.fillRect(1236, 296, 776, 588);
    context.fillStyle = 'rgba(225,6,0,0.7)';
    context.fillRect(1236, 296, 776, 3);

    context.fillStyle = 'rgba(159,179,200,0.75)';
    context.font = '700 22px Arial, sans-serif';
    fillTracked(context, 'LIVE STANDINGS', 1264, 338, 6);

    context.fillStyle = 'rgba(159,179,200,0.45)';
    context.font = '500 19px Consolas, "Courier New", monospace';
    context.fillText('P', 1264, 378);
    context.fillText('DRIVER', 1316, 378);
    context.fillText('GAP', 1600, 378);
    context.fillText('LAST', 1760, 378);

    for (const [index, row] of STANDINGS.entries()) {
      const y = 412 + index * 58;
      if (index % 2 === 0) {
        context.fillStyle = 'rgba(255,255,255,0.028)';
        context.fillRect(1252, y - 22, 744, 52);
      }

      const jitter = Math.sin(elapsedSeconds * 0.8 + index * 1.4) * 0.28;
      const lapTime = formatLap(row.baseLap + jitter);

      context.fillStyle = index === 0 ? '#ffffff' : 'rgba(232,238,247,0.92)';
      context.font = '700 25px Consolas, "Courier New", monospace';
      context.fillText(row.position, 1264, y);

      context.font = '700 30px Arial, sans-serif';
      context.fillStyle = index === 0 ? '#ffffff' : 'rgba(232,238,247,0.88)';
      context.fillText(row.code, 1316, y);

      context.font = '500 24px Consolas, "Courier New", monospace';
      context.fillStyle = 'rgba(159,179,200,0.85)';
      context.fillText(row.gap, 1600, y);

      // 第一名那一行圈速用紫色（全场最快）
      context.fillStyle = index === 0 ? '#c084fc' : 'rgba(125,211,168,0.9)';
      context.fillText(lapTime, 1760, y);

      context.fillStyle = row.compoundColor;
      context.beginPath();
      context.arc(1954, y - 8, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#05080e';
      context.font = '700 13px Consolas, "Courier New", monospace';
      context.textAlign = 'center';
      context.fillText(row.compound, 1954, y - 7);
      context.textAlign = 'left';
    }

    // ── 底栏 ──
    context.fillStyle = '#05080d';
    context.fillRect(0, 900, W, 124);
    context.fillStyle = 'rgba(225,6,0,0.85)';
    context.fillRect(0, 900, W, 4);

    context.fillStyle = '#f2f6fb';
    context.font = '900 40px "Arial Black", Arial, sans-serif';
    const brandWidth = fillTracked(context, 'RED BULL RACING', 40, 972, 4);
    context.fillStyle = '#e10600';
    context.font = '900 40px "Arial Black", Arial, sans-serif';
    context.fillText('#3', 40 + brandWidth + 26, 972);

    context.fillStyle = 'rgba(159,179,200,0.72)';
    context.font = '500 21px Consolas, "Courier New", monospace';
    context.fillText('RACE CONTROL · TRACK CLEAR · DRS ENABLED', 760, 968);

    context.textAlign = 'right';
    context.fillStyle = 'rgba(159,179,200,0.55)';
    context.font = '600 23px Arial, sans-serif';
    fillTracked(context, 'RB22 · 2026 SEASON', W - 40, 968, 3, 'right');

    // ── 压暗四周，避免屏幕边缘发亮像贴纸 ──
    const vignette = context.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, W, H);

    // 颗粒：压掉大色块的色带
    for (let i = 0; i < 4200; i++) {
      context.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.022})`;
      context.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }

    texture.needsUpdate = true;
  };

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  draw(0);

  return { texture, draw };
}

/** 穿孔板：工具墙的底板。深色 + 细孔，配合现代工具才有「车队工位」的感觉 */
export function createPegboardTexture(): CanvasTexture {
  const S = 1024;
  const { canvas, context } = createCanvas2D(S, S);

  const background = context.createLinearGradient(0, 0, 0, S);
  background.addColorStop(0, '#171c24');
  background.addColorStop(1, '#0e1218');
  context.fillStyle = background;
  context.fillRect(0, 0, S, S);

  // 孔洞：24px 一格，比原来更密，远看是一层细密纹理
  const step = 24;
  for (let y = step; y < S; y += step) {
    for (let x = step; x < S; x += step) {
      context.fillStyle = '#05070a';
      context.beginPath();
      context.arc(x, y, 3.4, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = 'rgba(255, 255, 255, 0.045)';
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
  context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  context.lineWidth = 16;
  context.strokeRect(8, 8, S - 16, S - 16);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
