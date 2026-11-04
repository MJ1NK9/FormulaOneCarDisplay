/**
 * 把一块平面矩形（DOM 层）透视映射到 3D 屏幕投影出来的四边形上。
 *
 * 为什么需要它：
 * 视频屏是 3D 物体，相机绕车旋转时，屏幕在视口里是一个带透视的四边形，
 * 不是简单的「轴对齐矩形 + 旋转」。只做 rotate 的话，控制台会看起来像
 * 一张贴在屏幕旁边的贴纸；用完整的 8 自由度单应矩阵（homography）映射，
 * 面板的四条边才会和 3D 屏幕的四条边严格重合，像真的装在墙上。
 *
 * 数学约定：
 * - 本地坐标系左上角为 (0, 0)，宽高是虚拟画布尺寸（1000 × 500 之类）；
 * - 目标四边形按左上 / 右上 / 右下 / 左下顺序给出，单位是 CSS 像素；
 * - CSS 的 matrix3d 是列主序，而 2D 单应矩阵是行主序，写参数时要转置。
 *   浏览器对 3D 变换做透视除法：
 *     x' = (m11·x + m21·y + m41) / (m14·x + m24·y + m44)
 *     y' = (m12·x + m22·y + m42) / (m14·x + m24·y + m44)
 *   对应到下面的 h11..h33，m41 就是 h13、m14 就是 h31。
 */
export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProjectedQuad {
  readonly topLeft: ProjectedPoint;
  readonly topRight: ProjectedPoint;
  readonly bottomRight: ProjectedPoint;
  readonly bottomLeft: ProjectedPoint;
}

const EPSILON = 1e-7;
const MATRIX_PRECISION = 6;

function round(value: number): number {
  const factor = 10 ** MATRIX_PRECISION;
  return Math.round(value * factor) / factor;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * 计算「本地矩形 → 投影四边形」的 CSS matrix3d 字符串。
 *
 * 先解单位正方形 (0..1) 到四边形的单应矩阵，再把本地像素坐标除以虚拟宽高
 * 折进矩阵，这样调用方不需要在 CSS 里额外做 scale。
 *
 * 退化情况：
 * - 四个点共线 / 面积为零：返回 "none"，调用方应当已经根据 getQuad 的
 *   返回值把面板收起，这里只是防御；
 * - 四边形是平行四边形（den ≈ 0）：公式会除零，此时退化成仿射矩阵，
 *   对正对屏幕的机位同样精确。
 */
export function computeQuadTransform(
  width: number,
  height: number,
  quad: ProjectedQuad,
): string {
  if (!(width > 0) || !(height > 0)) return 'none';

  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;
  const values = [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y];
  if (!values.every(finite)) return 'none';

  // 标准单位正方形 → 四边形的单应矩阵系数，见 Paul Heckbert 的推导
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;

  let h11: number;
  let h12: number;
  let h13: number;
  let h21: number;
  let h22: number;
  let h23: number;
  let h31: number;
  let h32: number;
  let h33: number;

  if (Math.abs(denominator) < EPSILON) {
    // 平行四边形：透视项为 0，映射退化成仿射，仍然逐点精确
    h11 = (p1.x - p0.x) / width;
    h12 = (p3.x - p0.x) / height;
    h13 = p0.x;
    h21 = (p1.y - p0.y) / width;
    h22 = (p3.y - p0.y) / height;
    h23 = p0.y;
    h31 = 0;
    h32 = 0;
    h33 = 1;
  } else {
    const g = (dx3 * dy2 - dx2 * dy3) / denominator;
    const h = (dx1 * dy3 - dx3 * dy1) / denominator;

    const a = p1.x - p0.x + g * p1.x;
    const b = p3.x - p0.x + h * p3.x;
    const d = p1.y - p0.y + g * p1.y;
    const e = p3.y - p0.y + h * p3.y;

    h11 = a / width;
    h12 = b / height;
    h13 = p0.x;
    h21 = d / width;
    h22 = e / height;
    h23 = p0.y;
    h31 = g / width;
    h32 = h / height;
    h33 = 1;
  }

  // CSS matrix3d 列主序：
  // [h11 h21 0 h31, h12 h22 0 h32, 0 0 1 0, h13 h23 0 h33]
  return `matrix3d(${round(h11)}, ${round(h21)}, 0, ${round(h31)}, ${round(h12)}, ${round(h22)}, 0, ${round(h32)}, 0, 0, 1, 0, ${round(h13)}, ${round(h23)}, 0, ${round(h33)})`;
}
