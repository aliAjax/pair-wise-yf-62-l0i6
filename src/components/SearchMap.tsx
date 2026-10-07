'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type * as MapLibreGl from 'maplibre-gl';
import type { DriftPoint, RescueAsset, SearchArea } from '@/lib/types';

const areaColor: Record<SearchArea['status'], string> = {
  active: '#0e7490',
  planned: '#f59e0b',
  closed: '#6b7280',
  superseded: '#dc2626'
};

const pointColor: Record<DriftPoint['status'], string> = {
  verified: '#15803d',
  pending: '#d97706',
  conflict: '#b91c1c',
  current: '#2563eb',
  invalidated: '#9ca3af'
};

const markerHtml = (color: string, ring: boolean) =>
  `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-sizing:border-box;${ring ? `box-shadow:0 0 0 4px ${color}44;` : ''}"></div>`;

export function SearchMap({
  areas,
  assets,
  points
}: {
  areas: SearchArea[];
  assets: RescueAsset[];
  points: DriftPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const maplibreRef = useRef<typeof MapLibreGl | null>(null);
  const loadedRef = useRef(false);
  const dataRef = useRef({ areas, assets, points });
  dataRef.current = { areas, assets, points };

  const renderData = useCallback((map: MapLibreMap) => {
    const ml = maplibreRef.current;
    if (!ml || !map.getSource) return;
    const { areas: a, assets: s, points: p } = dataRef.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const style = map.getStyle();
    const layerIds = style?.layers.map((l) => l.id) ?? [];
    layerIds
      .filter((id) => id.endsWith('-fill') || id.endsWith('-outline'))
      .forEach((id) => map.getLayer(id) && map.removeLayer(id));
    a.forEach((area) => {
      if (map.getSource(area.id)) map.removeSource(area.id);
    });

    a.forEach((area) => {
      const superseded = area.status === 'superseded';
      map.addSource(area.id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [area.bounds[0], area.bounds[1]],
              [area.bounds[2], area.bounds[1]],
              [area.bounds[2], area.bounds[3]],
              [area.bounds[0], area.bounds[3]],
              [area.bounds[0], area.bounds[1]]
            ]]
          }
        }
      });
      map.addLayer({
        id: `${area.id}-fill`,
        type: 'fill',
        source: area.id,
        paint: { 'fill-color': areaColor[area.status], 'fill-opacity': superseded ? 0.08 : 0.22 }
      });
      map.addLayer({
        id: `${area.id}-outline`,
        type: 'line',
        source: area.id,
        paint: {
          'line-color': areaColor[area.status],
          'line-width': superseded ? 1 : 2,
          'line-dasharray': superseded ? [2, 2] : [1]
        }
      });
    });

    const addMarker = (lng: number, lat: number, color: string, ring: boolean, title: string) => {
      const el = document.createElement('div');
      el.innerHTML = markerHtml(color, ring);
      const node = el.firstElementChild as HTMLElement;
      node.title = title;
      const marker = new ml.Marker({ element: node }).setLngLat([lng, lat]).addTo(map);
      markersRef.current.push(marker);
    };

    p.forEach((point) => {
      addMarker(
        point.lng,
        point.lat,
        pointColor[point.status],
        point.status === 'verified',
        `${point.label}（${point.status}）${point.forecastVersion !== null ? ` · v${point.forecastVersion}` : ''}`
      );
    });
    s.forEach((asset) => {
      addMarker(asset.lng, asset.lat, asset.status === 'offline' ? '#dc2626' : '#0f766e', false, `${asset.name}（${asset.status}）`);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then((ml) => {
      maplibreRef.current = ml;
      if (disposed || !containerRef.current) return;
      const map = new ml.Map({
        container: containerRef.current,
        center: [121.68, 30.82],
        zoom: 8.5,
        style: 'https://demotiles.maplibre.org/style.json'
      });
      mapRef.current = map;
      map.on('load', () => {
        loadedRef.current = true;
        renderData(map);
      });
    });

    return () => {
      disposed = true;
      markersRef.current.forEach((m) => m.remove());
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [renderData]);

  useEffect(() => {
    if (loadedRef.current && mapRef.current) renderData(mapRef.current);
  }, [areas, assets, points, renderData]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />;
}
