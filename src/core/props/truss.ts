/**
 * 顶部灯桁架：纯造型件，负责给画面「上边」一条结构线。
 *
 * 重要：整组 castShadow = false。
 * 主光（SpotLight）在桁架上方，如果桁架参与阴影，横梁会把自己的影子投到车上，
 * 车顶会莫名其妙出现几道黑条。灯头同理。
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';

export function createTruss(): Group {
  const cfg = SHOWROOM_CONFIG.truss;
  const group = new Group();
  group.name = 'showroom-truss';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const frameMaterial = new MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.45,
    metalness: 0.85,
  });
  const stripMaterial = new MeshStandardMaterial({
    color: '#05070a',
    emissive: cfg.stripColor,
    emissiveIntensity: cfg.stripIntensity,
    roughness: 1,
    metalness: 0,
  });

  const { width, depth, beam } = cfg;

  // 两根纵向主梁（沿 X）
  for (const z of [depth / 2, -depth / 2]) {
    const bar = new Mesh(new BoxGeometry(width, beam, beam), frameMaterial);
    bar.position.set(0, 0, z);
    group.add(bar);

    // 梁底一条发光带，制造「灯在上面」的暗示，真实照明由 SpotLight 负责
    const strip = new Mesh(new BoxGeometry(width * 0.94, 0.03, 0.07), stripMaterial);
    strip.position.set(0, -beam / 2 - 0.02, z);
    group.add(strip);
  }

  // 两端横梁（沿 Z）
  for (const x of [width / 2 - beam / 2, -(width / 2 - beam / 2)]) {
    const bar = new Mesh(new BoxGeometry(beam, beam, depth), frameMaterial);
    bar.position.set(x, 0, 0);
    group.add(bar);
  }

  // 中间一根横梁，让桁架看起来是「田」字结构而不是空框
  const middle = new Mesh(new BoxGeometry(width, beam * 0.75, beam * 0.75), frameMaterial);
  middle.position.set(0, 0, 0);
  group.add(middle);

  // 灯头：吊在横梁下面，朝车
  for (const x of [-2.2, 0, 2.2]) {
    const housing = new Mesh(
      new BoxGeometry(0.34, 0.2, 0.34),
      new MeshStandardMaterial({ color: '#151a21', roughness: 0.4, metalness: 0.7 }),
    );
    housing.position.set(x, -cfg.lampDrop, 0);
    group.add(housing);

    const lens = new Mesh(
      new CylinderGeometry(0.1, 0.1, 0.03, 20),
      new MeshStandardMaterial({
        color: '#05070a',
        emissive: cfg.stripColor,
        emissiveIntensity: cfg.stripIntensity * 1.4,
        roughness: 1,
        metalness: 0,
      }),
    );
    lens.position.set(x, -cfg.lampDrop - 0.11, 0);
    group.add(lens);
  }

  group.traverse((object) => {
    object.castShadow = false;
    object.receiveShadow = false;
  });

  return group;
}
