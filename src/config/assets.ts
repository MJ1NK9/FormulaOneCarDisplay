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
 * 为什么视频要分域名：
 * 2024 年后创建的 COS 桶，默认域名会给对象加 `x-cos-force-download: true` 和
 * `Content-Disposition: attachment`。Chrome 会忽略这个头，但 Safari/WebKit 会把
 * `<video>` 的源当成下载，导致 iPhone 上视频不播。视频放到香港桶并绑定自定义
 * 源站域名（香港桶不需要 ICP 备案）后就不会带这个头；车模不受影响，继续留成都。
 *
 * 为什么还要按设备分流（2026-11）：
 * 香港桶在境外，境内访问要走一段国际链路，而成都桶就在大陆；两个桶里本来就是
 * 同一份视频（CRC64 一致）。所以只在「真的会被强制下载头坑到」的 WebKit 设备上
 * 用香港自定义域名，其余设备继续用成都默认域名 —— 成都桶 CORS 是 `*`，Chrome
 * 不看 attachment，速度和稳定性都更好。
 */
export const ASSET_BASE_URL = 'https://formula-one-1317097570.cos.ap-chengdu.myqcloud.com/';

/**
 * 视频专用：香港桶的自定义源站域名。
 * 和成都默认域名相比，它不会注入强制下载头，Safari 才能正常播放。
 * 只在 WebKit 设备（见 `prefersCustomDomainVideo`）上使用；其余设备走成都。
 */
export const VIDEO_ASSET_BASE_URL = 'https://assets.mj1nk9.space/';

/**
 * 判断当前设备是否需要「不带强制下载头」的视频源。
 *
 * 触发条件只有一类：WebKit 的媒体加载器会把 `Content-Disposition: attachment`
 * 当成下载而不是播放。具体是：
 * - iOS / iPadOS：iPhone、iPad（iPadOS 13+ 默认「请求桌面网站」，UA 里是
 *   `Macintosh`，只能靠 `maxTouchPoints > 1` 认出来）；
 * - macOS 上的 Safari：同样走 WebKit 媒体栈，症状和 iPhone 一致
 *   （Chrome / Edge / Firefox 用各自的媒体栈，不受影响）。
 *
 * 为什么不在运行时试错（先成都、error 再换香港）：<video> 的 error 事件不区分
 * 「强下载」「CORS」「编码不支持」，回退一次要多等一个超时周期，还会把首帧
 * 拖到十几秒后；直接按 UA 判断是确定的，失败了也不会有「换了源就能播」的假象。
 */
function prefersCustomDomainVideo(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;

  // iOS 上所有浏览器（含 Chrome iOS / Firefox iOS）都是 WebKit，所以按平台判断
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
  if (isIOS) return true;

  // macOS Safari：UA 里有 Safari 但没有任何 Chromium / Gecko 标记
  const isMacSafari =
    /Macintosh/.test(ua) &&
    /Safari\//.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  return isMacSafari;
}

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
  // 视频：WebKit 设备走香港自定义域名（无强制下载头），其余设备走成都
  // （同内容、境内更快、CORS 已是 `*`）；模型始终走成都。
  const base =
    path.startsWith('videos/') && VIDEO_ASSET_BASE_URL && prefersCustomDomainVideo()
      ? VIDEO_ASSET_BASE_URL
      : ASSET_BASE_URL;
  return new URL(REMOTE_KEYS[path] ?? path, base).href;
}
