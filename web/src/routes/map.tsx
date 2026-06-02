import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  getRunMap,
  getThermalSources,
  listRuns,
  setThermalSource,
  type ThermalSourceName,
  type ThermalSourcesResponse,
} from "../lib/api";
import {
  buildStudyAreaBoundary,
  buildHeatCorridorActionPlan,
  type HeatCorridorActionPlan,
  buildThermalGradientExpression,
  extractStreetSegments,
  findNearestStreetFeature,
  getObservedTemps,
  getStreetRecommendations,
  percentile,
} from "./map-utils";

type RunsResponse = {
  runs: Array<{ run_id: string; run_name?: string; status?: string }>;
};

type RunMapResponse = {
  run_id: string;
  city: string;
  bbox: [number, number, number, number];
  feature_count: number;
  selected_cells: number;
  eligible_cells: number | null;
  eligibility_source: string | null;
  heat_corridor_method: {
    status: string;
    reason: string;
    metric: string;
    quantile: number;
    threshold: number | null;
    cells: number;
    source?: string;
    provider?: string;
    timestamp?: string;
  };
  thermal_variation: {
    metric: string;
    std: number | null;
    unique_values: number;
    gate_passed: boolean;
  };
  accuracy_note: string;
  available_interventions: string[];
  intervention_costs: Record<string, number>;
  intervention_icon_legend: Record<string, string>;
  selected_intervention_kinds: string[];
  geojson: GeoJSON.FeatureCollection;
};

function mapStyle(projectionMode: "mercator" | "globe"): maplibregl.StyleSpecification {
  return {
    version: 8,
    projection: { type: projectionMode },
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      terrain_dem: {
        type: "raster-dem",
        url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        tileSize: 256,
        maxzoom: 14,
      },
    },
    layers: [
      {
        id: "earth-ocean",
        type: "background",
        paint: {
          "background-color": projectionMode === "globe" ? "rgba(0, 0, 0, 0)" : "#07111f",
          "background-opacity": projectionMode === "globe" ? 0 : 1,
        },
      },
      { id: "osm", type: "raster", source: "osm" },
      {
        id: "terrain-hillshade",
        type: "hillshade",
        source: "terrain_dem",
        layout: { visibility: "none" },
        paint: {
          "hillshade-shadow-color": "#111827",
          "hillshade-highlight-color": "#e5e7eb",
          "hillshade-accent-color": "#6b7280",
        },
      },
    ],
    sky: projectionMode === "globe"
      ? {
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
        }
      : undefined,
    light: projectionMode === "globe"
      ? {
          anchor: "map",
          position: [1.5, 90, 80],
        }
      : undefined,
  } as maplibregl.StyleSpecification;
}

function polygonCentroid(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry as GeoJSON.Polygon | null;
  const ring = geom?.type === "Polygon" ? geom.coordinates?.[0] : null;
  if (!ring?.length) {
    return null;
  }

  let lng = 0;
  let lat = 0;
  for (const coord of ring) {
    lng += Number(coord[0]);
    lat += Number(coord[1]);
  }
  return [lng / ring.length, lat / ring.length];
}

type StreetSelection = {
  streetId: string;
  avgTemp: number;
  isHeatCorridor: boolean;
  nearbyCells: string[];
  recommendations: Array<{ intervention: string; icon: string; reason: string; detail: string }>;
  actionPlan: HeatCorridorActionPlan;
  sourceProperties: Record<string, unknown>;
};

function parseNearbyCells(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x));
  }
  if (typeof raw === "string") {
    const val = raw.trim();
    if (!val) return [];
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x));
      }
    } catch {
      // Fall back to comma-separated handling.
    }
    return val.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function parseBooleanLike(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === "1" || String(raw).toLowerCase() === "true";
}

type HeatCorridorLayer = {
  source: Exclude<ThermalSourceName, "realtime">;
  data?: RunMapResponse;
  visible: boolean;
  label: string;
  color: string;
};

type AnimationState = "running" | "blocked" | "waiting_style" | "stopped";

type AnimationStatus = {
  state: AnimationState;
  reason: string;
};

type AddressFocusRequest = {
  lng: number;
  lat: number;
  label?: string;
  token: number;
};

type AddressCandidate = {
  lat: number;
  lng: number;
  display_name: string;
};

