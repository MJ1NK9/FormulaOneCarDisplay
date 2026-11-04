/**
 * Vite 配置。
 *
 * 两件事：
 * 1. 注册 Vue 单文件组件（.vue）的编译插件；
 * 2. 构建完之后，把「线上由 COS 提供的大文件」从 dist 里删掉。
 *
 * 第 2 条为什么必须做：免费静态托管（EdgeOne Pages / Cloudflare Pages）限制单文件
 * 25MB，高模 36MB、视频 66MB 传上去会直接失败；而且这两个文件每次构建都白白复制一遍
 * 109MB。本地开发仍然从 public/ 读，所以开发体验不受影响。
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

/**
 * 线上不由站点自身提供的文件，和 src/config/assets.ts 的 REMOTE_KEYS 一一对应。
 * 两边对不上时：漏删会让部署失败，多删只是线上 404 —— 所以宁可多写。
 */
const REMOTE_ONLY_FILES = ['models/rb22.glb', 'models/rb22-lite.glb', 'videos/Ver2024.mp4'];

/** 构建后清理 dist 里的超大文件 */
function dropRemoteAssets(): Plugin {
  let outDir = '';

  return {
    name: 'rb22-drop-remote-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // closeBundle 在 writeBundle 之后执行，此时 dist/ 已经写完
    async closeBundle() {
      await Promise.all(REMOTE_ONLY_FILES.map((file) => rm(resolve(outDir, file), { force: true })));
    },
  };
}

export default defineConfig({
  plugins: [vue(), dropRemoteAssets()],
  server: {
    port: 5173,
    // 端口被占用时直接报错，而不是偷偷换一个端口导致你以为访问错了地址
    strictPort: true,
    watch: {
      /**
       * 不监听本地工具目录。
       * 为什么必须加：Vite 默认监听项目根目录下的所有文件，而 .tools/ 里是
       * KTX-Software 的工具包（解压出上千个 HTML 文档）。一旦有文件增删，
       * Vite 会逐个触发 page reload，既刷屏又耗尽文件句柄，最终把 dev server 拖崩。
       * 注意 .gitignore 只管 Git，不管 Vite 的文件监听，所以这里要单独声明。
       */
      ignored: ['**/.tools/**'],
    },
  },
});
