# 车头前墙视频大屏素材

## `Ver2024.mp4`

- **内容**：2024 巴西圣保罗大奖赛雨战剪辑《"Where is Max?"》，B 站 UP 主
  [一只萌萌哒chara](https://space.bilibili.com/474208350) 的
  [BV1AJgP6GEPo](https://www.bilibili.com/video/BV1AJgP6GEPo/)（原片 4K · 8:47）；
  屏幕下方控制条显示的赛事 / 标题也在
  [`src/config/videoScreen.ts`](../../src/config/videoScreen.ts) 里。
- **规格**：1280×720、H.264 + AAC、30 fps、8:46、约 66 MB。
- **引用方式**：`VIDEO_SCREEN_CONFIG.src = 'videos/Ver2024.mp4'`，运行时由
  `import.meta.env.BASE_URL` 拼成 `/videos/Ver2024.mp4`。dev 和 build 都从
  `public/videos/` 取文件；**不要**从 `dist/videos/` 直接引用（`dist/` 是构建产物，
  每次 `vite build` 都会被清空重建）。
- **来源**：用户提供的本地文件，源文件最初放在 `dist/videos/Ver2024.mp4`，
  已复制一份到 `public/videos/` 作为 Vite 静态资源。
- **版权**：视频版权归 UP 主「一只萌萌哒chara」与哔哩哔哩所有；本项目只做非商业展示、
  已完整署名（页面标题条 + 本文件 + 根目录 README），商业使用请先取得 UP 主授权。
  如果版权方要求下架，删除本文件并把 `src` 指向替换后的视频即可；文件缺失时屏幕会
  回退到「视频信号暂不可用」海报，不影响其他展示与交互。

换片时同步改 `VIDEO_SCREEN_CONFIG` 的 `src` / `durationSeconds` / `title` /
`eventLabel`，并确认新文件是 **MP4 / H.264 + AAC**、带 `-movflags +faststart`
（首帧和拖动跳转都更稳）。屏幕是 2:1、视频通常是 16:9，`videoWall.ts` 按 **cover**
裁切，不拉伸变形；1080p 左右即可，4K 只会增加解码压力。

## `sao-paulo-2024-cover.jpg`

同一视频的 B 站封面，`VIDEO_SCREEN_CONFIG.posterUrl` 引用它，作为加载态 / 失败态
海报的压暗底图（海报主体仍是程序化 canvas）。图片缺失或 404 时海报照常工作。
不直接热链 B 站 CDN：那张图带 Referer 校验，站外页面会 403。