function MapLibreRunMapCanvas({
  data,
  mapKey,
  showHeatCorridors,
  showInterventions,
  showInterventionCircles,
  animateCircles,
  heatFillOpacity,
  isFullscreen,
  streetLevelMode,
  onStreetSelect,
  heatCorridorLayers,
  projectionMode,
  showStudyAreaBoundary,
  addressFocus,
  plannedInterventions,
  requiredConfidence,
  onAnimationStateChange,
}: {
  data?: RunMapResponse;
  mapKey: string;
  showHeatCorridors: boolean;
  showInterventions: boolean;
  showInterventionCircles: boolean;
  animateCircles: boolean;
  heatFillOpacity: number;
  isFullscreen: boolean;
  streetLevelMode: boolean;
  onStreetSelect?: (selection: StreetSelection | null) => void;
  heatCorridorLayers: HeatCorridorLayer[];
  projectionMode: "mercator" | "globe";
  showStudyAreaBoundary: boolean;
  addressFocus?: AddressFocusRequest | null;
  plannedInterventions?: GeoJSON.FeatureCollection;
  requiredConfidence: number;
  onAnimationStateChange?: (status: AnimationStatus) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const plannedInterventionMarkersRef = useRef<maplibregl.Marker[]>([]);
  const plannedInterventionMarkerElementsRef = useRef<HTMLElement[]>([]);
  const heatmapAnimationFrameRef = useRef<number | null>(null);
  const addressPulseFrameRef = useRef<number | null>(null);
  const sourceId = `run-grid-${mapKey}`;
  const fillId = `run-grid-fill-${mapKey}`;
  const ambientLineId = `run-grid-ambient-line-${mapKey}`;
  const selFillId = `run-grid-selected-fill-${mapKey}`;
  const lineId = `run-grid-line-${mapKey}`;
  const selLineId = `run-grid-selected-line-${mapKey}`;
  const streetSourceId = `street-segments-${mapKey}`;
  const streetHitLineId = `street-segments-hit-${mapKey}`;
  const streetLineId = `street-segments-line-${mapKey}`;
  const cityFocusSourceId = `city-focus-source-${mapKey}`;
  const cityFocusHaloLayerId = `city-focus-halo-${mapKey}`;
  const cityFocusCoreLayerId = `city-focus-core-${mapKey}`;
  const addressFocusSourceId = `address-focus-source-${mapKey}`;
  const addressFocusLayerId = `address-focus-layer-${mapKey}`;
  const addressFocusLabelLayerId = `address-focus-label-${mapKey}`;
  const plannedInterventionSourceId = `planned-interventions-source-${mapKey}`;
  const plannedInterventionHaloLayerId = `planned-interventions-halo-${mapKey}`;
  const plannedInterventionGlowLayerId = `planned-interventions-glow-${mapKey}`;
  const plannedInterventionLayerId = `planned-interventions-layer-${mapKey}`;
  const plannedInterventionLabelLayerId = `planned-interventions-label-${mapKey}`;
  const plannedInterventionPulseFrameRef = useRef<number | null>(null);
  const getHeatSourceId = (source: HeatCorridorLayer["source"]) => `heat-corridor-source-${source}-${mapKey}`;
  const getHeatLayerId = (source: HeatCorridorLayer["source"]) => `heat-corridor-layer-${source}-${mapKey}`;
  const getHeatOutlineId = (source: HeatCorridorLayer["source"]) => `heat-corridor-outline-${source}-${mapKey}`;
  const animationStatusRef = useRef<string>("");

  const emitAnimationStatus = (state: AnimationState, reason: string) => {
    const token = `${state}:${reason}`;
    if (animationStatusRef.current === token) {
      return;
    }
    animationStatusRef.current = token;
    onAnimationStateChange?.({ state, reason });
  };

  const emitStreetSelectionFromProps = (props: Record<string, unknown>) => {
    const recommendations = getStreetRecommendations(props, data?.available_interventions || []);
    onStreetSelect?.({
      streetId: String(props.street_id ?? "Street segment"),
      avgTemp: Number(props.avg_temp ?? 0),
      isHeatCorridor: parseBooleanLike(props.is_heat_corridor),
      nearbyCells: parseNearbyCells(props.nearby_cells),
      recommendations,
      actionPlan: buildHeatCorridorActionPlan(
        props,
        data?.geojson,
        data?.heat_corridor_method.threshold,
        data?.available_interventions || [],
        data?.intervention_costs || {},
        requiredConfidence,
      ),
      sourceProperties: props,
    });
  };

  const bringInterventionLayersToFront = (map: maplibregl.Map) => {
    for (const id of [selFillId, selLineId]) {
      if (map.getLayer(id)) {
        map.moveLayer(id);
      }
    }
  };

  const ensureHeatCorridorLayer = (map: maplibregl.Map, layer: HeatCorridorLayer) => {
    if (!layer.data?.geojson) {
      return;
    }

    const sourceIdForLayer = getHeatSourceId(layer.source);
    const fillLayerId = getHeatLayerId(layer.source);
    const outlineLayerId = getHeatOutlineId(layer.source);
    const combinedVisible = showHeatCorridors && layer.visible;

    if (!map.getSource(sourceIdForLayer)) {
      map.addSource(sourceIdForLayer, {
        type: "geojson",
        data: layer.data.geojson,
        generateId: true,
      });
    } else {
      (map.getSource(sourceIdForLayer) as maplibregl.GeoJSONSource).setData(layer.data.geojson as GeoJSON.FeatureCollection);
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceIdForLayer,
        filter: ["==", ["coalesce", ["get", "heat_corridor"], false], true],
        paint: {
          "fill-color": layer.color,
          "fill-opacity": 0.22,
        },
      });
    }

    if (!map.getLayer(outlineLayerId)) {
      map.addLayer({
        id: outlineLayerId,
        type: "line",
        source: sourceIdForLayer,
        filter: ["==", ["coalesce", ["get", "heat_corridor"], false], true],
        paint: {
          "line-color": layer.color,
          "line-width": 2.6,
          "line-opacity": 0.95,
        },
      });
    }

    for (const id of [fillLayerId, outlineLayerId]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", combinedVisible ? "visible" : "none");
      }
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyle(projectionMode),
      center: projectionMode === "globe" ? [-35, 25] : [-71.06, 42.36],
      zoom: projectionMode === "globe" ? 0.85 : 10,
      projection: { type: projectionMode },
      renderWorldCopies: projectionMode !== "globe",
      dragRotate: true,
      pitchWithRotate: true,
      bearing: 0,
      pitch: 0,
    } as maplibregl.MapOptions);

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    popupRef.current = popup;

    mapRef.current = map;

    return () => {
      if (heatmapAnimationFrameRef.current !== null) {
        cancelAnimationFrame(heatmapAnimationFrameRef.current);
        heatmapAnimationFrameRef.current = null;
      }
      if (addressPulseFrameRef.current !== null) {
        cancelAnimationFrame(addressPulseFrameRef.current);
        addressPulseFrameRef.current = null;
      }
      if (plannedInterventionPulseFrameRef.current !== null) {
        cancelAnimationFrame(plannedInterventionPulseFrameRef.current);
        plannedInterventionPulseFrameRef.current = null;
      }
      for (const marker of plannedInterventionMarkersRef.current) {
        marker.remove();
      }
      plannedInterventionMarkersRef.current = [];
      plannedInterventionMarkerElementsRef.current = [];
      popup.remove();
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
    };
  }, [mapKey, projectionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.resize();
  }, [isFullscreen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    for (const id of [streetLineId, streetHitLineId]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", streetLevelMode ? "visible" : "none");
      }
    }

    if (!streetLevelMode) {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    }
  }, [streetLevelMode, streetHitLineId, streetLineId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const applyProjection = () => {
      const setProjection = (map as unknown as { setProjection?: (p: unknown) => void }).setProjection;
      if (typeof setProjection === "function") {
        setProjection.call(map, { type: projectionMode });
      }

      const setTerrain = (map as unknown as { setTerrain?: (t: unknown) => void }).setTerrain;
      if (typeof setTerrain === "function") {
        if (projectionMode === "globe") {
          setTerrain.call(map, { source: "terrain_dem", exaggeration: 1.55 });
        } else {
          setTerrain.call(map, null);
        }
      }

      const hillshadeVisible = projectionMode === "globe" ? "visible" : "none";
      if (map.getLayer("terrain-hillshade")) {
        map.setLayoutProperty("terrain-hillshade", "visibility", hillshadeVisible);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyProjection);
      return;
    }

    applyProjection();

    if (projectionMode === "globe") {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.easeTo({
        center: [-35, 25],
        zoom: Math.min(map.getZoom(), 1.35),
        pitch: 0,
        bearing: 0,
        duration: 450,
      });
    }
  }, [projectionMode]);

  // Sync heat corridor layers when data changes (independent of mount effect)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    // Update or add heat corridor layers based on current heatCorridorLayers prop
    for (const layer of heatCorridorLayers) {
      ensureHeatCorridorLayer(map, layer);
    }

    // Keep selected interventions above heat-corridor overlays.
    bringInterventionLayersToFront(map);
  }, [heatCorridorLayers]);

  // Sync study area boundary layer when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !data?.geojson) {
      return;
    }

    const boundaryId = `study-area-boundary-${mapKey}`;
    const boundarySourceId = `study-area-boundary-source-${mapKey}`;
    const boundary = buildStudyAreaBoundary(data.geojson);

    if (!boundary) {
      return;
    }

    // Create or update source
    if (!map.getSource(boundarySourceId)) {
      map.addSource(boundarySourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: boundary,
            properties: {
              name: `${data.city} Study Area`,
              type: "study_boundary"
            }
          }]
        }
      });

      // Create outline layer if it doesn't exist
      map.addLayer({
        id: `${boundaryId}-outline`,
        type: "line",
        source: boundarySourceId,
        paint: {
          "line-color": "#4a90e2",
          "line-width": 3.5,
          "line-opacity": showStudyAreaBoundary ? 0.95 : 0,
        }
      });
    } else {
      // Update existing source with new boundary
      (map.getSource(boundarySourceId) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: boundary,
          properties: {
            name: `${data.city} Study Area`,
            type: "study_boundary"
          }
        }]
      });

      // Update opacity
      if (map.getLayer(`${boundaryId}-outline`)) {
        map.setPaintProperty(`${boundaryId}-outline`, "line-opacity", showStudyAreaBoundary ? 0.95 : 0);
      }
    }
  }, [data, mapKey, showStudyAreaBoundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const setFog = (fogValue: unknown) => {
      const mapWithFog = map as unknown as { setFog?: (f?: unknown) => void };
      if (typeof mapWithFog.setFog === "function") {
        mapWithFog.setFog(fogValue);
      }
    };

    const applyGlobeStyling = () => {
      if (projectionMode === "globe") {
        setFog({
          color: "rgb(199, 220, 255)",
          "high-color": "rgb(235, 245, 255)",
          "space-color": "rgb(13, 26, 46)",
          "horizon-blend": 0.08,
        });
      } else {
        setFog(undefined);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyGlobeStyling);
    } else {
      applyGlobeStyling();
    }

    return () => {
      // no-op cleanup; we do not auto-rotate or auto-ease map anymore.
    };
  }, [projectionMode]);

  // CRITICAL: Initialize layers when data first arrives and after style load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data?.geojson) {
      return;
    }

    const initializeOrUpdate = () => {
      if (!map.isStyleLoaded()) {
        return;
      }

      // Only proceed if sources don't exist yet (initial setup)
      const sourcesExist = map.getSource(sourceId) && map.getSource(streetSourceId);
      const layersExist = map.getLayer(fillId);

      if (sourcesExist && layersExist) {
        // Sources and layers already initialized, just update data
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(data.geojson);
          if (map.getLayer(fillId)) {
            map.setPaintProperty(fillId, "fill-color", buildThermalGradientExpression(data.geojson) as any);
            map.setPaintProperty(fillId, "fill-opacity", heatFillOpacity);
          }
          bringInterventionLayersToFront(map);
        }
        return;
      }

      // Initialize sources if they don't exist
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "geojson",
          data: data.geojson,
        });
      }

      const streetSegments = extractStreetSegments(data.geojson);
      if (!map.getSource(streetSourceId)) {
        map.addSource(streetSourceId, {
          type: "geojson",
          data: streetSegments,
          generateId: true,
        });
      }

      const [minLon, minLat, maxLon, maxLat] = data.bbox;
      const cityCenter: [number, number] = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
      const cityFocusGeoJson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: cityCenter,
            },
            properties: {
              city: data.city,
            },
          },
        ],
      };

      if (!map.getSource(cityFocusSourceId)) {
        map.addSource(cityFocusSourceId, {
          type: "geojson",
          data: cityFocusGeoJson,
        });
      } else {
        (map.getSource(cityFocusSourceId) as maplibregl.GeoJSONSource).setData(cityFocusGeoJson);
      }


      // Now safely add all layers - sources are guaranteed to exist
      if (!map.getLayer(`${fillId}-heatmap`)) {
        map.addLayer({
          id: `${fillId}-heatmap`,
          type: "heatmap",
          source: sourceId,
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "observed_temp"],
              20,
              0,
              38,
              1,
            ],
            "heatmap-intensity": 0.95,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(44, 90, 160, 0)",
              0.2,
              "#2c5aa0",
              0.4,
              "#5aaeff",
              0.6,
              "#f0f000",
              0.8,
              "#ff9000",
              1,
              "#cc0000",
            ],
            "heatmap-radius": 24,
          },
        });
      }

      if (!map.getLayer(fillId)) {
        map.addLayer({
          id: fillId,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": buildThermalGradientExpression(data.geojson) as any,
            "fill-opacity": heatFillOpacity,
          },
        });
      }

      if (!map.getLayer(ambientLineId)) {
        map.addLayer({
          id: ambientLineId,
          type: "line",
          source: sourceId,
          filter: [
            "all",
            ["==", ["to-number", ["coalesce", ["get", "selected_count"], 0]], 0],
            ["!", ["boolean", ["get", "selected"], false]],
          ],
          paint: {
            "line-color": "#7dd3fc",
            "line-width": 0.9,
            "line-opacity": 0.16,
          },
        });
      }

      if (!map.getLayer(selFillId)) {
        map.addLayer({
          id: selFillId,
          type: "fill",
          source: sourceId,
          filter: [
            "any",
            [">", ["to-number", ["coalesce", ["get", "selected_count"], 0]], 0],
            ["boolean", ["get", "selected"], false],
          ],
          paint: {
            "fill-color": "#22c55e",
            "fill-opacity": 0.1,
            "fill-outline-color": "#14532d",
          },
        });
      }

      if (!map.getLayer(lineId)) {
        map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": "#ffffff",
            "line-width": 0.2,
            "line-opacity": 0.18,
          },
        });
      }

      if (!map.getLayer(streetLineId)) {
        map.addLayer({
          id: streetLineId,
          type: "line",
          source: streetSourceId,
          minzoom: 8,
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              "#00d4ff",
              ["boolean", ["get", "is_heat_corridor"], false],
              "#ff6b6b",
              "#999999",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              4,
              ["boolean", ["get", "is_heat_corridor"], false],
              2.5,
              1.5,
            ],
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              1.0,
              ["boolean", ["get", "is_heat_corridor"], false],
              0.8,
              0.5,
            ],
          },
        });
      }

      if (!map.getLayer(selLineId)) {
        map.addLayer({
          id: selLineId,
          type: "line",
          source: sourceId,
          filter: [
            "any",
            [">", ["to-number", ["coalesce", ["get", "selected_count"], 0]], 0],
            ["boolean", ["get", "selected"], false],
          ],
          paint: {
            "line-color": "#86efac",
            "line-width": 4,
            "line-opacity": 1,
          },
        });
      }

      if (!map.getLayer(streetHitLineId)) {
        map.addLayer({
          id: streetHitLineId,
          type: "line",
          source: streetSourceId,
          minzoom: 8,
          paint: {
            "line-color": "rgba(0,0,0,0)",
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 14, 12],
            "line-opacity": 0.01,
          },
        });
      }

      if (!map.getLayer(cityFocusHaloLayerId)) {
        map.addLayer({
          id: cityFocusHaloLayerId,
          type: "circle",
          source: cityFocusSourceId,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 32, 3, 24, 6, 14],
            "circle-color": "#06b6d4",
            "circle-opacity": 0.32,
            "circle-blur": 0.6,
          },
        });
      }

      if (!map.getLayer(cityFocusCoreLayerId)) {
        map.addLayer({
          id: cityFocusCoreLayerId,
          type: "circle",
          source: cityFocusSourceId,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 8, 4, 6, 8, 4],
            "circle-color": "#22d3ee",
            "circle-stroke-color": "#e0f2fe",
            "circle-stroke-width": 2.2,
            "circle-opacity": 1,
          },
        });
      }


      const cityFocusLabelLayerId = `${cityFocusCoreLayerId}-label`;
      if (!map.getLayer(cityFocusLabelLayerId)) {
        map.addLayer({
          id: cityFocusLabelLayerId,
          type: "symbol",
          source: cityFocusSourceId,
          layout: {
            "text-field": ["coalesce", ["get", "city"], "Boston"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 1, 11, 4, 13, 7, 15],
            "text-font": ["Noto Sans Regular"],
            "text-offset": [0, 1.4],
          },
          paint: {
            "text-color": "#e0f2fe",
            "text-halo-color": "#0f172a",
            "text-halo-width": 1.2,
          },
        });
      }



      const focusVisibility = projectionMode === "globe" ? "visible" : "none";
      for (const id of [
        cityFocusHaloLayerId,
        cityFocusCoreLayerId,
        `${cityFocusCoreLayerId}-label`,
      ]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", focusVisibility);
        }
      }

      bringInterventionLayersToFront(map);

      // Set up event listeners
      map.on("mousemove", fillId, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;

        const p = feature.properties as Record<string, unknown>;
        const cellId = String(p.cell_id ?? "-");
        const selectedCount = Number(p.selected_count ?? 0);
        const selectedKinds = String(p.selected_kinds ?? "").trim();
        const selectedIcon = String(p.selected_icon ?? "").trim();
        const html = `
          <div>
            <strong>Cell ${cellId}</strong><br/>
            Selected: ${selectedCount > 0 ? "Yes" : "No"}<br/>
            Selected Count: ${selectedCount}<br/>
            Icon: ${selectedIcon || "None"}<br/>
            Intervention Kinds: ${selectedKinds || "None"}
          </div>
        `;

        popupRef.current?.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      map.on("mouseleave", fillId, () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      let hoveredStreetId: string | number | null = null;

      map.on("mousemove", streetHitLineId, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || feature.id === undefined || feature.id === null) return;

        if (hoveredStreetId) {
          map.setFeatureState({ source: streetSourceId, id: hoveredStreetId }, { hover: false });
        }
        hoveredStreetId = feature.id as string | number;
        map.setFeatureState({ source: streetSourceId, id: hoveredStreetId }, { hover: true });
      });

      map.on("mouseleave", streetHitLineId, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredStreetId) {
          map.setFeatureState({ source: streetSourceId, id: hoveredStreetId }, { hover: false });
        }
        hoveredStreetId = null;
      });

      const applyStreetSelection = (feature: maplibregl.MapGeoJSONFeature) => {
        const props = feature.properties as Record<string, unknown>;
        if (props.street_id === undefined && feature.id !== undefined) {
          props.street_id = String(feature.id);
        }
        props.street_geometry = feature.geometry;
        emitStreetSelectionFromProps(props);
      };

      map.on("click", streetHitLineId, (e) => {
        const feature = e.features?.[0] as maplibregl.MapGeoJSONFeature | undefined;
        if (!feature) return;
        applyStreetSelection(feature);
      });

      map.on("click", (e) => {
        if (!streetLevelMode) {
          return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: [streetHitLineId] });
        const feature = hits[0] as maplibregl.MapGeoJSONFeature | undefined;
        if (!feature) {
          return;
        }
        applyStreetSelection(feature);
      });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", initializeOrUpdate);
      return;
    }

    initializeOrUpdate();
  }, [data?.geojson, heatFillOpacity, mapKey, projectionMode]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !addressFocus) {
      return;
    }

    const applyFocus = () => {
      if (!map.isStyleLoaded()) {
        return;
      }

      map.easeTo({
        center: [addressFocus.lng, addressFocus.lat],
        zoom: projectionMode === "globe" ? 7.5 : 16.4,
        pitch: 0,
        bearing: 0,
        duration: 1350,
        easing: (t: number) => 1 - Math.pow(1 - t, 3),
      });

      const markerGeoJson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [addressFocus.lng, addressFocus.lat] },
            properties: { label: addressFocus.label ?? "Looked-up address" },
          },
        ],
      };

      if (!map.getSource(addressFocusSourceId)) {
        map.addSource(addressFocusSourceId, {
          type: "geojson",
          data: markerGeoJson,
        });
      } else {
        (map.getSource(addressFocusSourceId) as maplibregl.GeoJSONSource).setData(markerGeoJson);
      }

      if (!map.getLayer(addressFocusLayerId)) {
        map.addLayer({
          id: addressFocusLayerId,
          type: "circle",
          source: addressFocusSourceId,
          paint: {
            "circle-radius": 7,
            "circle-color": "#fde047",
            "circle-stroke-color": "#7c2d12",
            "circle-stroke-width": 2,
            "circle-opacity": 0.95,
          },
        });
      }

      if (!map.getLayer(addressFocusLabelLayerId)) {
        map.addLayer({
          id: addressFocusLabelLayerId,
          type: "symbol",
          source: addressFocusSourceId,
          layout: {
            "text-field": ["concat", "📍 ", ["coalesce", ["get", "label"], "Looked-up address"]],
            "text-size": 12,
            "text-font": ["Noto Sans Regular"],
            "text-offset": [0, 2],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "#0f172a",
            "text-halo-width": 1.5,
            "text-opacity": 1,
          },
        });
      }

      if (addressPulseFrameRef.current !== null) {
        cancelAnimationFrame(addressPulseFrameRef.current);
        addressPulseFrameRef.current = null;
      }

      const animationStart = performance.now();
      const animationDurationMs = 2000;

      const animateAddressPulse = (now: number) => {
        const elapsed = now - animationStart;
        const t = Math.min(1, elapsed / animationDurationMs);
        const decay = 1 - t;
        const wave = (Math.sin(elapsed * 0.02) + 1) / 2;

        if (map.getLayer(addressFocusLayerId)) {
          const radius = 7 + decay * (5 + wave * 8);
          const opacity = 0.95 - (1 - wave) * 0.35 * decay;
          map.setPaintProperty(addressFocusLayerId, "circle-radius", Math.max(7, radius));
          map.setPaintProperty(addressFocusLayerId, "circle-opacity", Math.max(0.75, opacity));
        }

        if (map.getLayer(addressFocusLabelLayerId)) {
          const textOpacity = 0.55 + wave * 0.45;
          map.setPaintProperty(addressFocusLabelLayerId, "text-opacity", textOpacity);
        }

        if (t < 1) {
          addressPulseFrameRef.current = requestAnimationFrame(animateAddressPulse);
          return;
        }

        if (map.getLayer(addressFocusLayerId)) {
          map.setPaintProperty(addressFocusLayerId, "circle-radius", 7);
          map.setPaintProperty(addressFocusLayerId, "circle-opacity", 0.95);
        }
        if (map.getLayer(addressFocusLabelLayerId)) {
          map.setPaintProperty(addressFocusLabelLayerId, "text-opacity", 1);
        }
        addressPulseFrameRef.current = null;
      };

      addressPulseFrameRef.current = requestAnimationFrame(animateAddressPulse);

      if (data?.geojson) {
        const streets = extractStreetSegments(data.geojson);
        const nearest = findNearestStreetFeature(streets, addressFocus.lng, addressFocus.lat, 0.01);
        if (nearest?.properties) {
          emitStreetSelectionFromProps(nearest.properties as Record<string, unknown>);
        } else {
          onStreetSelect?.(null);
        }
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyFocus);
      return;
    }
    applyFocus();
  }, [addressFocus, addressFocusLabelLayerId, addressFocusLayerId, addressFocusSourceId, data?.geojson, projectionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const applyPlannedInterventions = () => {
      const fc = plannedInterventions ?? { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;
      if (!map.getSource(plannedInterventionSourceId)) {
        map.addSource(plannedInterventionSourceId, {
          type: "geojson",
          data: fc,
        });
      } else {
        (map.getSource(plannedInterventionSourceId) as maplibregl.GeoJSONSource).setData(fc);
      }

      if (!map.getLayer(plannedInterventionGlowLayerId)) {
        map.addLayer({
          id: plannedInterventionGlowLayerId,
          type: "circle",
          source: plannedInterventionSourceId,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 16, 34],
            "circle-color": ["coalesce", ["get", "color"], "#16a34a"],
            "circle-blur": 0.75,
            "circle-opacity": 0.42,
          },
        });
      }

      if (!map.getLayer(plannedInterventionHaloLayerId)) {
        map.addLayer({
          id: plannedInterventionHaloLayerId,
          type: "circle",
          source: plannedInterventionSourceId,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 12, 16, 22],
            "circle-color": "#ffffff",
            "circle-stroke-color": ["coalesce", ["get", "color"], "#16a34a"],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 16, 5],
            "circle-opacity": 0.88,
            "circle-stroke-opacity": 0.95,
          },
        });
      }

      if (!map.getLayer(plannedInterventionLayerId)) {
        map.addLayer({
          id: plannedInterventionLayerId,
          type: "circle",
          source: plannedInterventionSourceId,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 16, 13],
            "circle-color": ["coalesce", ["get", "color"], "#16a34a"],
            "circle-stroke-color": "#020617",
            "circle-stroke-width": 1.5,
            "circle-opacity": 1,
          },
        });
      }

      if (!map.getLayer(plannedInterventionLabelLayerId)) {
        map.addLayer({
          id: plannedInterventionLabelLayerId,
          type: "symbol",
          source: plannedInterventionSourceId,
          layout: {
            "text-field": ["get", "icon"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 9, 24, 16, 34],
            "text-offset": [0, 0],
            "text-anchor": "center",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-opacity": 1,
            "text-color": "#111827",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2.5,
          },
        });
      }

      for (const id of [
        plannedInterventionGlowLayerId,
        plannedInterventionHaloLayerId,
        plannedInterventionLayerId,
        plannedInterventionLabelLayerId,
      ]) {
        if (map.getLayer(id)) {
          map.moveLayer(id);
        }
      }

      for (const id of [
        plannedInterventionGlowLayerId,
        plannedInterventionHaloLayerId,
        plannedInterventionLayerId,
        plannedInterventionLabelLayerId,
      ]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", fc.features.length > 0 ? "visible" : "none");
        }
      }

      if (plannedInterventionPulseFrameRef.current !== null) {
        cancelAnimationFrame(plannedInterventionPulseFrameRef.current);
        plannedInterventionPulseFrameRef.current = null;
      }
      if (fc.features.length > 0) {
        const started = performance.now();
        const pulse = (now: number) => {
          const wave = (Math.sin((now - started) / 520) + 1) / 2;
          if (map.getLayer(plannedInterventionGlowLayerId)) {
            map.setPaintProperty(plannedInterventionGlowLayerId, "circle-opacity", 0.28 + wave * 0.28);
            map.setPaintProperty(plannedInterventionGlowLayerId, "circle-radius", [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              16 + wave * 8,
              16,
              30 + wave * 12,
            ]);
          }
          if (map.getLayer(plannedInterventionHaloLayerId)) {
            map.setPaintProperty(plannedInterventionHaloLayerId, "circle-stroke-opacity", 0.72 + wave * 0.28);
            map.setPaintProperty(plannedInterventionHaloLayerId, "circle-radius", [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              11 + wave * 3,
              16,
              20 + wave * 5,
            ]);
          }
          if (map.getLayer(plannedInterventionLabelLayerId)) {
            map.setPaintProperty(plannedInterventionLabelLayerId, "text-opacity", 0.38 + wave * 0.62);
            map.setLayoutProperty(plannedInterventionLabelLayerId, "text-size", [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              22 + wave * 8,
              16,
              32 + wave * 10,
            ]);
          }
          plannedInterventionPulseFrameRef.current = requestAnimationFrame(pulse);
        };
        plannedInterventionPulseFrameRef.current = requestAnimationFrame(pulse);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyPlannedInterventions);
      return;
    }
    applyPlannedInterventions();
  }, [
    plannedInterventionGlowLayerId,
    plannedInterventionHaloLayerId,
    plannedInterventionLabelLayerId,
    plannedInterventionLayerId,
    plannedInterventionSourceId,
    plannedInterventions,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const scalePlannedMarkers = () => {
      const zoom = map.getZoom();
      const scale = Math.max(0.72, Math.min(1.35, 0.72 + (zoom - 9) * 0.07));
      for (const el of plannedInterventionMarkerElementsRef.current) {
        el.style.setProperty("--planned-scale", scale.toFixed(2));
      }
    };

    for (const marker of plannedInterventionMarkersRef.current) {
      marker.remove();
    }
    plannedInterventionMarkersRef.current = [];
    plannedInterventionMarkerElementsRef.current = [];

    const features = plannedInterventions?.features ?? [];
    for (const feature of features) {
      const geometry = feature.geometry as GeoJSON.Point | null;
      if (!geometry || geometry.type !== "Point") {
        continue;
      }
      const [lng, lat] = geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        continue;
      }

      const props = (feature.properties as Record<string, unknown> | null) ?? {};
      const el = document.createElement("div");
      el.className = "planned-intervention-marker";
      el.style.setProperty("--planned-color", String(props.color ?? "#facc15"));
      el.style.setProperty("--planned-scale", "1");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", String(props.label ?? props.kind ?? "planned intervention"));

      const icon = document.createElement("span");
      icon.className = "planned-intervention-marker-icon";
      icon.textContent = String(props.icon ?? "●");
      el.appendChild(icon);

      const badge = document.createElement("span");
      badge.className = "planned-intervention-marker-badge";
      badge.textContent = String(props.index ?? "");
      el.appendChild(badge);

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      plannedInterventionMarkersRef.current.push(marker);
      plannedInterventionMarkerElementsRef.current.push(el);
    }

    scalePlannedMarkers();
    map.on("zoom", scalePlannedMarkers);
    map.on("move", scalePlannedMarkers);

    return () => {
      map.off("zoom", scalePlannedMarkers);
      map.off("move", scalePlannedMarkers);
      for (const marker of plannedInterventionMarkersRef.current) {
        marker.remove();
      }
      plannedInterventionMarkersRef.current = [];
      plannedInterventionMarkerElementsRef.current = [];
    };
  }, [plannedInterventions]);

  // Only zoom when the run ID actually changes (not on refetches)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) {
      return;
    }

    const applyZoom = () => {
      if (projectionMode === "globe") {
        map.easeTo({ center: [-35, 25], zoom: 0.95, pitch: 0, bearing: 0, duration: 700 });
        return;
      }

      const [minLon, minLat, maxLon, maxLat] = data.bbox;
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 44, duration: 380, maxZoom: 11 });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyZoom);
      return;
    }

    applyZoom();
  }, [data?.run_id, projectionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }
    if (map.getLayer(fillId)) {
      map.setPaintProperty(fillId, "fill-opacity", heatFillOpacity);
    }
  }, [fillId, heatFillOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let cancelled = false;

    const stopAnimation = () => {
      if (heatmapAnimationFrameRef.current !== null) {
        cancelAnimationFrame(heatmapAnimationFrameRef.current);
        heatmapAnimationFrameRef.current = null;
      }
    };

    const resetStaticRadii = () => {
      if (map.getLayer(selFillId)) {
        map.setPaintProperty(selFillId, "fill-opacity", 0.1);
      }
      if (map.getLayer(selLineId)) {
        map.setPaintProperty(selLineId, "line-opacity", 1);
        map.setPaintProperty(selLineId, "line-width", 4);
      }
      if (map.getLayer(ambientLineId)) {
        map.setPaintProperty(ambientLineId, "line-opacity", 0.16);
        map.setPaintProperty(ambientLineId, "line-width", 0.9);
      }
    };

    const run = () => {
      if (!map.isStyleLoaded()) {
        emitAnimationStatus("waiting_style", "Waiting for map style to load");
        stopAnimation();

        const waitForStyle = () => {
          if (cancelled) {
            heatmapAnimationFrameRef.current = null;
            return;
          }
          if (!mapRef.current) {
            heatmapAnimationFrameRef.current = null;
            emitAnimationStatus("stopped", "Map instance unavailable");
            return;
          }
          if (map.isStyleLoaded()) {
            run();
            return;
          }
          heatmapAnimationFrameRef.current = requestAnimationFrame(waitForStyle);
        };

        heatmapAnimationFrameRef.current = requestAnimationFrame(waitForStyle);
        return;
      }

      stopAnimation();

      const shouldAnimate =
        Boolean(animateCircles) &&
        Boolean(showInterventions) &&
        Boolean(data?.geojson);

      if (!shouldAnimate) {
        resetStaticRadii();
        if (!animateCircles) {
          emitAnimationStatus("blocked", "Animate Circles toggle is off");
        } else if (!showInterventions) {
          emitAnimationStatus("blocked", "Interventions layer is hidden");
        } else {
          emitAnimationStatus("blocked", "No map data available for animation");
        }
        return;
      }

      const temps = getObservedTemps(data?.geojson);
      const hasThermalVariation = temps.length > 1;

      const ensureSelectedLayers = () => {
        if (!map.getSource(sourceId)) {
          if (!data?.geojson) {
            return;
          }
          map.addSource(sourceId, {
            type: "geojson",
            data: data.geojson,
          });
        } else if (data?.geojson) {
          (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data.geojson as GeoJSON.FeatureCollection);
        }
        if (!map.getLayer(selFillId)) {
          map.addLayer({
            id: selFillId,
            type: "fill",
            source: sourceId,
            filter: [
              "any",
              [">", ["to-number", ["coalesce", ["get", "selected_count"], 0]], 0],
              ["boolean", ["get", "selected"], false],
            ],
            paint: {
              "fill-color": "#22c55e",
              "fill-opacity": 0.1,
              "fill-outline-color": "#14532d",
            },
          });
        }
        if (!map.getLayer(selLineId)) {
          map.addLayer({
            id: selLineId,
            type: "line",
            source: sourceId,
            filter: [
              "any",
              [">", ["to-number", ["coalesce", ["get", "selected_count"], 0]], 0],
              ["boolean", ["get", "selected"], false],
            ],
            paint: {
              "line-color": "#86efac",
              "line-width": 4,
              "line-opacity": 1,
            },
          });
        }
      };

      const animate = () => {
        if (cancelled) {
          heatmapAnimationFrameRef.current = null;
          return;
        }
        if (!mapRef.current) {
          heatmapAnimationFrameRef.current = null;
          emitAnimationStatus("stopped", "Map instance unavailable");
          return;
        }
        if (!map.isStyleLoaded()) {
          emitAnimationStatus("waiting_style", "Map style reloading");
          heatmapAnimationFrameRef.current = requestAnimationFrame(animate);
          return;
        }

        const hasSelectedFillLayer = Boolean(map.getLayer(selFillId));
        const hasSelectedLineLayer = Boolean(map.getLayer(selLineId));
        const hasAmbientLineLayer = Boolean(map.getLayer(ambientLineId));
        if (!hasSelectedFillLayer && !hasSelectedLineLayer && !hasAmbientLineLayer) {
          ensureSelectedLayers();

          const hasSelectedFillLayerAfter = Boolean(map.getLayer(selFillId));
          const hasSelectedLineLayerAfter = Boolean(map.getLayer(selLineId));
          const hasAmbientAfter = Boolean(map.getLayer(ambientLineId));
          if (!hasSelectedFillLayerAfter && !hasSelectedLineLayerAfter && !hasAmbientAfter) {
            if (Number(data?.selected_cells ?? 0) <= 0) {
              emitAnimationStatus("blocked", "No selected intervention cells in this run");
            } else {
              emitAnimationStatus("blocked", "Intervention layers unavailable");
            }
          }
          heatmapAnimationFrameRef.current = requestAnimationFrame(animate);
          return;
        }

        emitAnimationStatus("running", hasThermalVariation ? "Pulse active (thermal data available)" : "Pulse active (fallback)");
        const phase = (Date.now() % 2200) / 2200;
        const wave = (Math.sin(phase * Math.PI * 2) + 1) / 2;
        const fillOpacityPulse = 0.06 + wave * 0.1;
        const lineOpacityPulse = 0.28 + wave * 0.72;
        const lineWidthPulse = 1.8 + wave * 7.4;

        if (hasSelectedFillLayer) {
          map.setPaintProperty(selFillId, "fill-opacity", Math.min(1, fillOpacityPulse));
        }
        if (hasSelectedLineLayer) {
          map.setPaintProperty(selLineId, "line-opacity", Math.min(1, lineOpacityPulse));
          map.setPaintProperty(selLineId, "line-width", lineWidthPulse);
        }
        if (hasAmbientLineLayer) {
          map.setPaintProperty(ambientLineId, "line-opacity", 0.07 + wave * 0.3);
          map.setPaintProperty(ambientLineId, "line-width", 0.45 + wave * 1.55);
        }

        map.triggerRepaint();

        heatmapAnimationFrameRef.current = requestAnimationFrame(animate);
      };

      animate();
    };

    if (!map.isStyleLoaded()) {
      if (animateCircles && showInterventions && showInterventionCircles) {
        emitAnimationStatus("waiting_style", "Waiting for map style to load");
      }
    }

    run();

    return () => {
      cancelled = true;
      stopAnimation();
      emitAnimationStatus("stopped", "Animation loop stopped");
    };
  }, [
    animateCircles,
    data?.geojson,
    onAnimationStateChange,
    ambientLineId,
    selFillId,
    selLineId,
    showInterventionCircles,
    showInterventions,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const selFillId = `run-grid-selected-fill-${mapKey}`;
    const selLineId = `run-grid-selected-line-${mapKey}`;

    const applyVisibility = () => {
      for (const id of [selFillId, selLineId]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", showInterventions ? "visible" : "none");
        }
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyVisibility);
      return;
    }
    applyVisibility();
  }, [mapKey, showInterventionCircles, showHeatCorridors, showInterventions]);

  return <div ref={mapContainerRef} className="map-canvas" />;
}

