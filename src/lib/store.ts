'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaStatus,
  AssetStatus,
  DriftPoint,
  EventLog,
  Forecast,
  Mission,
  MissionStatus,
  RescueAsset,
  SearchArea
} from './types';
import { applyConfirmations, rollForecast } from './forecast';

export const STORAGE_KEY = 'maritime-command-v2';

const uid = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const forecastSeries: Forecast[] = [
  {
    version: 1,
    issuedAt: at(-55 * 60_000),
    label: '08:00 海况预报',
    currentDirDeg: 45,
    currentKnots: 0.8,
    wind: '东北风 6级',
    visibility: '4.2海里',
    tide: '涨潮',
    source: '国家海洋预报台'
  },
  {
    version: 2,
    issuedAt: at(-15 * 60_000),
    label: '12:00 海况预报（滚动）',
    currentDirDeg: 78,
    currentKnots: 1.35,
    wind: '东风 5级',
    visibility: '6.0海里',
    tide: '平潮转退',
    source: '国家海洋预报台 · 浮标校验'
  },
  {
    version: 3,
    issuedAt: at(45 * 60_000),
    label: '16:00 海况预报（滚动）',
    currentDirDeg: 105,
    currentKnots: 1.1,
    wind: '东南风 4级',
    visibility: '7.5海里',
    tide: '退潮',
    source: '国家海洋预报台 · 浮标校验'
  }
];

const seedForecast = forecastSeries[0];

// 一条已核实发现：预报如何滚动，它都是有效的漂流锚点
const seedVerifiedPoint: DriftPoint = {
  id: 'point-wreck-01',
  label: '翻扣渔船（已核实）',
  kind: 'verified',
  status: 'verified',
  lat: 30.62,
  lng: 121.4,
  observedAt: at(-95 * 60_000),
  forecastVersion: null,
  targetKey: 'target-wreck',
  reportedBy: '海巡071',
  verifiedAt: at(-70 * 60_000),
  legacy: false,
  note: '抵近目视核实，船体翻扣，作为漂流基准点'
};

// 两条待核实目击，同一目标：用于演示两人同时提交确认的仲裁
const seedSightingA: DriftPoint = {
  id: 'point-sighting-a',
  label: '橙色救生筏目击 · 观察哨甲',
  kind: 'unverified',
  status: 'pending',
  lat: 30.71,
  lng: 121.62,
  observedAt: at(-22 * 60_000),
  forecastVersion: null,
  targetKey: 'target-raft',
  reportedBy: '岸上观察点',
  note: '待核实目击，未核实前随预报更新不作数'
};
const seedSightingB: DriftPoint = {
  id: 'point-sighting-b',
  label: '橙色救生筏目击 · 无人机乙',
  kind: 'unverified',
  status: 'pending',
  lat: 30.74,
  lng: 121.66,
  observedAt: at(-14 * 60_000),
  forecastVersion: null,
  targetKey: 'target-raft',
  reportedBy: '无人机D-9',
  note: '与观察哨甲疑似同一目标，待仲裁'
};

// 旧图遗留点：无预报版本，升级后必须先核实
const seedLegacyPoint: DriftPoint = {
  id: 'point-legacy-01',
  label: '旧图漂流物标注',
  kind: 'unverified',
  status: 'pending',
  lat: 30.86,
  lng: 121.7,
  observedAt: at(-300 * 60_000),
  forecastVersion: null,
  targetKey: 'target-legacy',
  legacy: true,
  note: '升级前历史数据，无预报版本，标记待核实'
};

const seedPoints: DriftPoint[] = [seedVerifiedPoint, seedSightingA, seedSightingB, seedLegacyPoint];

