export type AreaStatus = 'planned' | 'active' | 'closed' | 'superseded';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
/** pending_dispatch = 旧区失效或尚未下令、等待值班员重新派工 */
export type MissionStatus = 'pending_dispatch' | 'draft' | 'dispatched' | 'in_progress' | 'closed';

/** 预报来源与洋流 */
export interface Forecast {
  version: number;
  issuedAt: string;
  label: string;
  /** 洋流流向（度，0=北，顺时针） */
  currentDirDeg: number;
  /** 洋流流速（节，1节=1海里/小时） */
  currentKnots: number;
  wind: string;
  visibility: string;
  tide: string;
  source: string;
}

/**
 * 漂流基准点 / 发现
 * - verified：人工核实过的发现，跨预报永久有效，是划区与投影的唯一锚点
 * - unverified：待核实目击；旧版数据（无预报版本）也落为该状态
 * - projection：按某期预报从核实锚点推算的位置，预报一滚动即失效
 */
export type DriftPointKind = 'verified' | 'unverified' | 'projection';
export type DriftPointStatus =
  | 'pending'      // 未核实，等待确认
  | 'verified'     // 已核实
  | 'conflict'     // 与同目标的另一确认冲突，未被采纳
  | 'current'      // 推算当前有效（对应当前预报）
  | 'invalidated'; // 推算随预报更新失效

export interface DriftPoint {
  id: string;
  label: string;
  kind: DriftPointKind;
  status: DriftPointStatus;
  lat: number;
  lng: number;
  /** 目击/观测时刻（漂流推算的时间原点） */
  observedAt: string;
  /** 推算点依据的预报版本；核实点/未核实点可为 null */
  forecastVersion: number | null;
  /** 推算点所依据的核实锚点 */
  basedOnPointId?: string;
  /** 同一目标的归并键：两人报同一目标时相同，用于并发确认仲裁 */
  targetKey: string;
  reportedBy?: string;
  verifiedAt?: string;
  /** 冲突时输给了哪一个点 */
  conflictOfPointId?: string | null;
  /** 旧版升级数据：尚无预报版本，必须先核实才能作为锚点 */
  legacy?: boolean;
  note?: string;
}

export interface SearchArea {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  status: AreaStatus;
  coverage: number;
  /** 划区时锚定的核实基准点；旧图数据为 null（待核实） */
  anchorPointId: string | null;
  /** 划区时依据的预报版本 */
  forecastVersion: number | null;
  center?: [number, number];
  radiusNm?: number;
  legacy?: boolean;
  /** 被哪一期新区接替 */
  supersededByAreaId?: string | null;
  replacedAt?: string | null;
}

export interface RescueAsset {
  id: string;
  name: string;
  type: 'ship' | 'helicopter' | 'drone' | 'shore';
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
}

export interface Mission {
  id: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: 'normal' | 'urgent';
  note: string;
  updatedAt: string;
  /** 任务当前所属搜索区对应的预报版本 */
  forecastVersion?: number | null;
  /** 退回待派的原因 */
  returnedReason?: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}
