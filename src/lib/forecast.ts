// 洋流漂流几何与预报滚动重算的纯函数引擎
// 不依赖 React / zustand，便于单测与迁移复用。
import type {
  DriftPoint,
  Forecast,
  Mission,
  RescueAsset,
  SearchArea
} from './types';

const EARTH_RADIUS_NM = 3440.065;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** 等角航线航位推算：从 (lat,lng) 沿恒定罗经方位 bearingDeg 航行 distNm 海里（洋流漂流模型） */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceNm: number
): { lat: number; lng: number } {
  const δ = distanceNm / EARTH_RADIUS_NM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const Δφ = δ * Math.cos(θ);
  const φ2 = φ1 + Δφ;
  const Δψ = Math.log(
    Math.tan(Math.PI / 4 + φ2 / 2) / Math.tan(Math.PI / 4 + φ1 / 2)
  );
  // 正东/正西时退化为该纬度平行圈
  const q = Math.abs(Δψ) > 1e-12 ? Δφ / Δψ : Math.cos(φ1);
  const Δλ = Math.abs(q) < 1e-12 ? 0 : (δ * Math.sin(θ)) / q;
  return { lat: toDeg(φ2), lng: ((toDeg(λ1 + Δλ) + 540) % 360) - 180 };
}

/** 基准点随预报洋流漂流至 at 时刻的投影位置 */
export function projectDrift(
  anchor: Pick<DriftPoint, 'lat' | 'lng' | 'observedAt'>,
  forecast: Forecast,
  atIso: string
): { lat: number; lng: number; hours: number; driftNm: number } {
  const hours = Math.max(
    0,
    (Date.parse(atIso) - Date.parse(anchor.observedAt)) / 3_600_000
  );
  const driftNm = forecast.currentKnots * hours;
  const pos = destinationPoint(
    anchor.lat,
    anchor.lng,
    forecast.currentDirDeg,
    driftNm
  );
  return { ...pos, hours, driftNm };
}

/** 搜索半径随时间增长的不确定度（海里），封顶 14nm */
export function areaRadiusNm(hours: number): number {
  return Math.round(Math.min(14, 7 + hours * 0.4) * 10) / 10;
}

