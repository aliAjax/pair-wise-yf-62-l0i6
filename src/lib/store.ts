'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaStatus,
  AssetStatus,
  DriftDatum,
  EventLog,
  Forecast,
  Mission,
  MissionStatus,
  RescueAsset,
  SearchArea
} from './types';

const now = Date.now();
const uuid = () => crypto.randomUUID();

const initialForecast: Forecast = {
  version: 1,
  label: '第1期 · 初始预报',
  currentDirection: 45,
  currentSpeed: 2.4,
  issuedAt: new Date(now - 30 * 60_000).toISOString()
};

const initialData: DriftDatum[] = [
  {
    id: 'datum-1',
    targetId: 'T-01',
    targetName: '橙色漂浮物',
    lat: 30.75,
    lng: 121.55,
    kind: 'verified',
    status: 'active',
    forecastVersion: 1,
    version: 1,
    confirmedBy: '指挥员',
    confirmedAt: new Date(now - 20 * 60_000).toISOString(),
    createdAt: new Date(now - 25 * 60_000).toISOString()
  },
  {
    id: 'datum-2',
    targetId: 'T-02',
    targetName: '北向漂流推算点',
    lat: 30.92,
    lng: 121.82,
    kind: 'projected',
    status: 'active',
    forecastVersion: 1,
    version: 1,
    createdAt: new Date(now - 10 * 60_000).toISOString()
  }
];

const initialAreas: SearchArea[] = [
  {
    id: 'area-a',
    name: 'A区 · 最后目击点',
    bounds: [121.42, 30.65, 121.68, 30.88],
    status: 'active',
    coverage: 68,
    forecastVersion: 1,
    anchorDatumId: 'datum-1'
  },
  {
    id: 'area-b',
    name: 'B区 · 北向漂流',
    bounds: [121.64, 30.82, 121.96, 31.06],
    status: 'planned',
    coverage: 32,
    forecastVersion: 1,
    anchorDatumId: 'datum-2'
  }
];

const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: new Date(now - 35_000).toISOString() },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'assigned', lat: 30.92, lng: 121.82, lastSeen: new Date(now - 7 * 60_000).toISOString() },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: new Date(now - 18 * 60_000).toISOString() }
];

const initialMissions: Mission[] = [
  {
    id: 'mission-1',
    title: 'A区扇形搜索',
    areaId: 'area-a',
    assetIds: ['ship-01', 'drone-03'],
    status: 'in_progress',
    priority: 'urgent',
    note: '优先核验橙色漂浮物',
    forecastVersion: 1,
    updatedAt: new Date(now - 6 * 60_000).toISOString()
  },
  {
    id: 'mission-2',
    title: 'B区漂流推算核查',
    areaId: 'area-b',
    assetIds: ['heli-02'],
    status: 'dispatched',
    priority: 'normal',
    note: '按推算点布设航线',
    forecastVersion: 1,
    updatedAt: new Date(now - 4 * 60_000).toISOString()
  }
];

