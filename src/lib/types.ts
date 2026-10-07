export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'in_progress' | 'closed';

/** 海况预报：随滚动更新的洋流场 */
export interface Forecast {
  version: number;          // 预报版本号，单调递增
  label: string;            // 期号文案
  currentDirection: number; // 洋流去向方位角（度，0=北，90=东）
  currentSpeed: number;     // 流速（节）
  issuedAt: string;
}

/** 漂流基准点类别：核实过的发现 / 未核实的推算 */
export type DatumKind = 'verified' | 'projected';
/** 基准点状态：有效 / 随预报失效 / 升级后待核实 */
export type DatumStatus = 'active' | 'expired' | 'pending';

export interface DriftDatum {
  id: string;
  targetId: string;
  targetName: string;
  lat: number;
  lng: number;
  kind: DatumKind;
  status: DatumStatus;
  /** 依据的预报版本；旧数据无版本，升级时置 null 并标待核实 */
  forecastVersion: number | null;
  /** 乐观并发版本：两人同时核准时据此判定冲突 */
  version: number;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
}

export interface SearchArea {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  status: AreaStatus;
  coverage: number;
  /** 最近一次重算所依据的预报版本 */
  forecastVersion: number | null;
  /** 旧数据无预报版本，升级时先标待核实 */
  pendingVerification?: boolean;
  /** 旧区：推算锚点已随预报失效，无法继续跟随漂移 */
  stale?: boolean;
  /** 锚定的漂流基准点 id */
  anchorDatumId?: string;
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
  /** 任务归属所依据的预报版本；旧数据无版本 */
  forecastVersion: number | null;
  pendingVerification?: boolean;
  updatedAt: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}
