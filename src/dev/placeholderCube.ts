/**
 * Phase 1 专用的占位物：用来验证渲染循环、相机、光照与 OrbitControls 是否正常。
 *
 * 它不在 Project 的架构约定里，属于临时脚手架 —— Phase 2 接入 rb19.glb 后，
 * 连同这个文件一起删除。
 */
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

/** 占位物边长：配合默认相机距离（约 11.5 单位），立方体约占画面高度的 1/4 */
const PLACEHOLDER_SIZE = 2.2;

export function createPlaceholderCube(): Mesh {
  const geometry = new BoxGeometry(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  const material = new MeshStandardMaterial({
    color: '#2f6bff',
    roughness: 0.35,
    metalness: 0.15,
  });

  const cube = new Mesh(geometry, material);
  cube.name = 'phase1-placeholder';
  // 稍微倾斜：让三条棱都不与坐标轴平行，能一眼看出透视关系是否正常
  cube.rotation.set(0.4, 0.6, 0);

  return cube;
}
