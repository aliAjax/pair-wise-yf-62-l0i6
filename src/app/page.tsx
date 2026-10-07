'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Grid, Group, List, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Timeline, Title } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { useCommandStore } from '@/lib/store';
import { SearchMap } from '@/components/SearchMap';
import type { DriftPoint, MissionStatus } from '@/lib/types';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const statusLabel: Record<MissionStatus, string> = {
  pending_dispatch: '待派',
  draft: '草拟',
  dispatched: '已派发',
  in_progress: '进行中',
  closed: '已关闭'
};
const statusColor: Record<MissionStatus, string> = {
  pending_dispatch: 'orange',
  draft: 'gray',
  dispatched: 'blue',
  in_progress: 'teal',
  closed: 'gray'
};

const pointBadge: Record<DriftPoint['status'], { label: string; color: string }> = {
  verified: { label: '已核实锚点', color: 'green' },
  pending: { label: '待核实', color: 'orange' },
  conflict: { label: '冲突未采纳', color: 'red' },
  current: { label: '本期推算', color: 'blue' },
  invalidated: { label: '随预报失效', color: 'gray' }
};

const ACTORS = ['值班员甲', '值班员乙'];

export default function CommandPage() {
  const state = useCommandStore();
  const [actor, setActor] = useState(ACTORS[0]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);

  const forecast = state.forecasts.find((f) => f.version === state.currentForecastVersion)!;
  const nextForecast = state.forecasts.find((f) => f.version === state.currentForecastVersion + 1);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: '', priority: 'urgent', note: '' }
  });
  const chosenAreaId = watch('areaId');

  // 海况简报走查询通道（低带宽停轮询）；内容以当前预报版本为准
  const brief = useQuery({
    queryKey: ['sea-state', forecast.version],
    queryFn: async () => ({
      wind: forecast.wind,
      visibility: forecast.visibility,
      tide: forecast.tide,
      issuedAt: forecast.issuedAt
    }),
    refetchInterval: state.lowBandwidth ? false : 60_000,
    initialData: { wind: forecast.wind, visibility: forecast.visibility, tide: forecast.tide, issuedAt: forecast.issuedAt }
  });

  const liveAreas = state.areas.filter((a) => a.status !== 'superseded');
  const dispatchableAreas = liveAreas.filter((a) => a.forecastVersion === state.currentForecastVersion && a.anchorPointId);
  const pendingPoints = state.points.filter((p) => p.kind === 'unverified' && p.status === 'pending');
  const chosenArea = state.areas.find((a) => a.id === chosenAreaId);
  const selectableAssets = state.assets.filter((a) => a.status === 'ready');

  const missionsByArea = useMemo(() => {
    const map = new Map<string, number>();
    state.missions.forEach((m) => {
      if (m.status !== 'closed') map.set(m.areaId, (map.get(m.areaId) ?? 0) + 1);
    });
    return map;
  }, [state.missions]);

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    setSelectedAssets([]);
    reset({ title: '', areaId: '', priority: 'urgent', note: '' });
  };

  const areaName = (id: string) => state.areas.find((a) => a.id === id)?.name ?? id;
  const assetName = (id: string) => state.assets.find((a) => a.id === id)?.name ?? id;
  const pointById = (id?: string | null) => state.points.find((p) => p.id === id);

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div>
            <Group gap="xs">
              <Badge color={state.offline ? 'red' : 'teal'} size="lg">{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge>
              <Badge color="indigo" size="lg" variant="light">{forecast.label} · v{forecast.version}</Badge>
            </Group>
            <Title order={1} className="section-title" mt={6}>海上搜救联合指挥</Title>
            <Text c="dimmed">漂流基准点、搜索区、任务单与执行单位随海况预报滚动重算</Text>
          </div>
          <Group>
            <Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} />
            <Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} />
          </Group>
        </Group>

        <Card withBorder padding="md" className="forecast-bar">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Group gap="xs">
                <Text fw={700}>当前调度依据：{forecast.label}</Text>
                <Badge variant="light">流向 {forecast.currentDirDeg}°</Badge>
                <Badge variant="light">流速 {forecast.currentKnots} 节</Badge>
                <Badge variant="light">{brief.data.wind}</Badge>
                <Badge variant="light">能见度 {brief.data.visibility}</Badge>
                <Badge variant="light">{brief.data.tide}</Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                来源 {forecast.source} · 发布于 {formatDistanceToNow(new Date(forecast.issuedAt), { addSuffix: true, locale: zhCN })}
              </Text>
            </div>
            <Group wrap="nowrap">
              <Select
                size="xs"
                label="以值班员身份操作"
                data={ACTORS}
                value={actor}
                onChange={(v) => v && setActor(v)}
                w={150}
              />
              <Button
                color="indigo"
                disabled={!nextForecast}
                onClick={() => state.rollForecast()}
                title={nextForecast ? `按「${nextForecast.label}」重算` : '已是最新一期预报'}
              >
                {nextForecast ? `接收 ${nextForecast.label} 并重算` : '预报已是最新'}
              </Button>
            </Group>
          </Group>
          <Text size="xs" c="dimmed" mt={8}>
            滚动规则：已核实基准点保留并按新洋流重算漂流；未核实推算点立即失效；旧搜索区重划、旧任务退回待派、单位占用释放。
          </Text>
        </Card>

        {state.lastConflict && (
          <Alert color="red" title="确认冲突：同一目标只保留一份基准点">
            <Text size="sm">
              有效基准点：<b>{state.lastConflict.winnerLabel}</b>；
              你（{actor}）提交的 {state.lastConflict.loserLabels.join('、')} 已判为冲突未采纳。
              （按最早目击时刻仲裁，平手时按提交编号）
            </Text>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, md: 5 }}>
          {[
            ['当前预报搜索区', dispatchableAreas.length],
            ['已核实基准点', state.points.filter((p) => p.status === 'verified').length],
            ['待派任务（旧区退回）', state.missions.filter((m) => m.status === 'pending_dispatch').length],
            ['待命单位', state.assets.filter((item) => item.status === 'ready').length],
            ['过期位置', state.assets.filter((item) => Date.now() - new Date(item.lastSeen).getTime() > 10 * 60_000).length]
          ].map(([label, value]) => (
            <Card key={String(label)} withBorder>
              <Text size="sm" c="dimmed">{label}</Text>
              <Title order={2}>{value}</Title>
            </Card>
          ))}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>搜救态势</Title>
                <Group gap={4}>
                  <Badge color="green">● 已核实锚点</Badge>
                  <Badge color="blue">● 本期推算</Badge>
                  <Badge color="orange">● 待核实</Badge>
                  <Badge color="gray">● 失效推算</Badge>
                  <Badge color="red">● 失效旧区(虚线)</Badge>
                </Group>
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                {brief.data.wind} · 能见度 {brief.data.visibility} · 搜索区按预报v{forecast.version}洋流重划
              </Text>
              <SearchMap areas={state.areas} assets={state.assets} points={state.points} />
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%">
              <Title order={3}>单位状态</Title>
              <Text size="xs" c="dimmed" mt={2}>占用按执行中任务重算：任务退回待派即释放</Text>
              <Stack mt="md">
                {state.assets.map((asset) => {
                  const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
                  return (
                    <Card key={asset.id} withBorder padding="sm">
                      <Group justify="space-between">
                        <b>{asset.name}</b>
                        <Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>
                          {asset.status === 'assigned' ? '执行占用' : asset.status === 'ready' ? '待命' : asset.status}
                        </Badge>
                      </Group>
                      <Text size="xs" c={stale ? 'red' : 'dimmed'}>
                        {stale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}
                      </Text>
                      <Group mt="xs">
                        <Button size="compact-xs" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>
                          {asset.status === 'offline' ? '恢复在线' : '标记失联'}
                        </Button>
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Stack gap="lg">
              <Card withBorder>
                <Title order={3}>漂流基准点与确认仲裁</Title>
                <Text size="xs" c="dimmed" mt={4}>
                  以「{actor}」身份勾选待核实目击后确认；同目标多人同时确认只留最早目击的一份，其余立即看到冲突。
                </Text>
                <List mt="md" spacing="sm" listStyleType="none">
                  {state.points.map((point) => {
                    const badge = pointBadge[point.status];
                    return (
                      <List.Item key={point.id}>
                        <Card withBorder padding="sm">
                          <Group justify="space-between" align="flex-start">
                            <div style={{ flex: 1 }}>
                              <Group gap={6}>
                                <b>{point.label}</b>
                                <Badge color={badge.color} size="sm">{badge.label}</Badge>
                                {point.legacy && <Badge variant="outline" color="orange" size="sm">旧数据待核实</Badge>}
                                {point.forecastVersion !== null && <Badge variant="light" size="sm">v{point.forecastVersion}</Badge>}
                              </Group>
                              <Text size="xs" c="dimmed" mt={2}>{point.note}</Text>
                              <Text size="xs" c="dimmed">
                                {point.kind === 'verified' ? '目击' : '观测'}时刻 {new Date(point.observedAt).toLocaleTimeString('zh-CN')}
                                {point.reportedBy ? ` · ${point.reportedBy}` : ''}
                                {point.status === 'conflict' && point.conflictOfPointId && (
                                  <> · 冲突输于「{pointById(point.conflictOfPointId)?.label ?? point.conflictOfPointId}」</>
                                )}
                              </Text>
                            </div>
                          </Group>
                        </Card>
                      </List.Item>
                    );
                  })}
                </List>
                {pendingPoints.length > 0 && (
                  <Group mt="md">
                    <Button
                      onClick={() => state.confirmPoints(pendingPoints.map((p) => p.id), actor)}
                      title="模拟两人同时提交：所有待核实目击一次性进入仲裁"
                    >
                      以「{actor}」提交全部待核实确认（模拟同时提交）
                    </Button>
                    {pendingPoints.map((p) => (
                      <Button key={p.id} size="compact-sm" variant="light" onClick={() => state.confirmPoints([p.id], actor)}>
                        仅确认：{p.label.split(' · ')[0]}
                      </Button>
                    ))}
                  </Group>
                )}
              </Card>

              <Card withBorder>
                <Title order={3}>派发新任务</Title>
                <Text size="xs" c="dimmed" mt={4}>仅可派往当前预报v{forecast.version}下、锚定已核实基准点的搜索区。</Text>
                <form onSubmit={handleSubmit(submitMission)}>
                  <Stack mt="md">
                    <TextInput label="任务名称" {...register('title')} error={errors.title?.message} />
                    <label>
                      搜索区
                      <select {...register('areaId')} style={{ width: '100%', padding: 8 }}>
                        <option value="">请选择当前预报搜索区</option>
                        {dispatchableAreas.map((area) => (
                          <option key={area.id} value={area.id}>{area.name}</option>
                        ))}
                      </select>
                    </label>
                    {chosenArea && chosenArea.forecastVersion !== state.currentForecastVersion && (
                      <Text size="xs" c="red">该搜索区不属于当前预报，不能派工。</Text>
                    )}
                    <label>
                      调派单位（按住 Ctrl 多选，仅待命单位可派）
                      <select
                        multiple
                        value={selectedAssets}
                        onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (o) => o.value))}
                        style={{ width: '100%', minHeight: 76 }}
                      >
                        {state.assets.map((asset) => (
                          <option key={asset.id} value={asset.id} disabled={asset.status !== 'ready'}>
                            {asset.name}（{asset.status === 'ready' ? '待命' : asset.status === 'offline' ? '失联不可派' : '执行占用中'}）
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedAssets.length === 0 && <Text size="xs" c="orange">请至少选择一个待命单位。</Text>}
                    <label>
                      优先级
                      <select {...register('priority')} style={{ width: '100%', padding: 8 }}>
                        <option value="urgent">紧急</option>
                        <option value="normal">常规</option>
                      </select>
                    </label>
                    <Textarea label="任务说明" {...register('note')} />
                    <Button type="submit" disabled={selectedAssets.length === 0}>派发任务</Button>
                  </Stack>
                </form>
              </Card>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Stack gap="lg">
              <Card withBorder>
                <Title order={3}>搜索区（随预报重划）</Title>
                <Table mt="sm" horizontalSpacing="sm" verticalSpacing="xs">
                  <thead>
                    <tr><th>搜索区</th><th>锚点 / 版本</th><th>状态</th><th>覆盖</th><th>任务</th><th></th></tr>
                  </thead>
                  <tbody>
                    {state.areas.map((area) => {
                      const anchor = pointById(area.anchorPointId);
                      const stale = area.status !== 'superseded' && area.forecastVersion !== state.currentForecastVersion;
                      return (
                        <tr key={area.id} style={{ opacity: area.status === 'superseded' ? 0.55 : 1 }}>
                          <td>
                            {area.name}
                            {stale && <Badge ml={6} color="red" size="sm">旧图·待重划</Badge>}
                            {area.legacy && <Badge ml={6} variant="outline" color="orange" size="sm">旧数据</Badge>}
                          </td>
                          <td>
                            <Text size="xs">{anchor ? anchor.label.split('·')[0] : '无锚点（待核实）'}</Text>
                            <Text size="xs" c="dimmed">{area.forecastVersion !== null ? `预报 v${area.forecastVersion}` : '无预报版本'}{area.radiusNm ? ` · 半径${area.radiusNm}nm` : ''}</Text>
                          </td>
                          <td>
                            <Badge color={area.status === 'active' ? 'teal' : area.status === 'planned' ? 'orange' : area.status === 'superseded' ? 'red' : 'gray'} size="sm">
                              {area.status === 'superseded' ? '已失效重划' : area.status === 'active' ? '执行中' : area.status === 'planned' ? '规划' : '关闭'}
                            </Badge>
                            {area.status === 'superseded' && area.replacedAt && (
                              <Text size="xs" c="dimmed">{formatDistanceToNow(new Date(area.replacedAt), { addSuffix: true, locale: zhCN })}</Text>
                            )}
                          </td>
                          <td style={{ width: 130 }}><Progress value={area.coverage} /></td>
                          <td>{missionsByArea.get(area.id) ?? 0}</td>
                          <td>
                            {area.status === 'active' && <Button size="compact-xs" variant="light" onClick={() => state.setAreaStatus(area.id, 'closed')}>关闭</Button>}
                            {area.status === 'planned' && <Button size="compact-xs" variant="light" onClick={() => state.setAreaStatus(area.id, 'active')}>激活</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>

              <Card withBorder>
                <Title order={3}>任务单（归属随预报重算）</Title>
                <List mt="md" spacing="sm">
                  {state.missions.map((mission) => {
                    const area = state.areas.find((a) => a.id === mission.areaId);
                    const staleArea = !area || area.status === 'superseded' || area.forecastVersion !== state.currentForecastVersion;
                    return (
                      <List.Item key={mission.id}>
                        <Card withBorder padding="sm" w="100%" style={{ borderColor: mission.status === 'pending_dispatch' ? '#fdba74' : undefined }}>
                          <Group justify="space-between">
                            <div>
                              <Group gap={6}>
                                <b>{mission.title}</b>
                                <Badge color={statusColor[mission.status]} size="sm">{statusLabel[mission.status]}</Badge>
                                {mission.priority === 'urgent' && <Badge color="red" size="sm">紧急</Badge>}
                                {mission.forecastVersion !== undefined && mission.forecastVersion !== null && (
                                  <Badge variant={mission.forecastVersion === state.currentForecastVersion ? 'light' : 'outline'} color={mission.forecastVersion === state.currentForecastVersion ? 'indigo' : 'red'} size="sm">v{mission.forecastVersion}</Badge>
                                )}
                              </Group>
                              <Text size="xs" c="dimmed" mt={2}>
                                {areaName(mission.areaId)} · {mission.assetIds.map(assetName).join(' / ') || '未派单位'}
                              </Text>
                              {mission.status === 'pending_dispatch' && mission.returnedReason && (
                                <Text size="xs" c="orange" mt={2}>退回原因：{mission.returnedReason}</Text>
                              )}
                            </div>
                            <Group>
                              {mission.status === 'pending_dispatch' && (
                                <Button size="compact-xs" color="teal" disabled={staleArea} onClick={() => state.setMissionStatus(mission.id, 'in_progress')} title={staleArea ? '搜索区未重划到当前预报，不能下令' : '向当前预报新区重新下令并占用单位'}>
                                  重新下令
                                </Button>
                              )}
                              {mission.status !== 'pending_dispatch' && mission.status !== 'closed' && (
                                <Button size="compact-xs" variant="light" onClick={() => state.setMissionStatus(mission.id, 'pending_dispatch')}>退回待派</Button>
                              )}
                              <Button size="compact-xs" variant={mission.status === 'closed' ? 'light' : 'subtle'} onClick={() => state.setMissionStatus(mission.id, mission.status === 'closed' ? 'pending_dispatch' : 'closed')}>
                                {mission.status === 'closed' ? '重开为待派' : '关闭'}
                              </Button>
                            </Group>
                          </Group>
                        </Card>
                      </List.Item>
                    );
                  })}
                </List>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>

        <Card withBorder>
          <Title order={3}>联合事件时间线（预报滚动 / 仲裁 / 调度留痕）</Title>
          <Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>
            {state.events.slice(0, 14).map((event) => (
              <Timeline.Item key={event.id} title={`${event.actor} · ${new Date(event.time).toLocaleString('zh-CN', { hour12: false })}`}>
                <Text size="sm">{event.message}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      </Stack>
    </main>
  );
}
