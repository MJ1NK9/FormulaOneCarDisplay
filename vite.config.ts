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
  },
});
