/**
 * Vite 配置。
 *
 * 只做一件事：注册 Vue 单文件组件（.vue）的编译插件。
 * 没有它，import './App.vue' 会在构建时报「无法解析 .vue 文件」。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
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