function RunMapCanvas(props: {
  data?: RunMapResponse;
  mapKey: string;
  showHeatCorridors: boolean;
  showInterventions: boolean;
  showInterventionCircles: boolean;
  animateCircles: boolean;
  heatFillOpacity: number;
  isFullscreen: boolean;
  streetLevelMode: boolean;
  onStreetSelect?: (selection: StreetSelection | null) => void;
  heatCorridorLayers: HeatCorridorLayer[];
  projectionMode: "mercator" | "globe";
  showStudyAreaBoundary: boolean;
  addressFocus?: AddressFocusRequest | null;
  plannedInterventions?: GeoJSON.FeatureCollection;
  requiredConfidence: number;
  onAnimationStateChange?: (status: AnimationStatus) => void;
}) {
  return <MapLibreRunMapCanvas {...props} />;
}

function AnimationStatusBadge({ status, label }: { status: AnimationStatus; label?: string }) {
  const stateLabel = {
    running: "Running",
    blocked: "Blocked",
    waiting_style: "Waiting",
    stopped: "Stopped",
  }[status.state];

  return (
    <span className={`animation-status-badge animation-status-${status.state}`}>
      {label ? `${label}: ` : ""}Animation {stateLabel} - {status.reason}
    </span>
  );
}

function MapLegend({ data, minimized }: { data: RunMapResponse; minimized: boolean }) {
  const temps = useMemo(() => getObservedTemps(data.geojson), [data.geojson]);
  const p05 = temps.length ? percentile(temps, 0.05) : null;
  const p95 = temps.length ? percentile(temps, 0.95) : null;

  if (minimized) {
    return (
      <div className="map-legend map-legend-minimized">
        <div><strong>Legend (Minimized)</strong></div>
        <div><strong>Selected:</strong> {data.selected_cells}</div>
        <div><strong>Heat:</strong> Blue (cool) to Red (hot)</div>
      </div>
    );
  }

  return (
    <div className="map-legend">
      <div><strong>Legend</strong></div>
      <div>📍 <strong>Blue city cells:</strong> Grid areas with temperature data</div>
      <div>🟧 <strong>Landsat heat corridors:</strong> Orange overlay layer</div>
      <div>🟪 <strong>ECOSTRESS heat corridors:</strong> Purple overlay layer</div>
      <div>🟢 <strong>Bright green markers:</strong> Selected intervention cells</div>
      <div><strong>Temperature gradient:</strong> Blue (cool) to Red (hot)</div>
      <div><strong>Selected cells:</strong> {data.selected_cells}</div>
      <div><strong>Selected intervention kinds:</strong> {data.selected_intervention_kinds.join(", ") || "None"}</div>
      {p05 !== null && p95 !== null && (
        <div className="thermal-gradient-bar-container">
          <div className="thermal-gradient-bar"></div>
          <div className="thermal-gradient-labels">
            <span>{p05.toFixed(1)}°C</span>
            <span>{p95.toFixed(1)}°C</span>
          </div>
        </div>
      )}
      <div className="street-legend-section">
        <strong>🛣️ Street Level Interventions</strong>
        <div className="street-legend-subtext">
          <div>🌳 Trees: Shade + cooling</div>
          <div>🏠 Cool roofs: Reduce heat absorption</div>
          <div>🟦 Reflective pavement: Lower street temp</div>
          <div>🌲 Shade corridors: Shaded walkways</div>
        </div>
        <div className="street-legend-note">
          💡 Click any street to see recommendations
        </div>
      </div>
      <div className="map-legend-list">
        <span><strong>Available interventions:</strong> {data.available_interventions.join(", ") || "None"}</span>
        <span><strong>Eligible cells:</strong> {data.eligible_cells ?? "Unknown"}</span>
      </div>
    </div>
  );
}

