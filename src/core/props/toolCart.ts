/**
 * 移动工具车：放在车右前方。
 *
 * 它存在的唯一理由是构图——默认机位右下角原本是一整片空地板，
 * 车和墙之间没有任何东西，画面「塌」下去。一个 1 米高的深色箱体
 * 放在中景，视线就有了落点，同时不挡车。
 *
 * 造型：箱体 + 三层抽屉 + 顶部托盘 + 四个脚轮 + 推手，
 * 全黑 + 一条车队红饰条，和工具墙保持同一套语言。
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';

export function createToolCart(): Group {
  const cfg = SHOWROOM_CONFIG.toolCart;
  const group = new Group();
  group.name = 'showroom-tool-cart';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const bodyMaterial = new MeshStandardMaterial({
    color: cfg.bodyColor,
    roughness: 0.45,
    metalness: 0.55,
  });
  const accentMaterial = new MeshStandardMaterial({
    color: cfg.accentColor,
    roughness: 0.38,
    metalness: 0.35,
  });
  const wheelMaterial = new MeshStandardMaterial({
    color: cfg.wheelColor,
    roughness: 0.95,
    metalness: 0.05,
  });

  const wheelRadius = 0.06;
  const bodyHeight = cfg.height - wheelRadius * 2 - 0.04;
  const bodyBottom = wheelRadius * 2;

  const body = new Mesh(
    new BoxGeometry(cfg.width, bodyHeight, cfg.depth),
    bodyMaterial,
  );
  body.position.y = bodyBottom + bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 顶部托盘：比箱体略大一圈，像真的工具车台面
  const tray = new Mesh(
    new BoxGeometry(cfg.width + 0.04, 0.03, cfg.depth + 0.04),
    bodyMaterial,
  );
  tray.position.y = bodyBottom + bodyHeight + 0.015;
  tray.castShadow = true;
  group.add(tray);

  // 正面三层抽屉：面板 + 拉手
  const drawerHeight = bodyHeight * 0.22;
  for (let index = 0; index < 3; index++) {
    const y = bodyBottom + bodyHeight * 0.2 + index * (drawerHeight + 0.03);

    const panel = new Mesh(
      new BoxGeometry(cfg.width * 0.9, drawerHeight, 0.02),
      bodyMaterial,
    );
    panel.position.set(0, y, cfg.depth / 2 + 0.011);
    panel.castShadow = true;
    group.add(panel);

    const handle = new Mesh(
      new BoxGeometry(cfg.width * 0.34, 0.025, 0.025),
      accentMaterial,
    );
    handle.position.set(0, y, cfg.depth / 2 + 0.03);
    group.add(handle);
  }

  // 箱体侧面一条红饰条，和工具墙呼应
  const stripe = new Mesh(new BoxGeometry(0.012, 0.05, cfg.depth), accentMaterial);
  stripe.position.set(cfg.width / 2 + 0.007, bodyBottom + bodyHeight * 0.5, 0);
  group.add(stripe);

  // 四个脚轮：圆柱轴向默认 Y，绕 Z 转 90° 变成横向滚轮
  for (const x of [cfg.width / 2 - 0.1, -(cfg.width / 2 - 0.1)]) {
    for (const z of [cfg.depth / 2 - 0.1, -(cfg.depth / 2 - 0.1)]) {
      const wheel = new Mesh(
        new CylinderGeometry(wheelRadius, wheelRadius, 0.05, 14),
        wheelMaterial,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, wheelRadius, z);
      group.add(wheel);
    }
  }

  // 推手：两根立柱 + 一根横杆，立在后侧
  for (const x of [cfg.width / 2 - 0.12, -(cfg.width / 2 - 0.12)]) {
    const post = new Mesh(new BoxGeometry(0.03, 0.34, 0.03), bodyMaterial);
    post.position.set(x, cfg.height + 0.05, -cfg.depth / 2 + 0.04);
    post.castShadow = true;
    group.add(post);
  }

  const bar = new Mesh(new BoxGeometry(cfg.width - 0.2, 0.03, 0.03), accentMaterial);
  bar.position.set(0, cfg.height + 0.22, -cfg.depth / 2 + 0.04);
  group.add(bar);

  return group;
}
