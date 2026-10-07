'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Grid, Group, List, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, ThemeIcon, Timeline, Title, Tooltip } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { useCommandStore } from '@/lib/store';
import type { DriftDatum } from '@/lib/types';
import { SearchMap } from '@/components/SearchMap';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const DATUM_KIND_LABEL: Record<DriftDatum['kind'], string> = { verified: '核实', projected: '推算' };
const DATUM_STATUS_LABEL: Record<DriftDatum['status'], string> = { active: '有效', expired: '已失效', pending: '待核实' };
const DATUM_STATUS_COLOR: Record<DriftDatum['status'], string> = { active: 'teal', expired: 'gray', pending: 'amber' };

export default function CommandPage() {
  const state = useCommandStore();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const [autoRoll, setAutoRoll] = useState(false);
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });
  const brief = useQuery({
    queryKey: ['sea-state', state.forecast.version],
    queryFn: async () => ({ wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }),
    refetchInterval: state.lowBandwidth ? false : 60_000
  });

  useEffect(() => {
    if (!autoRoll) return;
    const timer = setInterval(() => state.rollForecast(), 15_000);
    return () => clearInterval(timer);
  }, [autoRoll, state]);

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const handleConfirm = (datum: DriftDatum) => {
    state.confirmDatum(datum.id, datum.version, state.actor);
  };

  // 两人同时提交同一目标确认：同 tick 内各持旧版本号提交，先到者胜，后者见冲突
  const handleSimulConfirm = (datum: DriftDatum) => {
    const v = datum.version;
    state.confirmDatum(datum.id, v, '指挥员');
    state.confirmDatum(datum.id, v, '值班员');
  };

  const draftCount = state.missions.filter((m) => m.status === 'draft').length;
  const expiredDatumCount = state.data.filter((d) => d.status === 'expired').length;
  const pendingDatumCount = state.data.filter((d) => d.status === 'pending').length;

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div><Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge><Title order={1} className="section-title">海上搜救联合指挥</Title><Text c="dimmed">漂流基准点、搜索区、任务与单位随预报重算协同</Text></div>
          <Group>
            <Select size="xs" value={state.actor} onChange={(v) => v && state.setActor(v)} data={['指挥员', '值班员']} w={110} />
            <Switch label="自动预报" checked={autoRoll} onChange={(e) => setAutoRoll(e.currentTarget.checked)} />
            <Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} />
            <Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} />
          </Group>
        </Group>

        {state.notice && (
          <Alert color={state.notice.kind === 'error' ? 'red' : state.notice.kind === 'success' ? 'teal' : 'blue'} withCloseButton onClose={state.clearNotice}>
            {state.notice.message}
          </Alert>
        )}
        {state.confirmConflict && (
          <Alert color="red" withCloseButton onClose={state.clearNotice} title="确认冲突">
            目标「{state.confirmConflict.targetName}」已由 {state.confirmConflict.by} 核实，本次确认未生效。系统只保留一份有效基准点。
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          {[
            ['当前预报版本', `第 ${state.forecast.version} 期`],
            ['待派任务', draftCount],
            ['失效推算点', expiredDatumCount + pendingDatumCount],
            ['在线单位', state.assets.filter((item) => item.status !== 'offline').length]
          ].map(([label, value]) => <Card key={String(label)} withBorder><Text size="sm" c="dimmed">{label}</Text><Title order={2}>{value}</Title></Card>)}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card withBorder>
              <Group justify="space-between" align="center">
                <Title order={3}>搜救态势</Title>
                <Group gap="xs">
                  <Badge color="blue" variant="light">第 {state.forecast.version} 期预报</Badge>
                  <Text size="sm">风况：{brief.data?.wind ?? '读取中'} · 能见度：{brief.data?.visibility ?? '--'}</Text>
                </Group>
              </Group>
              <SearchMap areas={state.areas} assets={state.assets} data={state.data} />
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%">
              <Group justify="space-between" align="center">
                <Title order={3}>海况预报</Title>
                <Button size="compact-sm" onClick={state.rollForecast}>接收最新预报</Button>
              </Group>
              <Stack mt="md" gap="xs">
                <Group justify="space-between"><Text size="sm" c="dimmed">期号</Text><Text size="sm">{state.forecast.label}</Text></Group>
                <Group justify="space-between"><Text size="sm" c="dimmed">洋流去向</Text><Text size="sm">{state.forecast.currentDirection}°</Text></Group>
                <Group justify="space-between"><Text size="sm" c="dimmed">流速</Text><Text size="sm">{state.forecast.currentSpeed} 节</Text></Group>
                <Group justify="space-between"><Text size="sm" c="dimmed">发布时间</Text><Text size="sm">{formatDistanceToNow(new Date(state.forecast.issuedAt), { addSuffix: true, locale: zhCN })}</Text></Group>
                <Text size="xs" c="dimmed">滚动预报后：未核实推算失效，搜索区按最新洋流重算，旧区任务退回待派并释放单位。</Text>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Card withBorder>
          <Group justify="space-between" align="center">
            <Title order={3}>漂流基准点</Title>
            <Text size="xs" c="dimmed">核实过的发现优先采用；未核实推算随预报更新失效</Text>
          </Group>
          <Table mt="md">
            <thead><tr><th>目标</th><th>类别</th><th>状态</th><th>依据预报</th><th>核实人</th><th style={{ width: 260 }}>操作</th></tr></thead>
            <tbody>
              {state.data.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.targetName}</b><div style={{ fontSize: 11, color: '#94a3b8' }}>{d.targetId} · {d.lat.toFixed(3)}, {d.lng.toFixed(3)}</div></td>
                  <td><Badge color={d.kind === 'verified' ? 'teal' : 'blue'} variant="light">{DATUM_KIND_LABEL[d.kind]}</Badge></td>
                  <td><Badge color={DATUM_STATUS_COLOR[d.status]}>{DATUM_STATUS_LABEL[d.status]}</Badge></td>
                  <td>{d.forecastVersion == null ? <Badge color="amber" variant="light">无版本</Badge> : `第 ${d.forecastVersion} 期`}</td>
                  <td>{d.confirmedBy ?? '—'}</td>
                  <td>
                    <Group gap="xs">
                      <Tooltip label={d.status === 'expired' ? '该推算已随预报失效' : '核实后升级为优先基准点'}>
                        <Button size="compact-xs" disabled={d.kind === 'verified' || d.status === 'expired'} onClick={() => handleConfirm(d)}>核实</Button>
                      </Tooltip>
                      <Tooltip label="模拟两人同时提交同一目标确认">
                        <Button size="compact-xs" variant="light" disabled={d.kind === 'verified' || d.status === 'expired'} onClick={() => handleSimulConfirm(d)}>同时确认</Button>
                      </Tooltip>
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder><Title order={3}>派发新任务</Title><form onSubmit={handleSubmit(submitMission)}><Stack mt="md"><TextInput label="任务名称" {...register('title')} error={errors.title?.message} /><label>搜索区<select {...register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id} disabled={area.stale}>{area.name}{area.stale ? '（旧区）' : ''}</option>)}</select></label><label>调派单位（可多选）<select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>优先级<select {...register('priority')} style={{ width: '100%', padding: 8 }}><option value="urgent">紧急</option><option value="normal">常规</option></select></label><Textarea label="任务说明" {...register('note')} /><Button type="submit">派发任务</Button></Stack></form></Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder>
              <Title order={3}>任务与搜索区</Title>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">搜索区</th><th align="left">状态</th><th align="left">依据预报</th><th align="left">覆盖率</th></tr></thead><tbody>{state.areas.map((area) => <tr key={area.id}><td style={{ padding: '8px 0' }}>{area.name}{area.stale ? <Badge color="red" size="xs" ml={6}>旧区</Badge> : null}{area.pendingVerification ? <Badge color="amber" size="xs" ml={6}>待核实</Badge> : null}</td><td>{area.status}</td><td>{area.forecastVersion == null ? '—' : `第 ${area.forecastVersion} 期`}</td><td style={{ width: '38%' }}><Progress value={area.coverage} /></td></tr>)}</tbody></table>
              <List mt="lg" spacing="sm">{state.missions.map((mission) => <List.Item key={mission.id}><Group justify="space-between"><div><b>{mission.title}</b><Text size="xs" c="dimmed">{mission.areaId} · {mission.assetIds.join(' / ')} · {mission.forecastVersion == null ? '无预报版本' : `第 ${mission.forecastVersion} 期`}{mission.pendingVerification ? ' · 待核实' : ''}</Text></div><Group><Badge color={mission.status === 'draft' ? 'amber' : mission.status === 'closed' ? 'gray' : 'blue'}>{mission.status === 'draft' ? '待派' : mission.status}</Badge>{mission.status === 'draft' ? <Button size="compact-xs" onClick={() => state.redispatchMission(mission.id)}>重新派发</Button> : <Button size="compact-xs" onClick={() => state.setMissionStatus(mission.id, mission.status === 'in_progress' ? 'closed' : 'in_progress')}>{mission.status === 'closed' ? '重开' : '推进'}</Button>}</Group></Group></List.Item>)}</List>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Card withBorder h="100%"><Title order={3}>单位状态</Title><Stack mt="md">{state.assets.map((asset) => {
              const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
              return <Card key={asset.id} withBorder padding="sm"><Group justify="space-between"><b>{asset.name}</b><Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>{asset.status}</Badge></Group><Text size="xs" c={stale ? 'red' : 'dimmed'}>{stale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}</Text><Group mt="xs"><Button size="compact-xs" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>{asset.status === 'offline' ? '恢复在线' : '标记失联'}</Button></Group></Card>;
            })}</Stack></Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Card withBorder h="100%"><Title order={3}>联合事件时间线</Title><Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>{state.events.slice(0, 12).map((event) => <Timeline.Item key={event.id} title={`${event.actor} · ${new Date(event.time).toLocaleTimeString()}`}><Text size="sm">{event.message}</Text></Timeline.Item>)}</Timeline></Card>
          </Grid.Col>
        </Grid>
      </Stack>
    </main>
  );
}
