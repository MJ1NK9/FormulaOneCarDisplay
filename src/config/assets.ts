/**
 * 外部资源地址 —— 车模与视频文件的「真实位置」。
 *
 * 为什么单独一层而不是各处写死 URL：
 * 1. 免费静态托管（EdgeOne Pages / Cloudflare Pages）单文件上限 25MB，
 *    高模 36MB、视频 66MB 都超过，留在 dist 里会让部署直接失败；
 * 2. 站点本身只有几百 KB，首页打开速度不受影响，大文件等真正需要时再拉；
 * 3. 逻辑路径（`models/rb22.glb`）只写一次，以后换存储商只改下面这一行。
 *
 * 开发期默认仍读 public/ 下的本地文件：省流量、不依赖网络。
 * 想验证线上那条路径，把 USE_CDN_IN_DEV 打开（或直接跑 npm run preview，
 * 产物里本地副本已被删掉，只能走 CDN）。
 *
 * 为什么视频单独一个域名：
 * 2024 年后创建的 COS 桶，默认域名会给对象加 `x-cos-force-download: true` 和
 * `Content-Disposition: attachment`。Chrome 会忽略这个头，但 Safari/WebKit 会把
 * `<video>` 的源当成下载，导致 iPhone 上视频不播。视频放到香港桶并绑定自定义
 * 源站域名（香港桶不需要 ICP 备案）后就不会带这个头；车模不受影响，继续留成都。
 */
export const ASSET_BASE_URL = 'https://formula-one-1317097570.cos.ap-chengdu.myqcloud.com/';

/**
 * 视频专用：香港桶的自定义源站域名。
 * 和成都默认域名相比，它不会注入强制下载头，Safari 才能正常播放。
 */
export const VIDEO_ASSET_BASE_URL = 'https://assets.mj1nk9.space/';

/** 开发期是否也走 COS。正常开发保持 false，否则每次刷新都要从网上重下模型和视频 */
const USE_CDN_IN_DEV = false;

/**
 * COS 桶里的对象是平铺在根目录的，项目里却按 public/ 的目录组织，
 * 这张表把「逻辑路径」翻译成「对象键」。
 * 以后新增资源如果直接传进桶里的 models/、videos/ 目录，不写映射也能命中。
 */
const REMOTE_KEYS: Readonly<Record<string, string>> = {
  'models/rb22.glb': 'rb22.glb',
  'models/rb22-lite.glb': 'rb22-lite.glb',
  'videos/Ver2024.mp4': 'Ver2024.mp4',
};

/**
 * 把 `models/rb22.glb` 这类逻辑路径解析成浏览器可用的真实地址。
 *
 * 用 new URL(path, base) 而不是字符串拼接：base 带不带尾斜杠、path 带不带前导斜杠
 * 都能拼对，避免出现 `https://host//models/x.glb` 这种双斜杠（部分 CDN 会当成两个不同对象）。
 */
export function assetUrl(path: string): string {
  if (!ASSET_BASE_URL || (!import.meta.env.PROD && !USE_CDN_IN_DEV)) {
    return `${import.meta.env.BASE_URL}${path}`;
  }
  // 视频走香港自定义域名；模型仍走成都。VIDEO_ASSET_BASE_URL 为空时退回成都。
  const base =
    path.startsWith('videos/') && VIDEO_ASSET_BASE_URL ? VIDEO_ASSET_BASE_URL : ASSET_BASE_URL;
  return new URL(REMOTE_KEYS[path] ?? path, base).href;
}