function ThermalTrustBadge({ data, compact = false }: { data?: RunMapResponse; compact?: boolean }) {
  if (!data) {
    return <span className="thermal-badge thermal-badge-neutral">● Thermal Data: Loading</span>;
  }

  const ready = data.thermal_variation.gate_passed && data.heat_corridor_method.status === "ready";
  const provider = data.heat_corridor_method.provider || "Unknown";
  const timestamp = data.heat_corridor_method.timestamp || "Unknown";
  const source = data.heat_corridor_method.source || "Unknown";
  
  if (ready) {
    return (
      <div className={`thermal-badge-container${compact ? " compact" : ""}`}>
        <span className={`thermal-badge thermal-badge-ready${compact ? " thermal-badge-compact" : ""}`}>
          ● Thermal Data: Operational Real-Data Quality
        </span>
        {!compact && (
          <div className="thermal-badge-metadata">
            <span className="thermal-badge-meta-item"><strong>Source:</strong> {source}</span>
            <span className="thermal-badge-meta-item"><strong>Provider:</strong> {provider}</span>
            <span className="thermal-badge-meta-item"><strong>Timestamp:</strong> {timestamp}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`thermal-badge-container${compact ? " compact" : ""}`}>
      <span className={`thermal-badge thermal-badge-warning${compact ? " thermal-badge-compact" : ""}`}>
        ● Thermal Data: Non-operational ({data.heat_corridor_method.reason})
      </span>
      {!compact && (
        <div className="thermal-badge-metadata">
          <span className="thermal-badge-meta-item"><strong>Source:</strong> {source}</span>
          <span className="thermal-badge-meta-item"><strong>Provider:</strong> {provider}</span>
        </div>
      )}
    </div>
  );
}

function NoSelectionsBanner({ data, label }: { data?: RunMapResponse; label?: string }) {
  if (!data || data.selected_cells > 0) {
    return null;
  }

  const prefix = label ? `${label}: ` : "";
  return (
    <div role="alert" className="no-selections-banner">
      {prefix}This run has 0 selected intervention cells. Choose a different succeeded run to view intervention overlays.
    </div>
  );
}

export function MapPage() {
  const queryClient = useQueryClient();
  const [runIdLeft, setRunIdLeft] = useState("");
  const [runIdRight, setRunIdRight] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [showHeatCorridors, setShowHeatCorridors] = useState(true);
  const [showLandsatHeatCorridors, setShowLandsatHeatCorridors] = useState(true);
  const [showEcostressHeatCorridors, setShowEcostressHeatCorridors] = useState(true);
  const [showInterventions, setShowInterventions] = useState(true);
  const [showInterventionCircles, setShowInterventionCircles] = useState(true);
  const [animateCircles, setAnimateCircles] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [minimizeLegend, setMinimizeLegend] = useState(false);
  const [heatFillOpacity, setHeatFillOpacity] = useState(0.36);
  const [fullscreenMap, setFullscreenMap] = useState<"single" | "left" | "right" | null>(null);
  const [streetLevelMode, setStreetLevelMode] = useState(false);
  const [projectionMode, setProjectionMode] = useState<"mercator" | "globe">("mercator");
  const [showStudyAreaBoundary, setShowStudyAreaBoundary] = useState(true);
  const [requiredConfidence, setRequiredConfidence] = useState(0.72);
  const [selectedSource, setSelectedSource] = useState<ThermalSourceName>("landsat");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [addressLookupResult, setAddressLookupResult] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressCandidate[]>([]);
  const [addressSuggestionsLoading, setAddressSuggestionsLoading] = useState(false);
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [addressFocus, setAddressFocus] = useState<AddressFocusRequest | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [streetSelection, setStreetSelection] = useState<StreetSelection | null>(null);
  const [streetSelectionAt, setStreetSelectionAt] = useState<number | null>(null);
  const [streetSelectionLeft, setStreetSelectionLeft] = useState<StreetSelection | null>(null);
  const [streetSelectionLeftAt, setStreetSelectionLeftAt] = useState<number | null>(null);
  const [streetSelectionRight, setStreetSelectionRight] = useState<StreetSelection | null>(null);
  const [streetSelectionRightAt, setStreetSelectionRightAt] = useState<number | null>(null);
  const addressLookupRef = useRef<HTMLLabelElement | null>(null);
  const singleMapContainerRef = useRef<HTMLDivElement | null>(null);
  const leftMapContainerRef = useRef<HTMLDivElement | null>(null);
  const [animationStatusSingle, setAnimationStatusSingle] = useState<AnimationStatus>({
    state: "stopped",
    reason: "Waiting for map",
  });
  const [animationStatusLeft, setAnimationStatusLeft] = useState<AnimationStatus>({
    state: "stopped",
    reason: "Waiting for map",
  });
  const [animationStatusRight, setAnimationStatusRight] = useState<AnimationStatus>({
    state: "stopped",
    reason: "Waiting for map",
  });

  const runsQuery = useQuery<RunsResponse>({
    queryKey: ["runs", "map-page"],
    queryFn: () => listRuns({ limit: 100, sort_by: ["created_at"], sort_dir: ["desc"] }),
    refetchInterval: 5000,
  });

  const thermalSourcesQuery = useQuery<ThermalSourcesResponse>({
    queryKey: ["thermal-sources"],
    queryFn: () => getThermalSources(),
    refetchInterval: 10000,
  });

  const runOptions = useMemo(
    () => (runsQuery.data?.runs ?? []).filter((r) => (r.status ?? "").toLowerCase() === "succeeded"),
    [runsQuery.data],
  );

  useEffect(() => {
    if (!runIdLeft && runOptions.length > 0) {
      setRunIdLeft(runOptions[0].run_id);
    }
    if (!runIdRight && runOptions.length > 1) {
      setRunIdRight(runOptions[1].run_id);
    }
  }, [runIdLeft, runIdRight, runOptions]);

  useEffect(() => {
    const available = thermalSourcesQuery.data?.available_sources ?? [];
    if (available.length === 0) {
      return;
    }
    if (available.includes("landsat") && selectedSource !== "landsat") {
      setSelectedSource("landsat");
      return;
    }
    if (!available.includes(selectedSource)) {
      setSelectedSource(available[0]);
    }
  }, [selectedSource, thermalSourcesQuery.data?.available_sources]);

  const setSourceMutation = useMutation({
    mutationFn: (source: ThermalSourceName) => setThermalSource(source),
    onSuccess: async (result) => {
      setSelectedSource(result.thermal_source);
      await queryClient.invalidateQueries({ queryKey: ["thermal-sources"] });
      await queryClient.invalidateQueries({ queryKey: ["run-map"] });
      await queryClient.invalidateQueries({ queryKey: ["runs", "map-page"] });
    },
  });

  const leftQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "left", runIdLeft],
    queryFn: () => getRunMap(runIdLeft),
    enabled: Boolean(runIdLeft),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const leftLandsatHeatQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "left", runIdLeft, "landsat-heat"],
    queryFn: () => getRunMap(runIdLeft, "landsat"),
    enabled: Boolean(runIdLeft),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const leftEcostressHeatQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "left", runIdLeft, "ecostress-heat"],
    queryFn: () => getRunMap(runIdLeft, "ecostress"),
    enabled: Boolean(runIdLeft),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const rightQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "right", runIdRight],
    queryFn: () => getRunMap(runIdRight),
    enabled: Boolean(compareMode && runIdRight),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const rightLandsatHeatQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "right", runIdRight, "landsat-heat"],
    queryFn: () => getRunMap(runIdRight, "landsat"),
    enabled: Boolean(compareMode && runIdRight),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const rightEcostressHeatQuery = useQuery<RunMapResponse>({
    queryKey: ["run-map", "right", runIdRight, "ecostress-heat"],
    queryFn: () => getRunMap(runIdRight, "ecostress"),
    enabled: Boolean(compareMode && runIdRight),
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Memoize heatCorridorLayers to prevent unnecessary map recreation
  const heatCorridorLayersLeft = useMemo(
    () => [
      {
        source: "landsat" as const,
        data: leftLandsatHeatQuery.data,
        visible: showLandsatHeatCorridors,
        label: "Landsat",
        color: "#ff7a18",
      },
      {
        source: "ecostress" as const,
        data: leftEcostressHeatQuery.data,
        visible: showEcostressHeatCorridors,
        label: "ECOSTRESS",
        color: "#8b5cf6",
      },
    ],
    [leftLandsatHeatQuery.data, showLandsatHeatCorridors, leftEcostressHeatQuery.data, showEcostressHeatCorridors]
  );

  const heatCorridorLayersRight = useMemo(
    () => [
      {
        source: "landsat" as const,
        data: rightLandsatHeatQuery.data,
        visible: showLandsatHeatCorridors,
        label: "Landsat",
        color: "#ff7a18",
      },
      {
        source: "ecostress" as const,
        data: rightEcostressHeatQuery.data,
        visible: showEcostressHeatCorridors,
        label: "ECOSTRESS",
        color: "#8b5cf6",
      },
    ],
    [rightLandsatHeatQuery.data, showLandsatHeatCorridors, rightEcostressHeatQuery.data, showEcostressHeatCorridors]
  );

  const makeStreetSelection = (
    props: Record<string, unknown>,
    runData: RunMapResponse,
  ): StreetSelection => ({
    streetId: String(props.street_id ?? "Street segment"),
    avgTemp: Number(props.avg_temp ?? 0),
    isHeatCorridor: parseBooleanLike(props.is_heat_corridor),
    nearbyCells: parseNearbyCells(props.nearby_cells),
    recommendations: getStreetRecommendations(props, runData.available_interventions || []),
    actionPlan: buildHeatCorridorActionPlan(
      props,
      runData.geojson,
      runData.heat_corridor_method.threshold,
      runData.available_interventions || [],
      runData.intervention_costs || {},
      requiredConfidence,
    ),
    sourceProperties: props,
  });

  const plannedInterventionLayer = useMemo((): GeoJSON.FeatureCollection => {
    const plan = streetSelection?.actionPlan;
    if (!plan || plan.status !== "ready") {
      return { type: "FeatureCollection", features: [] };
    }
    const colors: Record<string, string> = {
      shade_corridor: "#facc15",
      tree: "#22c55e",
      reflective_pavement: "#38bdf8",
      green_space: "#a3e635",
      water_feature: "#06b6d4",
      cool_roof: "#fb7185",
    };
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    let globalIndex = 1;
    for (const action of plan.actions) {
      action.locations.forEach((loc) => {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
          properties: {
            kind: action.kind,
            icon: action.icon,
            index: globalIndex,
            label: loc.label,
            color: colors[action.kind] ?? "#16a34a",
          },
        });
        globalIndex += 1;
      });
    }
    return { type: "FeatureCollection", features };
  }, [streetSelection?.actionPlan]);

  useEffect(() => {
    if (streetSelection && leftQuery.data) {
      setStreetSelection(makeStreetSelection(streetSelection.sourceProperties, leftQuery.data));
    }
    if (streetSelectionLeft && leftQuery.data) {
      setStreetSelectionLeft(makeStreetSelection(streetSelectionLeft.sourceProperties, leftQuery.data));
    }
    if (streetSelectionRight && rightQuery.data) {
      setStreetSelectionRight(makeStreetSelection(streetSelectionRight.sourceProperties, rightQuery.data));
    }
  }, [requiredConfidence]);

  const applyAddressCandidate = (candidate: AddressCandidate) => {
    setAddressLookupError(null);
    setAddressLookupResult(candidate.display_name);
    setAddressQuery(candidate.display_name);
    setAddressFocus({ lat: candidate.lat, lng: candidate.lng, label: candidate.display_name, token: Date.now() });
    setStreetSelection(null);
    setStreetSelectionLeft(null);
    setStreetSelectionRight(null);
    setStreetSelectionAt(null);
    setStreetSelectionLeftAt(null);
    setStreetSelectionRightAt(null);
    setShowAddressSuggestions(false);
    setAddressSuggestions([]);
    setAddressSuggestionIndex(-1);

    requestAnimationFrame(() => {
      const target = compareMode ? leftMapContainerRef.current : singleMapContainerRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });

    const primary = leftQuery.data;
    if (primary?.geojson) {
      const streets = extractStreetSegments(primary.geojson);
      const nearest = findNearestStreetFeature(streets, candidate.lng, candidate.lat, 0.01);
      if (nearest?.properties) {
        const props = nearest.properties as Record<string, unknown>;
        props.street_geometry = nearest.geometry;
        const selection = makeStreetSelection(props, primary);
        setStreetSelection(selection);
        setStreetSelectionAt(Date.now());
        if (compareMode) {
          setStreetSelectionLeft(selection);
          setStreetSelectionLeftAt(Date.now());
        }
        setStreetLevelMode(true);
        if (!selection.isHeatCorridor && selection.recommendations.length === 0) {
          setAddressLookupError("Address found, but the nearest mapped street is not currently classified as a heat corridor.");
        }
      } else {
        setAddressLookupError("Address found, but no nearby heat-corridor street segment exists in the current run map.");
      }
    }
  };

  const handleAddressLookup = async (queryOverride?: string) => {
    const q = (queryOverride ?? addressQuery).trim();
    if (!q) {
      setAddressLookupError("Enter an address or place to search.");
      return;
    }

    setAddressLookupError(null);
    setAddressLookupLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!resp.ok) {
        throw new Error(`Geocoder returned ${resp.status}`);
      }
      const rows = (await resp.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
      if (!rows.length) {
        throw new Error("No matching address found.");
      }

      const lat = Number(rows[0].lat);
      const lng = Number(rows[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Invalid location returned by geocoder.");
      }

      applyAddressCandidate({
        lat,
        lng,
        display_name: rows[0].display_name ?? q,
      });
    } catch (err) {
      setAddressLookupResult(null);
      setAddressLookupError(err instanceof Error ? err.message : "Address lookup failed.");
    } finally {
      setAddressLookupLoading(false);
    }
  };

  useEffect(() => {
    const q = addressQuery.trim();
    if (q.length < 3) {
      setAddressSuggestions([]);
      setAddressSuggestionIndex(-1);
      setAddressSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAddressSuggestionsLoading(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
        const resp = await fetch(url, {
          headers: {
            Accept: "application/json",
          },
        });
        if (!resp.ok) {
          throw new Error("Suggestion lookup failed");
        }
        const rows = (await resp.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
        if (cancelled) {
          return;
        }

        const candidates = rows
          .map((row) => {
            const lat = Number(row.lat);
            const lng = Number(row.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !row.display_name) {
              return null;
            }
            return { lat, lng, display_name: row.display_name } as AddressCandidate;
          })
          .filter((item): item is AddressCandidate => item !== null);

        setAddressSuggestions(candidates);
        setShowAddressSuggestions(candidates.length > 0);
        setAddressSuggestionIndex(candidates.length > 0 ? 0 : -1);
      } catch {
        if (!cancelled) {
          setAddressSuggestions([]);
          setAddressSuggestionIndex(-1);
        }
      } finally {
        if (!cancelled) {
          setAddressSuggestionsLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addressQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (addressLookupRef.current?.contains(target)) {
        return;
      }
      setShowAddressSuggestions(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const quickLookupPlaces = [
    "Fenway Park Boston",
    "Back Bay Station Boston",
    "Boston City Hall",
    "Logan International Airport",
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const formatSelectionTime = (ts: number | null) => {
    if (!ts) {
      return null;
    }

    const absolute = new Date(ts).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const deltaSeconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
    let relative = `${deltaSeconds}s ago`;
    if (deltaSeconds >= 86400) {
      relative = `${Math.floor(deltaSeconds / 86400)}d ago`;
    } else if (deltaSeconds >= 3600) {
      relative = `${Math.floor(deltaSeconds / 3600)}h ago`;
    } else if (deltaSeconds >= 60) {
      relative = `${Math.floor(deltaSeconds / 60)}m ago`;
    }

    return `${absolute} (${relative})`;
  };

  const handleSingleStreetSelect = (selection: StreetSelection | null) => {
    setStreetSelection(selection);
    setStreetSelectionAt(selection ? Date.now() : null);
  };

  const handleLeftStreetSelect = (selection: StreetSelection | null) => {
    setStreetSelectionLeft(selection);
    setStreetSelectionLeftAt(selection ? Date.now() : null);
  };

  const handleRightStreetSelect = (selection: StreetSelection | null) => {
    setStreetSelectionRight(selection);
    setStreetSelectionRightAt(selection ? Date.now() : null);
  };

  return (
    <div className="map-page">
      <header className="map-page-hero">
        <div className="map-page-kicker">Urban Climate Intelligence</div>
        <h2 className="map-page-title">Boston Heat Intervention Atlas</h2>
        <p className="map-page-subtitle">
          Explore thermal risk, compare runs, and target high-impact interventions with a cinematic Earth and street-level workflow.
        </p>
        <div className="map-hero-metrics">
          <div className="map-hero-metric">
            <span className="map-hero-metric-label">City</span>
            <span className="map-hero-metric-value">{leftQuery.data?.city ?? "Boston"}</span>
          </div>
          <div className="map-hero-metric">
            <span className="map-hero-metric-label">Selected Cells</span>
            <span className="map-hero-metric-value">{leftQuery.data?.selected_cells ?? "-"}</span>
          </div>
          <div className="map-hero-metric">
            <span className="map-hero-metric-label">Total Features</span>
            <span className="map-hero-metric-value">{leftQuery.data?.feature_count ?? "-"}</span>
          </div>
          <div className="map-hero-metric">
            <span className="map-hero-metric-label">Projection</span>
            <span className="map-hero-metric-value">{projectionMode === "globe" ? "Earth" : "Flat"}</span>
          </div>
        </div>
      </header>

      <section className="map-control-shell">
        <div className="street-legend-section">
          <strong>Heat Corridor Layers</strong>
          <div className="street-legend-subtext">
            Toggle the two source-specific overlays independently. Use both to compare where each sensor flags hotspots.
          </div>
        </div>

        <div className="map-controls">
        <label className="address-lookup-card" ref={addressLookupRef}>
          <span className="address-lookup-title">Address Lookup</span>
          <span className="address-lookup-subtitle">Search any Boston address or landmark, then jump straight to nearby interventions.</span>
          <div className="address-lookup-input-row">
            <input
              className="input-full"
              value={addressQuery}
              onChange={(e) => {
                setAddressQuery(e.target.value);
                setShowAddressSuggestions(true);
                if (addressLookupError) {
                  setAddressLookupError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  if (addressSuggestions.length > 0) {
                    e.preventDefault();
                    setShowAddressSuggestions(true);
                    setAddressSuggestionIndex((prev) => (prev + 1) % addressSuggestions.length);
                  }
                  return;
                }
                if (e.key === "ArrowUp") {
                  if (addressSuggestions.length > 0) {
                    e.preventDefault();
                    setShowAddressSuggestions(true);
                    setAddressSuggestionIndex((prev) => (prev <= 0 ? addressSuggestions.length - 1 : prev - 1));
                  }
                  return;
                }
                if (e.key === "Escape") {
                  setShowAddressSuggestions(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (showAddressSuggestions && addressSuggestionIndex >= 0 && addressSuggestionIndex < addressSuggestions.length) {
                    applyAddressCandidate(addressSuggestions[addressSuggestionIndex]);
                    return;
                  }
                  void handleAddressLookup();
                }
              }}
              onFocus={() => {
                if (addressSuggestions.length > 0) {
                  setShowAddressSuggestions(true);
                }
              }}
              placeholder="e.g., Fenway Park Boston"
              aria-label="Search address"
            />
            {addressQuery.trim().length > 0 && (
              <button
                type="button"
                className="address-lookup-clear"
                onClick={() => {
                  setAddressQuery("");
                  setAddressLookupError(null);
                  setAddressLookupResult(null);
                }}
                aria-label="Clear address search"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleAddressLookup()}
              disabled={addressLookupLoading || addressQuery.trim().length === 0}
            >
              {addressLookupLoading ? "Searching..." : "Find"}
            </button>
          </div>

          {showAddressSuggestions && (addressSuggestions.length > 0 || addressSuggestionsLoading) && (
            <div className="address-lookup-suggestions" id="address-suggestions-list" role="listbox" aria-label="Address suggestions">
              {addressSuggestionsLoading && <div className="address-lookup-suggestion-loading">Looking up places...</div>}
              {!addressSuggestionsLoading && addressSuggestions.map((candidate, index) => (
                <button
                  key={`${candidate.display_name}-${index}`}
                  type="button"
                  role="option"
                  className={`address-lookup-suggestion${addressSuggestionIndex === index ? " active" : ""}`}
                  onMouseEnter={() => setAddressSuggestionIndex(index)}
                  onClick={() => applyAddressCandidate(candidate)}
                >
                  {candidate.display_name}
                </button>
              ))}
            </div>
          )}

          <div className="address-lookup-chip-row" role="group" aria-label="Quick address search">
            {quickLookupPlaces.map((place) => (
              <button
                key={place}
                type="button"
                className="address-lookup-chip"
                onClick={() => {
                  setAddressQuery(place);
                  setAddressLookupError(null);
                  setAddressLookupResult(null);
                  void handleAddressLookup(place);
                }}
                disabled={addressLookupLoading}
              >
                {place}
              </button>
            ))}
          </div>

          {addressLookupError && <div className="address-lookup-feedback address-lookup-feedback-error">{addressLookupError}</div>}
          {!addressLookupError && addressLookupResult && (
            <div className="address-lookup-feedback address-lookup-feedback-success">
              Focused on: {addressLookupResult}
            </div>
          )}
          {!addressLookupError && !addressLookupResult && (
            <div className="address-lookup-feedback address-lookup-feedback-hint">
              Tip: Press Enter to search quickly.
            </div>
          )}
        </label>

        <label>
          Primary Run
          <select className="input-full" value={runIdLeft} onChange={(e) => setRunIdLeft(e.target.value)}>
            <option value="">Select a succeeded run</option>
            {runOptions.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {run.run_name ?? run.run_id} ({run.run_id})
              </option>
            ))}
          </select>
        </label>

        <label>
          Thermal Source
          <div className="thermal-source-toggle" role="group" aria-label="Thermal source selector">
            {(["landsat", "ecostress"] as ThermalSourceName[])
              .filter((source) => (thermalSourcesQuery.data?.available_sources ?? ["landsat", "ecostress"]).includes(source))
              .map((source) => {
                const isActive = selectedSource === source;
                return (
                  <button
                    key={source}
                    type="button"
                    className={`thermal-source-btn${isActive ? " active" : ""}`}
                    onClick={() => {
                      if (source !== selectedSource) {
                        void setSourceMutation.mutateAsync(source);
                      }
                    }}
                    disabled={setSourceMutation.isPending}
                  >
                    {source.toUpperCase()}
                  </button>
                );
              })}
          </div>
          <span className="thermal-source-note">
            {setSourceMutation.isPending
              ? "Switching source..."
              : setSourceMutation.error
                ? "Failed to switch source"
                : thermalSourcesQuery.data?.note ?? "Switch applies to newly created runs."}
          </span>
        </label>

        <label>
          Compare Mode
          <div className="map-compare-toggle map-view-toggle">
            <input
              type="checkbox"
              checked={compareMode}
              onChange={(e) => setCompareMode(e.target.checked)}
              aria-label="Enable side-by-side compare mode"
            />
            <span>Enable side-by-side comparison</span>
          </div>
        </label>

        <label>
          Layers
          <div className="map-compare-toggle">
            <label>
              <input
                type="checkbox"
                checked={streetLevelMode}
                onChange={(e) => setStreetLevelMode(e.target.checked)}
                aria-label="Toggle street level intervention mode"
              />
              <span>Street Level Mode</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showHeatCorridors}
                onChange={(e) => setShowHeatCorridors(e.target.checked)}
                aria-label="Toggle heat corridor layer"
              />
              <span>Heat Corridor Overlays</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showLandsatHeatCorridors}
                onChange={(e) => setShowLandsatHeatCorridors(e.target.checked)}
                aria-label="Toggle Landsat heat corridor layer"
              />
              <span>Landsat Heat Corridors</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showEcostressHeatCorridors}
                onChange={(e) => setShowEcostressHeatCorridors(e.target.checked)}
                aria-label="Toggle ECOSTRESS heat corridor layer"
              />
              <span>ECOSTRESS Heat Corridors</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showInterventions}
                onChange={(e) => setShowInterventions(e.target.checked)}
                aria-label="Toggle intervention layer"
              />
              <span>Interventions</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showInterventionCircles}
                onChange={(e) => setShowInterventionCircles(e.target.checked)}
                aria-label="Toggle intervention circles"
              />
              <span>Intervention Circles</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={animateCircles}
                onChange={(e) => setAnimateCircles(e.target.checked)}
                aria-label="Toggle circle animation"
              />
              <span>Animate Circles</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showLegend}
                onChange={(e) => setShowLegend(e.target.checked)}
                aria-label="Toggle legend"
              />
              <span>Show Legend</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={minimizeLegend}
                onChange={(e) => setMinimizeLegend(e.target.checked)}
                aria-label="Minimize legend"
              />
              <span>Minimize Legend</span>
            </label>
            <label>
              <span>Heat Background Opacity</span>
              <input
                type="range"
                min={0.03}
                max={0.25}
                step={0.01}
                value={heatFillOpacity}
                onChange={(e) => setHeatFillOpacity(Number(e.target.value))}
                aria-label="Set heat background opacity"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={showStudyAreaBoundary}
                onChange={(e) => setShowStudyAreaBoundary(e.target.checked)}
                aria-label="Toggle study area boundary"
              />
              <span>📍 Study Area Boundary</span>
            </label>
          </div>
        </label>

        <label>
          Planner Confidence
          <div className="planner-confidence-control">
            <input
              type="range"
              min={50}
              max={95}
              step={5}
              value={Math.round(requiredConfidence * 100)}
              onChange={(e) => setRequiredConfidence(Number(e.target.value) / 100)}
              aria-label="Set required planner confidence"
            />
            <span>{Math.round(requiredConfidence * 100)}% required</span>
          </div>
        </label>

        <label>
          View
          <div className="map-compare-toggle">
            <label>
              <input
                type="radio"
                name="projectionMode"
                checked={projectionMode === "globe"}
                onChange={() => setProjectionMode("globe")}
                aria-label="Show Earth globe view"
              />
              <span>Earth</span>
            </label>
            <label>
              <input
                type="radio"
                name="projectionMode"
                checked={projectionMode === "mercator"}
                onChange={() => setProjectionMode("mercator")}
                aria-label="Show flat map view"
              />
              <span>Flat</span>
            </label>
          </div>
          {projectionMode === "globe" && (
            <div className="street-legend-note">Earth mode: drag map to rotate globe around Boston.</div>
          )}
        </label>

        {compareMode && (
          <label>
            Secondary Run
            <select className="input-full" value={runIdRight} onChange={(e) => setRunIdRight(e.target.value)}>
              <option value="">Select a succeeded run</option>
              {runOptions.map((run) => (
                <option key={run.run_id} value={run.run_id}>
                  {run.run_name ?? run.run_id} ({run.run_id})
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="map-summary">
          {leftQuery.isLoading && <span>Loading primary map data...</span>}
          {leftQuery.data && (
            <span>
              {leftQuery.data.city}: {leftQuery.data.selected_cells} selected / {leftQuery.data.feature_count} total
            </span>
          )}
          <ThermalTrustBadge data={leftQuery.data} />
          {!compareMode && <AnimationStatusBadge status={animationStatusSingle} />}
          {compareMode && <AnimationStatusBadge status={animationStatusLeft} label="Primary" />}
          {compareMode && <AnimationStatusBadge status={animationStatusRight} label="Secondary" />}
          {leftQuery.error && <span>Failed to load primary map data.</span>}
        </div>
      </div>
      </section>

      {!compareMode && (
        <div className="street-map-layout">
          <div
            ref={singleMapContainerRef}
            className={`map-container-with-legend${projectionMode === "globe" ? " map-container-earth" : ""} ${fullscreenMap === "single" ? "map-container-fullscreen" : ""}`}
          >
            <button className="map-fs-btn" onClick={() => setFullscreenMap((prev) => (prev === "single" ? null : "single"))}>
              {fullscreenMap === "single" ? "Exit Fullscreen" : "Fullscreen"}
            </button>
            <div className="map-projection-toggle" role="group" aria-label="Projection mode">
              <button
                type="button"
                className={`map-projection-btn${projectionMode === "globe" ? " active" : ""}`}
                onClick={() => setProjectionMode("globe")}
                aria-label="Switch to Earth view"
              >
                Earth
              </button>
              <button
                type="button"
                className={`map-projection-btn${projectionMode === "mercator" ? " active" : ""}`}
                onClick={() => setProjectionMode("mercator")}
                aria-label="Switch to Flat view"
              >
                Flat
              </button>
            </div>
            <div className="map-panel-animation-status">
              <AnimationStatusBadge status={animationStatusSingle} />
            </div>
            <RunMapCanvas
              data={leftQuery.data}
              mapKey="single"
              showHeatCorridors={showHeatCorridors}
              showInterventions={showInterventions}
              showInterventionCircles={showInterventionCircles}
              animateCircles={animateCircles}
              heatFillOpacity={heatFillOpacity}
              isFullscreen={fullscreenMap === "single"}
              streetLevelMode={streetLevelMode}
              onStreetSelect={handleSingleStreetSelect}
              heatCorridorLayers={heatCorridorLayersLeft}
              projectionMode={projectionMode}
              showStudyAreaBoundary={showStudyAreaBoundary}
              addressFocus={addressFocus}
              plannedInterventions={plannedInterventionLayer}
              requiredConfidence={requiredConfidence}
              onAnimationStateChange={setAnimationStatusSingle}
            />
            {leftQuery.data && (
              <>
                <NoSelectionsBanner data={leftQuery.data} label="Primary run" />
                {showLegend && <MapLegend data={leftQuery.data} minimized={minimizeLegend} />}
              </>
            )}
            {runIdLeft && (
              <p className="map-detail-link-row">
                <Link to="/runs/$runId" params={{ runId: runIdLeft }}>Open Run Detail</Link>
              </p>
            )}
          </div>

          <aside className="street-selection-panel" aria-live="polite">
            <div className="street-selection-panel-title">Street Recommendations</div>
            {streetSelection ? (
              <>
                {streetSelectionAt && (
                  <div className="street-selection-panel-meta">
                    <span>Last selected: {formatSelectionTime(streetSelectionAt)}</span>
                  </div>
                )}
                {addressLookupResult && (
                  <div className="street-selection-panel-address">
                    <span className="street-selection-panel-address-label">Address Focus</span>
                    <span className="street-selection-panel-address-value">{addressLookupResult}</span>
                  </div>
                )}
                <div className="street-selection-panel-street">{streetSelection.streetId}</div>
                <div className="street-selection-panel-meta">
                  <span>{Number.isFinite(streetSelection.avgTemp) ? `${streetSelection.avgTemp.toFixed(2)}°C avg` : "Avg temp unavailable"}</span>
                  <span>{streetSelection.isHeatCorridor ? "Heat Corridor" : "Non-corridor street"}</span>
                  <span>{streetSelection.nearbyCells.length} nearby cells</span>
                </div>

                <div className="street-action-plan">
                  <div className="street-selection-panel-section-title">Flip-to-Cool Action Plan</div>
                  <p className="street-action-plan-summary">{streetSelection.actionPlan.summary}</p>
                  {streetSelection.actionPlan.status === "ready" && (
                    <>
                      <div className="street-action-plan-metrics">
                        <span>
                          Target cooling: {streetSelection.actionPlan.targetCoolingC?.toFixed(2)}°C
                        </span>
                        <span>
                          Estimated cooling: {streetSelection.actionPlan.estimatedCoolingC?.toFixed(2)}°C
                        </span>
                        <span>
                          Range: {streetSelection.actionPlan.coolingRangeC ? `${streetSelection.actionPlan.coolingRangeC[0].toFixed(2)}-${streetSelection.actionPlan.coolingRangeC[1].toFixed(2)}°C` : "Unavailable"}
                        </span>
                        <span>
                          Confidence: {Math.round((streetSelection.actionPlan.probability ?? 0) * 100)}%
                        </span>
                        <span>
                          Est. budget: {streetSelection.actionPlan.estimatedBudget !== null ? `${streetSelection.actionPlan.estimatedBudget.toFixed(2)} units` : "Unavailable"}
                        </span>
                      </div>
                      <div className="street-action-plan-list">
                        {streetSelection.actionPlan.actions.map((action) => (
                          <article key={`${streetSelection.streetId}-${action.kind}-plan`} className="street-action-plan-card">
                            <div className="street-action-plan-card-title">
                              {action.icon} {action.count}x {action.kind}
                            </div>
                            <p>{action.placement}</p>
                            <div>Best placement evidence: {action.suitability}</div>
                            {action.locations.length > 0 && (
                              <div>
                                Candidate locations: {action.locations.map((loc, index) => (
                                  <span key={`${action.kind}-${loc.lng}-${loc.lat}`}>
                                    {index > 0 ? "; " : ""}
                                    {loc.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div>Expected contribution: {action.expectedCoolingC.toFixed(2)}°C</div>
                            <div>Cooling range: {action.coolingRangeC[0].toFixed(2)}-{action.coolingRangeC[1].toFixed(2)}°C</div>
                            <div>
                              Budget: {action.totalCost !== null ? `${action.totalCost.toFixed(2)} units` : "unavailable"}
                              {action.unitCost !== null ? ` (${action.unitCost.toFixed(2)} each)` : ""}
                            </div>
                            <span>{action.rationale}</span>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  {streetSelection.actionPlan.status === "ready" && (
                    <div className="street-action-plan-note">
                      <div>{streetSelection.actionPlan.method}</div>
                      <div>
                        Sources: {streetSelection.actionPlan.evidenceSources.map((source, index) => (
                          <span key={source.url}>
                            {index > 0 ? ", " : ""}
                            <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="street-selection-panel-section-title">Recommended Actions</div>
                {streetSelection.recommendations.length > 0 ? (
                  <div className="street-selection-panel-list">
                    {streetSelection.recommendations.map((rec) => (
                      <article key={`${streetSelection.streetId}-${rec.intervention}`} className="street-selection-card">
                        <div className="street-selection-card-title">
                          {rec.icon} {rec.intervention}
                        </div>
                        <p className="street-selection-card-copy">{rec.reason}</p>
                        <div className="street-selection-card-hint">Why: {rec.detail}</div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="street-selection-panel-empty">No recommended interventions for this street segment.</p>
                )}
              </>
            ) : (
              <p className="street-selection-panel-empty">
                Click a street segment on the map to view full recommendation details for that location.
              </p>
            )}
          </aside>

        </div>
      )}

      {compareMode && (
        <div className="map-compare-grid">
          <div className="map-compare-column">
            <div
              ref={leftMapContainerRef}
              className={`map-container-with-legend${projectionMode === "globe" ? " map-container-earth" : ""} ${fullscreenMap === "left" ? "map-container-fullscreen" : ""}`}
            >
              <h3 className="map-panel-title">Primary</h3>
              <button className="map-fs-btn" onClick={() => setFullscreenMap((prev) => (prev === "left" ? null : "left"))}>
                {fullscreenMap === "left" ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <div className="map-projection-toggle" role="group" aria-label="Projection mode">
                <button
                  type="button"
                  className={`map-projection-btn${projectionMode === "globe" ? " active" : ""}`}
                  onClick={() => setProjectionMode("globe")}
                  aria-label="Switch to Earth view"
                >
                  Earth
                </button>
                <button
                  type="button"
                  className={`map-projection-btn${projectionMode === "mercator" ? " active" : ""}`}
                  onClick={() => setProjectionMode("mercator")}
                  aria-label="Switch to Flat view"
                >
                  Flat
                </button>
              </div>
              <div className="map-panel-animation-status">
                <AnimationStatusBadge status={animationStatusLeft} label="Primary" />
              </div>
              <ThermalTrustBadge data={leftQuery.data} compact />
              <NoSelectionsBanner data={leftQuery.data} label="Primary run" />
              <RunMapCanvas
                data={leftQuery.data}
                mapKey="left"
                showHeatCorridors={showHeatCorridors}
                showInterventions={showInterventions}
                showInterventionCircles={showInterventionCircles}
                animateCircles={animateCircles}
                heatFillOpacity={heatFillOpacity}
                isFullscreen={fullscreenMap === "left"}
                streetLevelMode={streetLevelMode}
                onStreetSelect={handleLeftStreetSelect}
                heatCorridorLayers={heatCorridorLayersLeft}
                projectionMode={projectionMode}
                showStudyAreaBoundary={showStudyAreaBoundary}
                addressFocus={addressFocus}
                plannedInterventions={plannedInterventionLayer}
                requiredConfidence={requiredConfidence}
                onAnimationStateChange={setAnimationStatusLeft}
              />
              {leftQuery.data && showLegend && <MapLegend data={leftQuery.data} minimized={minimizeLegend} />}
              {runIdLeft && (
                <p className="map-detail-link-row">
                  <Link to="/runs/$runId" params={{ runId: runIdLeft }}>Open Primary Run Detail</Link>
                </p>
              )}
            </div>
            <aside className="street-selection-panel street-selection-panel-compare" aria-live="polite">
              <div className="street-selection-panel-title">Primary Street Recommendations</div>
              {streetSelectionLeft ? (
                <>
                  {streetSelectionLeftAt && (
                    <div className="street-selection-panel-meta">
                      <span>Last selected: {formatSelectionTime(streetSelectionLeftAt)}</span>
                    </div>
                  )}
                  <div className="street-selection-panel-street">{streetSelectionLeft.streetId}</div>
                  <div className="street-selection-panel-meta">
                    <span>{Number.isFinite(streetSelectionLeft.avgTemp) ? `${streetSelectionLeft.avgTemp.toFixed(2)}°C avg` : "Avg temp unavailable"}</span>
                    <span>{streetSelectionLeft.isHeatCorridor ? "Heat Corridor" : "Non-corridor street"}</span>
                    <span>{streetSelectionLeft.nearbyCells.length} nearby cells</span>
                  </div>
                  <div className="street-selection-panel-section-title">Recommended Actions</div>
                  {streetSelectionLeft.recommendations.length > 0 ? (
                    <div className="street-selection-panel-list">
                      {streetSelectionLeft.recommendations.map((rec) => (
                        <article key={`left-${streetSelectionLeft.streetId}-${rec.intervention}`} className="street-selection-card">
                          <div className="street-selection-card-title">
                            {rec.icon} {rec.intervention}
                          </div>
                          <p className="street-selection-card-copy">{rec.reason}</p>
                          <div className="street-selection-card-hint">Why: {rec.detail}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="street-selection-panel-empty">No recommended interventions for this street segment.</p>
                  )}
                </>
              ) : (
                <p className="street-selection-panel-empty">Click a street in the primary map to view recommendation details.</p>
              )}
            </aside>
          </div>

          <div className="map-compare-column">
            <div className={`map-container-with-legend${projectionMode === "globe" ? " map-container-earth" : ""} ${fullscreenMap === "right" ? "map-container-fullscreen" : ""}`}>
              <h3 className="map-panel-title">Secondary</h3>
              <button className="map-fs-btn" onClick={() => setFullscreenMap((prev) => (prev === "right" ? null : "right"))}>
                {fullscreenMap === "right" ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <div className="map-projection-toggle" role="group" aria-label="Projection mode">
                <button
                  type="button"
                  className={`map-projection-btn${projectionMode === "globe" ? " active" : ""}`}
                  onClick={() => setProjectionMode("globe")}
                  aria-label="Switch to Earth view"
                >
                  Earth
                </button>
                <button
                  type="button"
                  className={`map-projection-btn${projectionMode === "mercator" ? " active" : ""}`}
                  onClick={() => setProjectionMode("mercator")}
                  aria-label="Switch to Flat view"
                >
                  Flat
                </button>
              </div>
              <div className="map-panel-animation-status">
                <AnimationStatusBadge status={animationStatusRight} label="Secondary" />
              </div>
              {rightQuery.isLoading && <p>Loading secondary map data...</p>}
              <ThermalTrustBadge data={rightQuery.data} compact />
              <NoSelectionsBanner data={rightQuery.data} label="Secondary run" />
              {rightQuery.error && <p>Failed to load secondary map data.</p>}
              <RunMapCanvas
                data={rightQuery.data}
                mapKey="right"
                showHeatCorridors={showHeatCorridors}
                showInterventions={showInterventions}
                showInterventionCircles={showInterventionCircles}
                animateCircles={animateCircles}
                heatFillOpacity={heatFillOpacity}
                isFullscreen={fullscreenMap === "right"}
                streetLevelMode={streetLevelMode}
                onStreetSelect={handleRightStreetSelect}
                heatCorridorLayers={heatCorridorLayersRight}
                projectionMode={projectionMode}
                showStudyAreaBoundary={showStudyAreaBoundary}
                addressFocus={addressFocus}
                plannedInterventions={plannedInterventionLayer}
                requiredConfidence={requiredConfidence}
                onAnimationStateChange={setAnimationStatusRight}
              />
              {rightQuery.data && showLegend && <MapLegend data={rightQuery.data} minimized={minimizeLegend} />}
              {runIdRight && (
                <p className="map-detail-link-row">
                  <Link to="/runs/$runId" params={{ runId: runIdRight }}>Open Secondary Run Detail</Link>
                </p>
              )}
            </div>
            <aside className="street-selection-panel street-selection-panel-compare" aria-live="polite">
              <div className="street-selection-panel-title">Secondary Street Recommendations</div>
              {streetSelectionRight ? (
                <>
                  {streetSelectionRightAt && (
                    <div className="street-selection-panel-meta">
                      <span>Last selected: {formatSelectionTime(streetSelectionRightAt)}</span>
                    </div>
                  )}
                  <div className="street-selection-panel-street">{streetSelectionRight.streetId}</div>
                  <div className="street-selection-panel-meta">
                    <span>{Number.isFinite(streetSelectionRight.avgTemp) ? `${streetSelectionRight.avgTemp.toFixed(2)}°C avg` : "Avg temp unavailable"}</span>
                    <span>{streetSelectionRight.isHeatCorridor ? "Heat Corridor" : "Non-corridor street"}</span>
                    <span>{streetSelectionRight.nearbyCells.length} nearby cells</span>
                  </div>
                  <div className="street-selection-panel-section-title">Recommended Actions</div>
                  {streetSelectionRight.recommendations.length > 0 ? (
                    <div className="street-selection-panel-list">
                      {streetSelectionRight.recommendations.map((rec) => (
                        <article key={`right-${streetSelectionRight.streetId}-${rec.intervention}`} className="street-selection-card">
                          <div className="street-selection-card-title">
                            {rec.icon} {rec.intervention}
                          </div>
                          <p className="street-selection-card-copy">{rec.reason}</p>
                          <div className="street-selection-card-hint">Why: {rec.detail}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="street-selection-panel-empty">No recommended interventions for this street segment.</p>
                  )}
                </>
              ) : (
                <p className="street-selection-panel-empty">Click a street in the secondary map to view recommendation details.</p>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
