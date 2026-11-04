/**
 * 应用入口：只做装配 —— 创建 Vue 应用并挂载到 #app。
 *
 * 3D 的初始化不在这里：它依赖 DOM 就绪，放在 App.vue 的 onMounted 中。
 */
import './style.css';
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
