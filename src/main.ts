/**
 * 应用入口：只做装配。
 *
 * 这里只允许三件事：找到挂载点 → 创建 SceneManager → 把要展示的对象挂进去并启动循环。
 * 任何 Three.js 的构造/参数/渲染逻辑都必须放进 core/ 或 config/（约定 §9.11）。
 */
import './style.css';
import { SceneManager } from './core/SceneManager';
import { createPlaceholderCube } from './dev/placeholderCube';

const container = document.querySelector<HTMLElement>('#app');
if (container === null) {
  throw new Error('页面缺少 #app 容器，无法初始化 WebGL');
}

const app = new SceneManager(container);

// TODO(Phase 2)：接入真实模型后删除这行占位立方体
app.scene.add(createPlaceholderCube());

app.start();