/** 以点为中心按海里半径取方形边界 [west, south, east, north] */
export function squareBounds(
  lat: number,
  lng: number,
  radiusNm: number
): [number, number, number, number] {
  const dLat = radiusNm / 60;
  const dLng = radiusNm / (60 * Math.cos(toRad(lat)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export function centerOf(bounds: SearchArea['bounds']): [number, number] {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

export function radiusOf(bounds: SearchArea['bounds']): number {
  const [lng, lat] = centerOf(bounds);
  const w = ((bounds[2] - bounds[0]) * 60 * Math.cos(toRad(lat))) / 2;
  const h = ((bounds[3] - bounds[1]) * 60) / 2;
  return Math.round(Math.max(w, h) * 10) / 10;
}

const stripVersionSuffix = (name: string) =>
  name.replace(/（v\d+）\s*$/, '').replace(/\s*v\d+$/, '').trim();

function areaName(baseName: string, version: number): string {
  return `${stripVersionSuffix(baseName)}（v${version}）`;
}

/** 由已核实锚点 + 当前预报构造一个推算漂流点 */
export function buildProjection(
  anchor: DriftPoint,
  forecast: Forecast,
  atIso: string,
  id: string
): DriftPoint {
  const p = projectDrift(anchor, forecast, atIso);
  return {
    id,
    label: `${anchor.label}·v${forecast.version}漂流推算`,
    kind: 'projection',
    status: 'current',
    lat: p.lat,
    lng: p.lng,
    observedAt: atIso,
    forecastVersion: forecast.version,
    basedOnPointId: anchor.id,
    targetKey: anchor.targetKey,
    note: `依据预报v${forecast.version}（流向${forecast.currentDirDeg}° / ${forecast.currentKnots}节）推算，漂移${p.driftNm.toFixed(1)}海里`
  };
}

/** 由锚点投影构造搜索区（新区或接替区） */
export function buildArea(
  baseName: string,
  anchor: DriftPoint,
  forecast: Forecast,
  atIso: string,
  id: string,
  status: SearchArea['status'] = 'active'
): SearchArea {
  const p = projectDrift(anchor, forecast, atIso);
  const radius = areaRadiusNm(p.hours);
  return {
    id,
    name: areaName(baseName, forecast.version),
    bounds: squareBounds(p.lat, p.lng, radius),
    status,
    coverage: 0,
    center: [p.lat, p.lng],
    radiusNm: radius,
    forecastVersion: forecast.version,
    anchorPointId: anchor.id,
    legacy: false,
    supersededByAreaId: null,
    replacedAt: null
  };
}

export interface CoreState {
  points: DriftPoint[];
  areas: SearchArea[];
  missions: Mission[];
  assets: RescueAsset[];
}

export interface CoreEvent {
  actor: string;
  message: string;
}

export interface RollResult extends CoreState {
  events: CoreEvent[];
  /** 旧区 id -> 接替区 id */
  areaMap: Record<string, string>;
}

export type Uid = () => string;

const isAreaLive = (s: SearchArea['status']) => s === 'active' || s === 'planned';
const isMissionWorking = (s: Mission['status']) =>
  s === 'dispatched' || s === 'in_progress' || s === 'draft';

interface ReflowOutcome {
  missions: Mission[];
  assets: RescueAsset[];
  returned: Mission[];
  rehomedPending: Mission[];
  freedAssetIds: string[];
}

/**
 * 失效区任务退回待派；有接替区的把归属切到新区（仍是待派，等值班员重新下令）；
 * 单位占用按仍在执行的任务重新计算，不再被占用的 assigned 单位释放为 ready。
 */
function reflowMissionsAndAssets(
  prev: CoreState,
  areaMap: Record<string, string>,
  supersededAreaIds: Set<string>,
  forecastVersion: number | null,
  atIso: string,
  reasonFor: (hasSuccessor: boolean) => string
): ReflowOutcome {
  const returned: Mission[] = [];
  const rehomedPending: Mission[] = [];
  const missions = prev.missions.map((mission) => {
    if (mission.status === 'closed') return mission;
    const successorId = areaMap[mission.areaId];
    const oldGone = supersededAreaIds.has(mission.areaId);
    if (!successorId && !oldGone) return mission;

    if (mission.status === 'pending_dispatch') {
      if (!successorId) return mission;
      rehomedPending.push(mission);
      return {
        ...mission,
        areaId: successorId,
        forecastVersion,
        updatedAt: atIso
      };
    }

    returned.push(mission);
    return {
      ...mission,
      areaId: successorId ?? mission.areaId,
      status: 'pending_dispatch' as const,
      forecastVersion: successorId ? forecastVersion : mission.forecastVersion,
      returnedReason: reasonFor(Boolean(successorId)),
      updatedAt: atIso
    };
  });

  const occupied = new Set(
    missions
      .filter((m) => m.status === 'dispatched' || m.status === 'in_progress')
      .flatMap((m) => m.assetIds)
  );
  const freedAssetIds: string[] = [];
  const assets = prev.assets.map((asset) => {
    if (asset.status === 'assigned' && !occupied.has(asset.id)) {
      freedAssetIds.push(asset.id);
      return { ...asset, status: 'ready' as const };
    }
    return asset;
  });

  return { missions, assets, returned, rehomedPending, freedAssetIds };
}

const namesOf = (items: { name: string }[]) => items.map((i) => i.name).join('、');

/**
 * 发布新一期预报后的滚动重算：
 * 1. 旧预报下的未核实推算点全部失效；
 * 2. 已核实基准点按新洋流重新漂流投影（核实过的发现永远优先有效）；
 * 3. 现有搜索区全部作废重划：锚点仍有效则出接替区，否则无接替（等核实）；
 * 4. 旧区任务退回待派并按新区重算归属，单位占用释放。
 */
export function rollForecast(
  prev: CoreState,
  forecast: Forecast,
  atIso: string,
  uid: Uid
): RollResult {
  const events: CoreEvent[] = [];
  events.push({
    actor: '预报滚动',
    message: `接收第${forecast.version}期海况预报（流向${forecast.currentDirDeg}°、流速${forecast.currentKnots}节），调度按新预报重算`
  });

  // 1. 未核实推算随预报更新失效
  const invalidated = prev.points.filter(
    (p) => p.kind === 'projection' && p.status === 'current'
  );
  let points = prev.points.map((p) =>
    p.kind === 'projection' && p.status === 'current'
      ? { ...p, status: 'invalidated' as const }
      : p
  );
  if (invalidated.length > 0) {
    events.push({
      actor: '预报滚动',
      message: `${invalidated.length} 个未核实漂流推算点随预报v${forecast.version}更新失效，不再用于划区`
    });
  }

  // 2. 以已核实发现为锚重算投影
  const anchors = points.filter((p) => p.kind === 'verified' && p.status === 'verified');
  const projections = anchors.map((anchor) =>
    buildProjection(anchor, forecast, atIso, uid())
  );
  points = [...points, ...projections];

  // 3. 旧区作废，按新投影重划
  const currentAreas = prev.areas.filter((a) => isAreaLive(a.status));
  const supersededIds = new Set(currentAreas.map((a) => a.id));
  const areaMap: Record<string, string> = {};
  const movedAreas: SearchArea[] = [];
  const orphanAreas: SearchArea[] = [];
  const successorAreas: SearchArea[] = [];

  for (const old of currentAreas) {
    const anchor = anchors.find((a) => a.id === old.anchorPointId);
    if (!anchor) {
      orphanAreas.push(old);
      continue;
    }
    const successor = buildArea(old.name, anchor, forecast, atIso, uid(), old.status);
    areaMap[old.id] = successor.id;
    successorAreas.push(successor);
    movedAreas.push(old);
  }

  let areas = prev.areas.map((a) =>
    isAreaLive(a.status)
      ? {
          ...a,
          status: 'superseded' as const,
          replacedAt: atIso,
          supersededByAreaId: areaMap[a.id] ?? null
        }
      : a
  );
  areas = [...areas, ...successorAreas];

  if (movedAreas.length > 0) {
    events.push({
      actor: '预报滚动',
      message: `搜索区 ${namesOf(movedAreas)} 按最新洋流重划，覆盖进度清零，旧区标记失效`
    });
  }
  if (orphanAreas.length > 0) {
    events.push({
      actor: '预报滚动',
      message: `搜索区 ${namesOf(orphanAreas)} 无已核实基准点（旧图数据待核实），本轮不重划，区内任务退回待派`
    });
  }

  // 4. 任务退回待派 / 归属重算 / 单位释放
  const reflow = reflowMissionsAndAssets(
    prev,
    areaMap,
    supersededIds,
    forecast.version,
    atIso,
    (hasSuccessor) =>
      hasSuccessor
        ? `预报v${forecast.version}发布：原搜索区已重划，任务退回待派，归属重算至新区`
        : `预报v${forecast.version}发布：原搜索区无有效基准点而失效，任务退回待派，等待基准点核实`
  );

  if (reflow.returned.length > 0) {
    events.push({
      actor: '调度重算',
      message: `任务 ${namesOf(reflow.returned.map((m) => ({ name: m.title })))} 已随旧区退回待派，等待值班员重新下令`
    });
  }
  if (reflow.freedAssetIds.length > 0) {
    const freed = reflow.freedAssetIds
      .map((id) => prev.assets.find((a) => a.id === id)?.name ?? id)
      .join('、');
    events.push({
      actor: '调度重算',
      message: `单位 ${freed} 的任务占用已释放，恢复待命`
    });
  }

  return {
    points,
    areas,
    missions: reflow.missions,
    assets: reflow.assets,
    events,
    areaMap
  };
}

export interface ConfirmResult extends CoreState {
  events: CoreEvent[];
  acceptedId: string | null;
  conflictPointIds: string[];
  /** 冲突时已存在的有效基准点（另一值班员视角看到的赢家） */
  existingWinnerId: string | null;
  newAreaId: string | null;
  areaMap: Record<string, string>;
}

/**
 * 值班员提交目标确认（支持两人同时提交一批）：
 * - 同一目标只保留一份有效基准点，按最早目击时刻仲裁，平手按 id；
 * - 其余提交置 conflict 并记录输给了谁（另一人看到冲突）；
 * - 目标若已有有效基准点，后来的确认全部冲突，不会再产生锚点；
 * - 新锚点立即按当前预报生成漂流推算与搜索区，旧图区按核实结果重划。
 */
export function applyConfirmations(
  prev: CoreState,
  input: { pointIds: string[]; actor: string },
  forecast: Forecast,
  atIso: string,
  uid: Uid
): ConfirmResult {
  const submitted = input.pointIds
    .map((id) => prev.points.find((p) => p.id === id))
    .filter(
      (p): p is DriftPoint =>
        !!p && p.kind === 'unverified' && p.status === 'pending'
    );

  if (submitted.length === 0) {
    return {
      ...prev,
      events: [],
      acceptedId: null,
      conflictPointIds: [],
      existingWinnerId: null,
      newAreaId: null,
      areaMap: {}
    };
  }

  const targetKey = submitted[0].targetKey ?? submitted[0].id;
  const batch = submitted.filter((p) => (p.targetKey ?? p.id) === targetKey);
  const existing = prev.points.find(
    (p) =>
      p.kind === 'verified' &&
      p.status === 'verified' &&
      (p.targetKey ?? p.id) === targetKey
  );

  const winner =
    existing ??
    [...batch].sort((a, b) => {
      const t = Date.parse(a.observedAt) - Date.parse(b.observedAt);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    })[0];

  const loserIds = new Set(
    batch.filter((p) => p.id !== winner.id).map((p) => p.id)
  );

  const events: CoreEvent[] = [];
  let points = prev.points.map((p) => {
    if (!existing && p.id === winner.id) {
      return {
        ...p,
        kind: 'verified' as const,
        status: 'verified' as const,
        reportedBy: input.actor,
        verifiedAt: atIso,
        conflictOfPointId: null,
        legacy: false,
        note: `已由${input.actor}核实，作为漂流基准点（优先于一切推算）`
      };
    }
    if (loserIds.has(p.id)) {
      return {
        ...p,
        status: 'conflict' as const,
        conflictOfPointId: winner.id,
        note: existing
          ? `目标已存在有效基准点「${winner.label}」，本次确认冲突，不作数`
          : `与${input.actor}同时提交同一目标，按最早目击时刻仲裁，仅保留基准点「${winner.label}」`
      };
    }
    return p;
  });

  if (!existing) {
    events.push({
      actor: '基准点仲裁',
      message: `目标「${targetKey}」只保留一份有效基准点：「${winner.label}」（${winner.reportedBy ?? '目击'} ${new Date(winner.observedAt).toLocaleTimeString('zh-CN')}）已核实，未核实推算不再作为依据`
    });
  }

  for (const loser of batch.filter((p) => p.id !== winner.id)) {
    events.push({
      actor: '基准点仲裁',
      message: `${input.actor}对「${loser.label}」的确认与已保留基准点冲突，提交作废，仅可在冲突记录中查看`
    });
  }
  if (existing && batch.length > 0) {
    events.push({
      actor: '基准点仲裁',
      message: `${input.actor}提交的 ${batch.length} 份确认命中已核实目标「${winner.label}」，基准点不重复建立`
    });
  }

  const stateAfterPoints: CoreState = { ...prev, points };
  const conflictPointIds = [...loserIds];

  // 已有锚点：不再重划区，后来的确认只产生冲突记录
  if (existing) {
    return {
      ...stateAfterPoints,
      events,
      acceptedId: null,
      conflictPointIds,
      existingWinnerId: existing.id,
      newAreaId: null,
      areaMap: {}
    };
  }

  // 新锚点：当前预报下的漂流推算
  const projection = buildProjection(winner, forecast, atIso, uid());
  points = [...points, projection];

  // 旧图上锚定该待核实点的区域一律重划；没有旧区则新开搜索区
  const anchoredAreas = prev.areas.filter(
    (a) => isAreaLive(a.status) && a.anchorPointId === winner.id
  );
  const areaMap: Record<string, string> = {};
  const successorAreas = anchoredAreas.map((old) => {
    const successor = buildArea(old.name, winner, forecast, atIso, uid(), old.status);
    areaMap[old.id] = successor.id;
    return successor;
  });
  const supersededIds = new Set(anchoredAreas.map((a) => a.id));

  let areas = prev.areas.map((a) =>
    supersededIds.has(a.id)
      ? {
          ...a,
          status: 'superseded' as const,
          replacedAt: atIso,
          supersededByAreaId: areaMap[a.id]
        }
      : a
  );

  let newAreaId: string | null;
  if (successorAreas.length === 0) {
    const fresh = buildArea(winner.label, winner, forecast, atIso, uid());
    newAreaId = fresh.id;
    areas = [...areas, fresh];
    events.push({
      actor: '基准点仲裁',
      message: `依据新核实基准点按预报v${forecast.version}划出搜索区「${fresh.name}」`
    });
  } else {
    newAreaId = successorAreas[0].id;
    areas = [...areas, ...successorAreas];
    events.push({
      actor: '基准点仲裁',
      message: `旧图搜索区按已核实基准点重划，未核实版本作废`
    });
  }

  const reflow = reflowMissionsAndAssets(
    { ...prev, points, areas },
    areaMap,
    supersededIds,
    forecast.version,
    atIso,
    (hasSuccessor) =>
      hasSuccessor
        ? `基准点经核实后重划搜索区，任务退回待派并改挂新区`
        : `原搜索区因基准点问题失效，任务退回待派`
  );
  if (reflow.returned.length > 0) {
    events.push({
      actor: '调度重算',
      message: `任务 ${namesOf(reflow.returned.map((m) => ({ name: m.title })))} 退回待派，随核实后的新区重新安排`
    });
  }
  if (reflow.freedAssetIds.length > 0) {
    const freed = reflow.freedAssetIds
      .map((id) => prev.assets.find((a) => a.id === id)?.name ?? id)
      .join('、');
    events.push({
      actor: '调度重算',
      message: `单位 ${freed} 的占用随任务退回而释放`
    });
  }

  return {
    points,
    areas,
    missions: reflow.missions,
    assets: reflow.assets,
    events,
    acceptedId: winner.id,
    conflictPointIds,
    existingWinnerId: null,
    newAreaId,
    areaMap
  };
}
