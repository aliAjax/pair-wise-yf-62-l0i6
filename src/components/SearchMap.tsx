'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { DriftDatum, RescueAsset, SearchArea } from '@/lib/types';

const AREA_FILL: Record<string, string> = {
  active: '#0e7490',
  planned: '#f59e0b',
  closed: '#64748b'
};

const DATUM_COLOR: Record<string, string> = {
  verified: '#0f766e',
  projected: '#2563eb',
  expired: '#94a3b8',
  pending: '#d97706'
};

export function SearchMap({ areas, assets, data }: { areas: SearchArea[]; assets: RescueAsset[]; data: DriftDatum[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker: MapMarker, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({ container: containerRef.current, center: [121.68, 30.82], zoom: 8.5, style: 'https://demotiles.maplibre.org/style.json' });
      mapRef.current = map;
      map.on('load', () => {
        areas.forEach((area) => {
          map.addSource(area.id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[1]], [area.bounds[2], area.bounds[3]], [area.bounds[0], area.bounds[3]], [area.bounds[0], area.bounds[1]]]] } } });
          map.addLayer({
            id: `${area.id}-fill`,
            type: 'fill',
            source: area.id,
            paint: { 'fill-color': area.stale ? '#dc2626' : AREA_FILL[area.status] ?? '#0e7490', 'fill-opacity': area.stale ? .12 : .22 }
          });
          map.addLayer({
            id: `${area.id}-line`,
            type: 'line',
            source: area.id,
            paint: { 'line-color': area.stale ? '#dc2626' : AREA_FILL[area.status] ?? '#0e7490', 'line-width': area.stale ? 2 : 1.5, 'line-dasharray': area.stale ? [3, 2] : [1] }
          });
          map.fitBounds(new LngLatBounds([area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[3]]), { padding: 60 });
        });
        markersRef.current = [
          ...assets.map((asset) => new MapMarker({ color: asset.status === 'offline' ? '#dc2626' : '#0f766e' }).setLngLat([asset.lng, asset.lat]).addTo(map)),
          ...data.map((d) => new MapMarker({ color: DATUM_COLOR[d.status] ?? '#2563eb', scale: 0.7 }).setLngLat([d.lng, d.lat]).addTo(map))
        ];
      });
    });
    return () => { disposed = true; markersRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); };
  }, [areas, assets, data]);

  return (
    <div>
      <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />
      <div className="map-legend">
        <Legend color="#0f766e" label="核实基准点" />
        <Legend color="#2563eb" label="推算基准点" />
        <Legend color="#d97706" label="待核实" />
        <Legend color="#94a3b8" label="已失效" />
        <Legend color="#dc2626" label="旧区/离线" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#475569' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
