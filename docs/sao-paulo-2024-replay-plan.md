# 2024 圣保罗大奖赛 · 后墙三屏逐圈回放

> 状态：**已实现，待作者浏览器验收**
> 日期：2026-11-05
> 范围：后墙三屏（主屏 + 左右副屏）、遥测数据、相关文档
> 不涉及：车模、灯光、相机、升降台、前墙视频内容、热点

---

## 0. 一句话

把后墙三屏从「2026 上海站 Q3 单圈静态遥测」改成「2024 圣保罗正赛逐圈回放」：
按正赛原定 **71 圈**展示，前 69 圈用 OpenF1 官方遥测，第 70、71 圈没有真数据、
显示红旗占位；每圈 **1.5s**，主屏是回放仪表盘，左屏速度/RPM，右屏油门/刹车/挡位/分段；
第 33 圈的真实红旗中断单独处理；播完 71 圈定格 5s 后循环。

---

## 1. 数据

### 1.1 来源

[OpenF1](https://openf1.org/)（非官方，源头是 F1 live timing），2024 圣保罗正赛：

| 项 | 值 |
| --- | --- |
| session_key | `9636`（2024-11-03 Race） |
| 车手 | `driver_number=1`，Max Verstappen / Oracle Red Bull Racing / #1 |
| 官方分类 | 69 圈（原定 71 圈，红旗后按 69 圈完赛） |
| 展示圈数 | 71 圈；第 70、71 圈没有遥测，红旗占位 |
| 赛道 | Autódromo José Carlos Pace（Interlagos），4.309 km |
| 比赛窗口采样 | 28,447 点，原生约 3.7 Hz |
| 完赛 | P1，2:06:54.430，26 分；起步 P17 |
| 红旗 | 第 33 圈，官方圈速 1556.410s（25:56.410），其中静止约 1433s |

用到的 OpenF1 端点（生成时一次性拉取，运行时不联网）：

```
/v1/sessions?year=2024&country_name=Brazil          → 9636
/v1/car_data?session_key=9636&driver_number=1       → speed / rpm / n_gear / throttle / brake
/v1/laps?session_key=9636&driver_number=1           → 圈速 / 三段 / pit out
/v1/position?session_key=9636&driver_number=1       → 逐圈名次
/v1/weather?session_key=9636                        → 气温 / 赛道温 / 风速
/v1/race_control?session_key=9636                   → SC / VSC / RED / CHEQUERED
/v1/session_result?session_key=9636                 → 完赛成绩
/v1/drivers?session_key=9636                        → 车手 / 车队
```

### 1.2 处理规则

1. **按圈切片**：第 N 圈从 `date_start` 切到第 N+1 圈 `date_start`。
2. **第 33 圈红旗**：只保留进站前的行驶段（约 25s，到连续静止为止），
   `redFlag: true`、`suspendedSeconds: 1433`；`time` 保留 1556.410，
   主屏日志显示「RED FLAG」而不是 25:56.410。
3. **第 70、71 圈**：没有遥测，`samples: []`、`time: null`、`flag: "RED"`、
   `redFlag: true`；回放里各占 1.5s，只显示红旗卡片。
4. **逐圈名次**：取该圈起点之前最近一条 `position` 事件。
   第 1 圈 P17；第 44 圈起 P1；完赛 P1。
5. **逐圈天气**：取该圈起点之前最近一条 `weather`（air / track / wind），
   主屏右上角随圈数变化；不显示降雨布尔值（该场数据在雨停前后有跳变，容易误读）。
6. **逐圈状态**：只烘焙全场级状态 `GREEN / VSC / SC / RED / CHEQUERED`；
   局部黄旗不改变整圈状态。实际会出现：28 圈 VSC、31–32 圈 SC、33 圈 RED、
   40–42 圈 SC、69 圈 CHEQUERED、70–71 圈 RED。
7. **数值压缩**：`t` 保留 2 位小数；`rpm` 取整到 10；`speed / gear / throttle / brake` 取整。
8. **派生统计**：每圈预计算 `topSpeed`、`avgSpeed`、`fullThrottle`；红旗圈在画面上显示破折号。

### 1.3 输出

`src/data/ver-2024-sao-paulo-race.json`（561 KB，约 0.55 MB）：

```jsonc
{
  "driver": "VER",
  "driverName": "Max Verstappen",
  "team": "Oracle Red Bull Racing",
  "carNumber": 1,
  "event": "2024 São Paulo Grand Prix",
  "eventOfficialName": "FORMULA 1 LENOVO SÃO PAULO GRAND PRIX 2024",
  "eventName": "SÃO PAULO GRAND PRIX",
  "session": "Race",
  "round": 21,
  "date": "2024-11-03",
  "dateLabel": "03 NOV 2024",
  "circuit": "Autódromo José Carlos Pace",
  "location": "Interlagos · São Paulo",
  "laps": 71,
  "classifiedLaps": 69,
  "scheduledLaps": 71,
  "lapDistanceKm": 4.309,
  "raceDistanceKm": 305.939,
  "classifiedDistanceKm": 297.321,
  "sampleRateHz": 3.7,
  "source": "OpenF1 (unofficial, F1 live timing)",
  "sessionKey": 9636,
  "grid": 17,
  "finishPosition": 1,
  "finishTimeSeconds": 7614.43,
  "points": 26,
  "lapList": [
    {
      "lap": 1,
      "time": 99.654,
      "sectors": [31.684, 49.176, 18.794],
      "position": 17,
      "flag": "GREEN",
      "topSpeed": 313,
      "avgSpeed": 155.7,
      "fullThrottle": 22.8,
      "weather": { "air": 22.5, "track": 25.1, "wind": 0.6 },
      "redFlag": false,
      "suspendedSeconds": 0,
      "samples": [[0.0, 0, 0, 0, 0, 0]]
    }
  ]
}
```

`samples` 每行固定 6 个数：`[t, speed, rpm, gear, throttle, brake]`。
旧文件 `src/data/ver-2026-shanghai-q3.json` 已删除。

### 1.4 体积与边界

- JSON 561 KB；构建后 JS 1.43 MB / gzip 405 KB（比原来多约 0.2 MB gzip）。
- README 原来的「只放单圈片段」不再成立，已改成「只保留展示所需的 69 圈官方遥测 +
  2 圈红旗占位，不提供原始数据下载、不批量分发」；仍标注 OpenF1 非官方来源。

---

## 2. 动画与视觉

### 2.1 时间轴

三块屏共用同一个 `elapsedSeconds`，天然同步：

```
0 – 1.5s          上电扫描（主屏先亮，副屏 +0.12s）
1.5s 起           第 1 圈
每 1.5s          圈数 +1，遥测播放头扫完整圈
1.5 + 71×1.5     第 71 圈结束（第 70/71 圈是红旗占位）
+ 5s             FINISH 定格
+ 循环           回到第 1 圈
```

常量在 `src/config/raceReplay.ts`：

```ts
export const RACE_REPLAY_CONFIG = {
  startDelaySeconds: 1.5,
  lapSeconds: 1.5,
  finishHoldSeconds: 5,
  screenRefreshSeconds: 0.15
} as const;
```

圈内进度：

```ts
const local = max(0, elapsedSeconds - 1.5);
const cycle = 71 * 1.5 + 5;                 // 111.5s
const cycleTime = local % cycle;
const lapIndex = min(70, floor(cycleTime / 1.5));
const lapProgress = cycleTime < 106.5
  ? (cycleTime - lapIndex * 1.5) / 1.5
  : 1;
const dataSeconds = lapProgress * telemetrySecondsOf(lap);
```

第 33 圈只有约 25s 的行驶段，`telemetrySecondsOf` 取最后一个采样，
所以不会把 25 分钟静止段塞进 1.5s 动画。

### 2.2 主屏（2048×1024）

- 顶部：`FORMULA 1 LENOVO SÃO PAULO GRAND PRIX 2024` + `INTERLAGOS · SÃO PAULO · 03 NOV 2024`。
- 顶栏：红色 `RACE` / `ROUND 21 · 2024`；`LAP xx / 71`；状态点（GREEN / SC / VSC / RED /
  CHEQUERED）；`305.9 KM · 71 LAPS`；`CLASSIFIED 69 LAPS · OPENF1`；真实天气 TRACK / AIR / WIND。
- 左区：`CURRENT LAP` + 大号圈数 + `/ 71`；当前圈速（或 `RED FLAG` / `FINISH`）；
  名次块 `Pxx` + `GRID P17 · FINISH P1`；车手 / 车队；三个统计块
  （TOP SPEED / AVG SPEED / FULL THROTTLE）；S1 / S2 / S3。
- 右区：本圈速度曲线（整圈暗线 + 已跑亮线 + 播放头）；逐圈日志（最近 5 行，
  新行追加、当前行高亮、红旗行显示 `RED FLAG`）；71 格时间轴（按圈状态染色）。
- 底栏：`RED BULL RACING #1`、`RACE REPLAY · 1 LAP = 1.5S · 71 LAPS`、
  `DATA · OPENF1 (UNOFFICIAL) · RB22`。
- 第 71 圈（两圈红旗占位播完）后：`FINISH` / `2:06:54.430` / P1 / 69 圈统计；5s 后回第 1 圈。

### 2.3 左副屏（速度 / RPM）

- 标题 `AUX 01 · LAP TELEMETRY · SPEED`。
- 大字当前速度 + `km/h`、`GEAR`、`RPM`。
- 整圈速度曲线 + 播放头（和主屏同一条数据）。
- `TOP SPEED` / `AVG SPEED` / `FULL THROTTLE`。
- 底部 `VER · LAP xx/71`、`1.5S / LAP`。

### 2.4 右副屏（输入 / 分段）

- 标题 `AUX 02 · LAP TELEMETRY · INPUTS`。
- 大字油门 % / 刹车 % / 挡位。
- 油门（绿）/ 刹车（红）双曲线 + 播放头。
- 三段用时 S1 / S2 / S3，本圈圈速 + 到当前个人最快圈的 Δ。
- 底部 `LAP x:xx.xxx · Δ BEST`、`1.5S / LAP`。

### 2.5 红旗圈

- 第 33 圈：主屏显示 `RED FLAG` / `RACE SUSPENDED · 25:56.410`；
  右区红色斜纹 + `SIGNAL SUSPENDED`；左右副屏红色卡片。
- 第 70、71 圈：主屏显示 `RED FLAG` / `RACE ENDED · OFFICIAL 69 LAPS`；
  右区 `NO LAPS RAN · OFFICIAL CLASSIFICATION`；左右副屏红色卡片。
- 三个红旗圈都只占 1.5s，然后继续下一圈；日志里对应行显示 `RED FLAG`。

### 2.6 上电、刷新与性能

- 上电扫描 1.3s，副屏延后 0.12s；1.5s 后发车。
- 三屏按 0.15s（约 6.7fps）重画；上电期间仍按 30fps 扫描。
- 主屏原来的随机颗粒改成 `hash01` 确定性颗粒（数量 1200），避免 6.7fps 下闪成雪花。
- 低端机如果卡顿，把 `screenRefreshSeconds` 调到 0.2 即可。

---

## 3. 代码改动

| 文件 | 改动 |
| --- | --- |
| `src/data/ver-2024-sao-paulo-race.json` | 新增，561 KB，71 圈（69 圈官方 + 2 圈红旗占位） |
| `src/data/ver-2026-shanghai-q3.json` | 删除 |
| `src/config/raceReplay.ts` | 新增：时间轴与三屏刷新率 |
| `src/config/showroom.ts` | 主屏 / 副屏 `refreshSeconds` 改读 `RACE_REPLAY_CONFIG.screenRefreshSeconds` |
| `src/core/ProceduralTextures.ts` | 主屏、左右副屏全部重写；新增回放状态机、逐圈采样、日志、时间轴、红旗 / 完赛卡片；删除上海 Q3 数据与旧曲线函数；视频海报的底纹改用第 69 圈 |
| `src/core/props/raceWall.ts` | 副屏类型 `'energy'\|'aero'` → `'speed'\|'inputs'`；更新刷新注释 |
| `README.md` | 功能表、遥测章节、版权边界 |
| `PROJECT_CONTEXT.md` | 目录说明、三屏说明、阶段清单 |
| `AGENTS.md` | 规模、源码地图、数据文件行 |

**未改**：`App.vue`、`SceneManager.ts`、`Showroom.ts`、`LiftStage.ts`、车模、灯光、相机、
前墙视频、热点、`package.json`（无新增依赖）、`src/config/videoScreen.ts`
（正赛圈数继续按原定 **71** 圈，和展示口径一致）。

---

## 4. 验收

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `preview.html?view=wall` 实测：
   - 上电后第 1 圈开始，圈数每 1.5s +1，直到 71。
   - 主屏圈速 / 名次 / 曲线 / 日志随圈数变化；日志逐圈追加。
   - 左屏速度 / RPM / TOP-AVG-FULL 与当前圈一致；右屏油门/刹车/挡位/三段一致。
   - 第 33 圈红旗卡片，1.5s 后第 34 圈；第 70、71 圈红旗占位。
   - 第 71 圈后 FINISH 定格 5s，再回第 1 圈。
   - 三屏同一圈同步；文字不溢出。
4. 文档里不再有「当前数据是上海 Q3」的表述。
   `PROJECT_CONTEXT.md:471` 的「移除旧上海站前墙视频」是历史迁移记录，保留事实不改写。

> 视觉 / 手感最终由作者在浏览器拍板；本文档记录的是实现口径与已核对的无头截图结果。

---

## 5. 已知取舍

| 取舍 | 说明 |
| --- | --- |
| 第 70/71 圈是合成占位 | 官方只跑到 69 圈；按作者要求补到 71，画面明确写 `RACE ENDED · OFFICIAL 69 LAPS`，不伪造遥测 |
| 第 33 圈只保留行驶段 | 25 分钟静止段会撑爆 1.5s 时间轴；日志仍保留真实圈速 25:56.410 |
| 逐圈名次是近似值 | OpenF1 位置事件稀疏，按圈起点取最近一条；画面只显示到整数名次 |
| 0.55 MB JSON 进 bundle | 当前车模 6.6 MB、视频 66 MB，0.2 MB gzip 可接受；不改成运行时 fetch，避免新增异步状态 |
| 刷新率 0.15s | 1.5s 一圈约 10 帧；低端机可退到 0.2s |
| `docs/*.png` 未重跑 | 旧截图里可能还带上海字标；按项目约定不重跑整套截图流水线 |
