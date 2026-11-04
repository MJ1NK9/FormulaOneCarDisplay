/**
 * GPU 资源释放：three 不会因为对象从场景里移除就回收显存。
 *
 * 几何体、材质、贴图都必须显式 dispose；漏掉的话 SPA 里来回切页会一点点吃光显存。
 * 材质与贴图用 Set 去重：同一个贴图常被多个材质共享（轮毂、碳纤维），
 * 重复 dispose 虽然不崩，但会让去重表白跑一遍。
 *
 * 展台、升降台、车模都走这一个入口，避免三处各写一份、迟早漏掉某一类资源。
 */
import { Mesh, Texture, type Material, type Object3D } from 'three';

export function disposeObject3D(root: Object3D): void {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;

    object.geometry.dispose();
    const list = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of list) {
      materials.add(material);
      // 贴图挂在材质的某个字段上（map / normalMap / emissiveMap…），只能反射着找
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();

  root.removeFromParent();
  root.clear();
}