const initialEvents: EventLog[] = [
  { id: 'event-1', time: new Date(now - 15 * 60_000).toISOString(), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: new Date(now - 6 * 60_000).toISOString(), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' }
];

/** 单期预报的漂流位移（经纬度），6 小时推算步长 */
function driftVector(forecast: Forecast): { dx: number; dy: number } {
  const rad = (forecast.currentDirection * Math.PI) / 180;
  const nm = forecast.currentSpeed * 6; // 海里
  const dy = nm / 60; // 纬度
  const dx = nm / (60 * Math.cos((30.7 * Math.PI) / 180)); // 经度
  return { dx: dx * Math.sin(rad), dy: dy * Math.cos(rad) };
}

function shiftBounds(bounds: [number, number, number, number], v: { dx: number; dy: number }): [number, number, number, number] {
  return [bounds[0] + v.dx, bounds[1] + v.dy, bounds[2] + v.dx, bounds[3] + v.dy];
}

export interface ConfirmConflict {
  datumId: string;
  targetName: string;
  by: string;
  at: string;
}

export interface Notice {
  kind: 'error' | 'success' | 'info';
  message: string;
}

interface CommandState {
  forecast: Forecast;
  data: DriftDatum[];
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  offline: boolean;
  lowBandwidth: boolean;
  actor: string;
  confirmConflict: ConfirmConflict | null;
  notice: Notice | null;

  rollForecast: () => void;
  confirmDatum: (datumId: string, expectedVersion: number, actorName?: string) => { ok: boolean; conflict?: boolean };
  redispatchMission: (id: string) => void;
  setActor: (name: string) => void;
  clearNotice: () => void;

  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      forecast: initialForecast,
      data: initialData,
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      offline: false,
      lowBandwidth: false,
      actor: '指挥员',
      confirmConflict: null,
      notice: null,

      rollForecast: () => set((state) => {
        const newVersion = state.forecast.version + 1;
        const prev = state.forecast;
        const newForecast: Forecast = {
          version: newVersion,
          label: `第${newVersion}期 · 最新预报`,
          currentDirection: Math.round((prev.currentDirection + 32 + Math.random() * 46) % 360),
          currentSpeed: Math.round((prev.currentSpeed + (Math.random() - 0.5) * 1.8) * 10) / 10,
          issuedAt: new Date().toISOString()
        };
        const drift = driftVector(newForecast);

        // 1) 没核实的推算随预报更新失效；旧数据（无预报版本）一并失效
        const expired: string[] = [];
        const data = state.data.map((d) => {
          if (d.kind === 'projected' && (d.forecastVersion === null || d.forecastVersion < newVersion)) {
            expired.push(d.targetName);
            return { ...d, status: 'expired' as const };
          }
          return d;
        });

        // 2) 按最新洋流重算搜索区：核实锚点跟随漂移，推算锚点失效或无锚点（旧区）成为旧区
        const areas = state.areas.map((area) => {
          if (area.status === 'closed') return area;
          const anchor = area.anchorDatumId ? data.find((d) => d.id === area.anchorDatumId) : undefined;
          const anchorValid = !!anchor && anchor.kind === 'verified' && anchor.status === 'active';
          if (!anchorValid) {
            return { ...area, stale: true, forecastVersion: null, pendingVerification: false };
          }
          return { ...area, bounds: shiftBounds(area.bounds, drift), forecastVersion: newVersion, stale: false, pendingVerification: false };
        });

        // 3) 重算任务归属：旧区任务退回待派，单位占用跟着释放
        const releasedAssetIds = new Set<string>();
        const returnedTitles: string[] = [];
        const missions = state.missions.map((m) => {
          if (m.status === 'closed' || m.status === 'draft') return m;
          const area = areas.find((a) => a.id === m.areaId);
          if (area?.stale) {
            m.assetIds.forEach((id) => releasedAssetIds.add(id));
            returnedTitles.push(m.title);
            return { ...m, status: 'draft' as const, forecastVersion: null };
          }
          return { ...m, forecastVersion: newVersion };
        });
        const assets = state.assets.map((a) =>
          releasedAssetIds.has(a.id) && a.status === 'assigned' ? { ...a, status: 'ready' as const } : a
        );

        const events: EventLog[] = [
          { id: uuid(), time: new Date().toISOString(), actor: '预报台', message: `第${newVersion}期海况预报已接收，洋流 ${newForecast.currentDirection}° / ${newForecast.currentSpeed} 节` },
          ...state.events
        ];
        if (expired.length) {
          events.unshift({ id: uuid(), time: new Date().toISOString(), actor: '预报台', message: `未核实推算点已随预报失效：${expired.join('、')}` });
        }
        if (returnedTitles.length) {
          events.unshift({ id: uuid(), time: new Date().toISOString(), actor: '调度台', message: `旧区任务退回待派，占用单位已释放：${returnedTitles.join('、')}` });
        }

        return { forecast: newForecast, data, areas, missions, assets, events, confirmConflict: null, notice: null };
      }),

      confirmDatum: (datumId, expectedVersion, actorName) => {
        const actor = actorName ?? get().actor;
        let result: { ok: boolean; conflict?: boolean } = { ok: true };
        set((state) => {
          const datum = state.data.find((d) => d.id === datumId);
          if (!datum) return {};
          const alreadyVerified = datum.kind === 'verified';
          const versionMismatch = datum.version !== expectedVersion;
          if (alreadyVerified || versionMismatch) {
            result = { ok: false, conflict: true };
            const by = datum.confirmedBy ?? '他人';
            return {
              confirmConflict: { datumId, targetName: datum.targetName, by, at: new Date().toISOString() },
              events: [
                { id: uuid(), time: new Date().toISOString(), actor, message: `确认冲突：${datum.targetName} 已由 ${by} 核实，本次确认未生效（乐观锁 v${expectedVersion}≠v${datum.version}）` },
                ...state.events
              ]
            };
          }
          if (datum.status === 'expired') {
            result = { ok: false, conflict: true };
            return {
              confirmConflict: { datumId, targetName: datum.targetName, by: '预报失效', at: new Date().toISOString() },
              events: [
                { id: uuid(), time: new Date().toISOString(), actor, message: `确认驳回：${datum.targetName} 的推算已随第 ${state.forecast.version} 期预报失效` },
                ...state.events
              ]
            };
          }
          const nextVersion = datum.version + 1;
          const data = state.data.map((d) =>
            d.id === datumId
              ? { ...d, kind: 'verified' as const, status: 'active' as const, forecastVersion: state.forecast.version, version: nextVersion, confirmedBy: actor, confirmedAt: new Date().toISOString() }
              : d
          );
          return {
            data,
            confirmConflict: null,
            events: [
              { id: uuid(), time: new Date().toISOString(), actor, message: `已核实 ${datum.targetName}，基准点升级为核实级（v${nextVersion}），后续预报优先采用` },
              ...state.events
            ]
          };
        });
        return result;
      },

      redispatchMission: (id) => set((state) => {
        const mission = state.missions.find((m) => m.id === id);
        if (!mission || mission.status !== 'draft') return {};
        const area = state.areas.find((a) => a.id === mission.areaId);
        if (area?.stale) {
          return {
            notice: { kind: 'error', message: `任务“${mission.title}”所在搜索区已过期，请先调整任务范围再派发` },
            events: [{ id: uuid(), time: new Date().toISOString(), actor: '调度台', message: `重派驳回：${mission.title} 位于旧区，需先调整范围` }, ...state.events]
          };
        }
        const assets = state.assets.map((a) =>
          mission.assetIds.includes(a.id) && a.status !== 'offline' ? { ...a, status: 'assigned' as const } : a
        );
        return {
          missions: state.missions.map((m) =>
            m.id === id ? { ...m, status: 'dispatched' as const, forecastVersion: state.forecast.version, updatedAt: new Date().toISOString() } : m
          ),
          assets,
          notice: { kind: 'success', message: `任务“${mission.title}”已重新派发，单位占用已恢复` },
          events: [{ id: uuid(), time: new Date().toISOString(), actor: '调度台', message: `任务“${mission.title}”重新派发，归属第 ${state.forecast.version} 期预报` }, ...state.events]
        };
      }),

      setActor: (name) => set({ actor: name, confirmConflict: null }),
      clearNotice: () => set({ notice: null, confirmConflict: null }),

      setAreaStatus: (id, status) => set((state) => ({
        areas: state.areas.map((area) => area.id === id ? { ...area, status } : area),
        events: [{ id: uuid(), time: new Date().toISOString(), actor: '指挥员', message: `搜索区 ${id} 状态改为 ${status}` }, ...state.events]
      })),
      setAssetStatus: (id, status) => set((state) => ({
        assets: state.assets.map((asset) => asset.id === id ? { ...asset, status, lastSeen: new Date().toISOString() } : asset),
        events: [{ id: uuid(), time: new Date().toISOString(), actor: '值班员', message: `${id} 状态改为 ${status}，已生成恢复记录` }, ...state.events]
      })),
      setMissionStatus: (id, status) => set((state) => ({
        missions: state.missions.map((mission) => mission.id === id ? { ...mission, status, updatedAt: new Date().toISOString() } : mission),
        events: [{ id: uuid(), time: new Date().toISOString(), actor: '指挥员', message: `任务 ${id} 状态改为 ${status}` }, ...state.events]
      })),
      dispatchMission: (input) => set((state) => {
        const area = state.areas.find((a) => a.id === input.areaId);
        if (area?.stale) {
          return {
            notice: { kind: 'error', message: `搜索区“${area.name}”已过期，请选择有效搜索区` }
          };
        }
        const mission: Mission = {
          id: uuid(),
          ...input,
          status: 'dispatched',
          forecastVersion: state.forecast.version,
          updatedAt: new Date().toISOString()
        };
        return {
          missions: [mission, ...state.missions],
          assets: state.assets.map((asset) => input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' as const } : asset),
          notice: { kind: 'success', message: `任务“${input.title}”已派发，归属第 ${state.forecast.version} 期预报` },
          events: [{ id: uuid(), time: new Date().toISOString(), actor: '指挥员', message: `任务“${input.title}”已派发，归属第 ${state.forecast.version} 期预报` }, ...state.events]
        };
      }),
      toggleOffline: () => set((state) => ({ offline: !state.offline })),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: 'maritime-command-v1',
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<CommandState>;
        // 旧数据没有预报版本，升级时先标待核实
        const forecast = state.forecast ?? {
          version: 1,
          label: '第1期 · 初始预报',
          currentDirection: 45,
          currentSpeed: 2.4,
          issuedAt: new Date().toISOString()
        };
        const legacyAreas = state.areas ?? [];
        const data: DriftDatum[] = state.data ?? legacyAreas.map((a, i) => ({
          id: `datum-legacy-${a.id}`,
          targetId: `T-LEG-${i + 1}`,
          targetName: `${a.name} 旧推算点`,
          lat: (a.bounds[1] + a.bounds[3]) / 2,
          lng: (a.bounds[0] + a.bounds[2]) / 2,
          kind: 'projected',
          status: 'pending',
          forecastVersion: null,
          version: 1,
          createdAt: new Date().toISOString()
        }));
        const areas: SearchArea[] = legacyAreas.map((a) =>
          a.forecastVersion == null
            ? { ...a, forecastVersion: null, pendingVerification: true, stale: false }
            : a
        );
        const missions: Mission[] = (state.missions ?? []).map((m) =>
          m.forecastVersion == null
            ? { ...m, forecastVersion: null, pendingVerification: true }
            : m
        );
        return { ...state, forecast, data, areas, missions };
      }
    }
  )
);