const seedAreas: SearchArea[] = [
  // 指挥台仍按最早的图划的搜索区：锚定已核实点，但几何是 v1 洋流画的
  { id: 'area-a', name: 'A区 · 最后目击点（v1）', bounds: [121.34, 30.58, 121.6, 30.81], status: 'active', coverage: 68, anchorPointId: 'point-wreck-01', forecastVersion: 1, center: [121.47, 30.695], radiusNm: 7.6, legacy: false, supersededByAreaId: null, replacedAt: null },
  // 旧图区：无锚点、无预报版本，升级后待核实
  { id: 'area-b', name: 'B区 · 北向漂流（旧图）', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 32, anchorPointId: null, forecastVersion: null, center: [121.8, 30.94], radiusNm: 9.2, legacy: true, supersededByAreaId: null, replacedAt: null }
];

const seedAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: at(-35_000) },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: at(-7 * 60_000) },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: at(-18 * 60_000) }
];

const seedMissions: Mission[] = [
  { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: at(-6 * 60_000), forecastVersion: 1 }
];

const seedEvents: EventLog[] = [
  { id: 'event-0', time: at(-70 * 60_000), actor: '海巡071', message: '翻扣渔船目视核实，登记为漂流基准点（跨预报有效）' },
  { id: 'event-1', time: at(-15 * 60_000), actor: '值班员', message: '指挥台仍按最早的图划搜索区，B区为旧图数据：无预报版本，已标待核实' },
  { id: 'event-2', time: at(-6 * 60_000), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' }
];

interface PendingPoints {
  points: DriftPoint[];
  areas: SearchArea[];
  missions: Mission[];
  assets: RescueAsset[];
}

/** 根据仍在执行的任务重算单位占用：无执行任务的 assigned 单位退回待命 */
export function reconcileAssets(prev: PendingPoints): { assets: RescueAsset[]; freed: RescueAsset[] } {
  const occupied = new Set(
    prev.missions
      .filter((m) => m.status === 'dispatched' || m.status === 'in_progress')
      .flatMap((m) => m.assetIds)
  );
  const freed: RescueAsset[] = [];
  const assets = prev.assets.map((asset) => {
    if (asset.status === 'assigned' && !occupied.has(asset.id)) {
      freed.push(asset);
      return { ...asset, status: 'ready' as const };
    }
    return asset;
  });
  return { assets, freed };
}

export interface CommandState {
  version: number;
  forecasts: Forecast[];
  currentForecastVersion: number;
  points: DriftPoint[];
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  offline: boolean;
  lowBandwidth: boolean;
  /** 最近一次冲突回执，供提交人看到冲突 */
  lastConflict: { at: string; winnerLabel: string; loserLabels: string[] } | null;
  rollForecast: (nextVersion?: number) => void;
  confirmPoints: (pointIds: string[], actor: string) => void;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set) => ({
      version: 2,
      forecasts: forecastSeries,
      currentForecastVersion: seedForecast.version,
      points: seedPoints,
      areas: seedAreas,
      assets: seedAssets,
      missions: seedMissions,
      events: seedEvents,
      offline: false,
      lowBandwidth: false,
      lastConflict: null,

      rollForecast: (nextVersion) => set((state) => {
        const idx = state.forecasts.findIndex((f) => f.version === state.currentForecastVersion);
        const next = nextVersion !== undefined
          ? state.forecasts.find((f) => f.version === nextVersion)
          : state.forecasts[idx + 1];
        if (!next || next.version === state.currentForecastVersion) return state;

        const result = rollForecast(
          { points: state.points, areas: state.areas, missions: state.missions, assets: state.assets },
          next,
          iso(),
          uid
        );
        return {
          currentForecastVersion: next.version,
          points: result.points,
          areas: result.areas,
          missions: result.missions,
          assets: result.assets,
          events: [...result.events.map((e) => ({ id: uid(), time: iso(), actor: e.actor, message: e.message })), ...state.events]
        };
      }),

      confirmPoints: (pointIds, actor) => set((state) => {
        const forecast = state.forecasts.find((f) => f.version === state.currentForecastVersion)!;
        const result = applyConfirmations(
          { points: state.points, areas: state.areas, missions: state.missions, assets: state.assets },
          { pointIds, actor },
          forecast,
          iso(),
          uid
        );
        if (!result.acceptedId && result.conflictPointIds.length === 0) return state;

        const losers = result.conflictPointIds
          .map((id) => state.points.find((p) => p.id === id)?.label ?? id);
        const winner = state.points.find((p) => p.id === result.acceptedId)
          ?? state.points.find((p) => p.id === result.existingWinnerId);

        return {
          points: result.points,
          areas: result.areas,
          missions: result.missions,
          assets: result.assets,
          lastConflict: losers.length > 0
            ? { at: iso(), winnerLabel: winner?.label ?? '已存在基准点', loserLabels: losers }
            : state.lastConflict,
          events: [...result.events.map((e) => ({ id: uid(), time: iso(), actor: e.actor, message: e.message })), ...state.events]
        };
      }),

      setAreaStatus: (id, status) => set((state) => {
        const area = state.areas.find((a) => a.id === id);
        if (!area || area.status === 'superseded') return state;
        let missions = state.missions;
        if (status === 'closed') {
          // 关闭搜索区：区内任务退回待派（留在本区等待另行规划），占用释放
          missions = state.missions.map((m) =>
            m.areaId === id && m.status !== 'closed'
              ? { ...m, status: 'pending_dispatch' as const, returnedReason: '搜索区关闭，任务退回待派', updatedAt: iso() }
              : m
          );
        }
        const areas = state.areas.map((a) => (a.id === id ? { ...a, status } : a));
        const { assets, freed } = reconcileAssets({ points: state.points, areas, missions, assets: state.assets });
        const events = [
          { id: uid(), time: iso(), actor: '指挥员', message: `搜索区「${area.name}」状态改为 ${status}` },
          ...(freed.length > 0
            ? [{ id: uid(), time: iso(), actor: '调度重算', message: `单位 ${freed.map((a) => a.name).join('、')} 占用随区内任务退回而释放` }]
            : [])
        ];
        return { areas, missions, assets, events: [...events, ...state.events] };
      }),

      setAssetStatus: (id, status) => set((state) => ({
        assets: state.assets.map((asset) =>
          asset.id === id ? { ...asset, status, lastSeen: iso() } : asset
        ),
        events: [{ id: uid(), time: iso(), actor: '值班员', message: `${state.assets.find((a) => a.id === id)?.name ?? id} 状态改为 ${status}，已生成变更记录` }, ...state.events]
      })),

      setMissionStatus: (id, status) => set((state) => {
        const target = state.missions.find((m) => m.id === id);
        const area = target ? state.areas.find((a) => a.id === target.areaId) : undefined;
        // 重新下令只能落到当前预报下的有效区
        if (
          target &&
          (status === 'dispatched' || status === 'in_progress') &&
          (!area || area.status === 'superseded' || area.status === 'closed' || area.forecastVersion !== state.currentForecastVersion)
        ) {
          return state;
        }
        const missions = state.missions.map((mission) =>
          mission.id === id
            ? {
                ...mission,
                status,
                updatedAt: iso(),
                forecastVersion: state.currentForecastVersion,
                ...(status === 'pending_dispatch' ? { returnedReason: mission.returnedReason ?? '人工退回待派' } : { returnedReason: undefined })
              }
            : mission
        );
        // 先释放，再按新状态整体重算：新下令的任务重新占用待命单位（失联单位除外）
        let assets = state.assets.map((a) =>
          a.status === 'assigned' ? { ...a, status: 'ready' as const } : a
        );
        const occupy = new Set(
          missions
            .filter((m) => m.status === 'dispatched' || m.status === 'in_progress')
            .flatMap((m) => m.assetIds)
        );
        assets = assets.map((asset) =>
          occupy.has(asset.id) && asset.status !== 'offline'
            ? { ...asset, status: 'assigned' as const }
            : asset
        );
        const mission = state.missions.find((m) => m.id === id);
        const events = [
          { id: uid(), time: iso(), actor: '指挥员', message: `任务「${mission?.title ?? id}」状态改为 ${status}` }
        ];
        return { missions, assets, events: [...events, ...state.events] };
      }),

      dispatchMission: (input) => set((state) => {
        const area = state.areas.find((a) => a.id === input.areaId);
        if (!area || area.status === 'superseded' || area.status === 'closed') return state;
        // 只允许向当前预报下的有效区派工
        if (area.forecastVersion !== state.currentForecastVersion) return state;
        const mission: Mission = {
          id: uid(),
          ...input,
          status: 'dispatched',
          updatedAt: iso(),
          forecastVersion: state.currentForecastVersion
        };
        const assets = state.assets.map((asset) =>
          input.assetIds.includes(asset.id) && asset.status === 'ready'
            ? { ...asset, status: 'assigned' as const }
            : asset
        );
        return {
          missions: [mission, ...state.missions],
          assets,
          events: [{ id: uid(), time: iso(), actor: '指挥员', message: `任务「${input.title}」已派发到「${area.name}」（预报v${state.currentForecastVersion}）` }, ...state.events]
        };
      }),

      toggleOffline: () => set((state) => ({ offline: !state.offline })),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      // 旧数据没有预报版本：升级时全部标为待核实，旧区标旧图、任务退回待派
      migrate: (persisted: unknown, version: number) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        const points = (s.points as DriftPoint[] | undefined) ?? [];
        const legacyAreas = ((s.areas as SearchArea[] | undefined) ?? []).map((area) =>
          area.forecastVersion === undefined || area.forecastVersion === null
            ? { ...area, anchorPointId: area.anchorPointId ?? null, forecastVersion: null, legacy: true, supersededByAreaId: null, replacedAt: null }
            : area
        );
        const legacyPoints: DriftPoint[] = legacyAreas
          .filter((a) => a.legacy && a.anchorPointId === null)
          .map((area, i) => ({
            id: `point-legacy-migrated-${i}`,
            label: `${area.name} · 旧图标注（待核实）`,
            kind: 'unverified',
            status: 'pending',
            lat: (area.bounds[1] + area.bounds[3]) / 2,
            lng: (area.bounds[0] + area.bounds[2]) / 2,
            observedAt: new Date().toISOString(),
            forecastVersion: null,
            targetKey: `target-legacy-migrated-${area.id}`,
            legacy: true,
            note: '由旧版数据升级：无预报版本，先标待核实，核实前不参与重算'
          }));
        const missions = ((s.missions as Mission[] | undefined) ?? []).map((m) =>
          (m.status === 'dispatched' || m.status === 'in_progress' || m.status === 'draft')
            ? { ...m, status: 'pending_dispatch' as const, returnedReason: '数据升级：旧版任务无预报版本，退回待派等待核实', forecastVersion: null }
            : m
        );
        const upgradeEvent: EventLog = {
          id: 'event-upgrade',
          time: new Date().toISOString(),
          actor: '系统升级',
          message: `检测到 v${version || 1} 旧数据：无预报版本，旧区/目击已标记待核实，旧任务退回待派，单位占用待重新派工后重算`
        };
        return {
          version: 2,
          forecasts: forecastSeries,
          currentForecastVersion: 1,
          points: [...points, ...legacyPoints],
          areas: legacyAreas,
          assets: (s.assets as RescueAsset[] | undefined) ?? seedAssets,
          missions,
          events: [upgradeEvent, ...((s.events as EventLog[] | undefined) ?? seedEvents)],
          offline: (s.offline as boolean | undefined) ?? false,
          lowBandwidth: (s.lowBandwidth as boolean | undefined) ?? false,
          lastConflict: null
        };
      },
      // 升级时 persisted 优先（走 migrate），首次安装则使用初始状态
      merge: (persisted, current) =>
        persisted === undefined
          ? current
          : ({ ...current, ...(persisted as Record<string, unknown>) } as CommandState)
    }
  )
);
