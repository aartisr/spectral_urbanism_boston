import type maplibregl from "maplibre-gl";

interface SegmentMap {
  [key: string]: number;
}

export function percentile(sortedVals: number[], q: number): number {
  if (sortedVals.length === 0) {
    return 0;
  }
  const idx = (sortedVals.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sortedVals[lo];
  }
  const w = idx - lo;
  return sortedVals[lo] * (1 - w) + sortedVals[hi] * w;
}

export function getObservedTemps(fc?: GeoJSON.FeatureCollection): number[] {
  if (!fc?.features?.length) {
    return [];
  }
  const vals: number[] = [];
  for (const f of fc.features) {
    const raw = (f.properties as Record<string, unknown> | null)?.observed_temp;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) {
      vals.push(n);
    }
  }
  vals.sort((a, b) => a - b);
  return vals;
}

export function buildThermalGradientExpression(fc?: GeoJSON.FeatureCollection): maplibregl.Expression {
  const vals = getObservedTemps(fc);
  if (vals.length === 0) {
    return "#2b5580" as unknown as maplibregl.Expression;
  }

  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "observed_temp"], 0],
    percentile(vals, 0),
    "#2b5580",
    percentile(vals, 0.5),
    "#4c86a8",
    percentile(vals, 0.85),
    "#f08a24",
    percentile(vals, 1),
    "#d6452f",
  ] as unknown as maplibregl.Expression;
}

export function buildStudyAreaBoundary(fc?: GeoJSON.FeatureCollection): GeoJSON.Polygon | null {
  if (!fc?.features?.length) {
    return null;
  }

  const allCoords: [number, number][] = [];
  for (const feature of fc.features) {
    const geom = feature.geometry as GeoJSON.Polygon | null;
    if (geom?.type === "Polygon" && geom.coordinates[0]) {
      for (const pt of geom.coordinates[0]) {
        allCoords.push(pt as [number, number]);
      }
    }
  }
  if (allCoords.length === 0) return null;

  function cross(o: [number, number], a: [number, number], b: [number, number]) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  const points = Array.from(new Set(allCoords.map((c) => JSON.stringify(c))))
    .map((c) => JSON.parse(c) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: [number, number][] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  if (hull.length > 0 && (hull[0][0] !== hull[hull.length - 1][0] || hull[0][1] !== hull[hull.length - 1][1])) {
    hull.push(hull[0]);
  }

  return {
    type: "Polygon",
    coordinates: [hull],
  };
}

function isSelectedFeature(feature: GeoJSON.Feature): boolean {
  const props = (feature.properties as Record<string, unknown> | null) ?? {};
  const count = Number(props.selected_count ?? 0);
  return count > 0 || Boolean(props.selected);
}

export function buildSelectedCentroids(fc?: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  if (!fc?.features?.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const feature of fc.features) {
    if (!isSelectedFeature(feature)) {
      continue;
    }
    const geom = feature.geometry as GeoJSON.Polygon | null;
    if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]?.length) {
      continue;
    }

    const ring = geom.coordinates[0] as [number, number][];
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const cx = sx / ring.length;
    const cy = sy / ring.length;
    const props = (feature.properties as Record<string, unknown> | null) ?? {};

    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cx, cy] },
      properties: {
        cell_id: props.cell_id,
        selected_count: props.selected_count,
        selected_kinds: props.selected_kinds,
        observed_temp: props.observed_temp,
      },
    });
  }

  return { type: "FeatureCollection", features: out };
}

export function buildAllCentroids(fc?: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  if (!fc?.features?.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const feature of fc.features) {
    const geom = feature.geometry as GeoJSON.Polygon | null;
    if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]?.length) {
      continue;
    }

    const ring = geom.coordinates[0] as [number, number][];
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const cx = sx / ring.length;
    const cy = sy / ring.length;
    const props = (feature.properties as Record<string, unknown> | null) ?? {};

    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cx, cy] },
      properties: {
        cell_id: props.cell_id,
        selected_count: props.selected_count,
        observed_temp: props.observed_temp,
      },
    });
  }

  return { type: "FeatureCollection", features: out };
}

export function selectedBounds(fc?: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  if (!fc?.features?.length) {
    return null;
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let found = false;

  for (const feature of fc.features) {
    if (!isSelectedFeature(feature)) {
      continue;
    }
    const geom = feature.geometry as GeoJSON.Polygon | null;
    if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]?.length) {
      continue;
    }
    for (const [lon, lat] of geom.coordinates[0] as [number, number][]) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
      found = true;
    }
  }

  if (!found) {
    return null;
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

export function extractStreetSegments(fc?: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  if (!fc?.features?.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const segmentMap: SegmentMap = {};
  const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  for (const feature of fc.features) {
    const cellProps = feature.properties as Record<string, unknown> | null;
    const cellId = String(cellProps?.cell_id ?? "");
    const geom = feature.geometry as GeoJSON.Polygon | null;
    if (!geom?.type || geom.type !== "Polygon" || !geom.coordinates[0]) continue;

    const coords = geom.coordinates[0];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i] as [number, number];
      const b = coords[i + 1] as [number, number];
      const normalized = [
        [Math.round(a[0] * 1e6) / 1e6, Math.round(a[1] * 1e6) / 1e6],
        [Math.round(b[0] * 1e6) / 1e6, Math.round(b[1] * 1e6) / 1e6],
      ] as [[number, number], [number, number]];
      const sorted = normalized.sort((p1, p2) => (p1[0] !== p2[0] ? p1[0] - p2[0] : p1[1] - p2[1]));
      const key = JSON.stringify(sorted);

      const existingIndex = segmentMap[key];
      const observedTemp = Number(cellProps?.observed_temp ?? 0);
      const isHeatCorridor =
        cellProps?.heat_corridor === true ||
        cellProps?.heat_corridor === 1 ||
        cellProps?.heat_corridor === "1" ||
        String(cellProps?.heat_corridor).toLowerCase() === "true";

      if (existingIndex !== undefined) {
        const existing = segments[existingIndex];
        const props = existing.properties as Record<string, unknown>;
        const currentCount = Number(props.cell_count ?? 1);
        const currentTemp = Number(props.avg_temp ?? 0);
        props.cell_count = currentCount + 1;
        props.avg_temp = (currentTemp * currentCount + observedTemp) / (currentCount + 1);
        props.max_temp = Math.max(Number(props.max_temp ?? observedTemp), observedTemp);
        props.is_heat_corridor = Boolean(props.is_heat_corridor) || isHeatCorridor;
        props.nearby_cells = [...parseNearbyCellIds(props.nearby_cells), cellId];
      } else {
        segmentMap[key] = segments.length;
        const midpointLng = (sorted[0][0] + sorted[1][0]) / 2;
        const midpointLat = (sorted[0][1] + sorted[1][1]) / 2;
        segments.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [sorted[0], sorted[1]],
          },
          properties: {
            street_id: `street_${segments.length}`,
            cell_count: 1,
            avg_temp: observedTemp,
            max_temp: observedTemp,
            is_heat_corridor: isHeatCorridor,
            nearby_cells: [cellId],
            lng: midpointLng,
            lat: midpointLat,
            segment_start_lng: sorted[0][0],
            segment_start_lat: sorted[0][1],
            segment_end_lng: sorted[1][0],
            segment_end_lat: sorted[1][1],
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: segments,
  };
}

export function getStreetRecommendations(
  properties: Record<string, unknown> | null,
  availableInterventions: string[],
): Array<{ intervention: string; icon: string; reason: string; detail: string }> {
  if (!properties) return [];

  const avgTemp = Number(properties.avg_temp ?? 0);
  const rawHeatCorridor = properties.is_heat_corridor;
  const isHeatCorridor =
    rawHeatCorridor === true ||
    rawHeatCorridor === 1 ||
    rawHeatCorridor === "1" ||
    String(rawHeatCorridor).toLowerCase() === "true";

  const recommendations: Array<{ intervention: string; icon: string; reason: string; detail: string }> = [];

  const interventionMap: Record<string, { icon: string; reason: string; detail: string; minTemp?: number }> = {
    tree: {
      icon: "🌳",
      reason: "Direct shade + cooling effect",
      detail: "Street trees reduce radiant heat on pavements and sidewalks, improve pedestrian comfort, and lower local air temperature through evapotranspiration.",
      minTemp: 28,
    },
    cool_roof: {
      icon: "🏠",
      reason: "Reduce building absorption",
      detail: "Cool roof materials reflect more solar radiation and absorb less heat, reducing indoor cooling demand and limiting heat re-radiation into surrounding streets.",
      minTemp: 30,
    },
    reflective_pavement: {
      icon: "🟦",
      reason: "Lower street surface temp",
      detail: "High-albedo pavement coatings reduce surface heat buildup during peak sun hours, which can lower near-surface air temperature and improve daytime thermal comfort.",
      minTemp: 32,
    },
    shade_corridor: {
      icon: "🌲",
      reason: "Create shaded walkway",
      detail: "Continuous shade corridors combine canopy and shade structures along key walking routes to reduce heat exposure for commuters and vulnerable populations.",
      minTemp: 29,
    },
    green_space: {
      icon: "🌱",
      reason: "Vegetation & evapotranspiration",
      detail: "Pocket green spaces and planted medians improve cooling through shading and evapotranspiration while adding permeable surfaces that reduce urban heat retention.",
      minTemp: 28,
    },
    water_feature: {
      icon: "💧",
      reason: "Evaporative cooling",
      detail: "Water features and misting elements can provide localized evaporative cooling in high-footfall zones, especially during severe heat windows.",
      minTemp: 30,
    },
  };

  for (const intervention of availableInterventions) {
    const info = interventionMap[intervention];
    if (!info) continue;

    if (isHeatCorridor || (info.minTemp && avgTemp >= info.minTemp)) {
      recommendations.push({
        intervention,
        icon: info.icon,
        reason: info.reason,
        detail: info.detail,
      });
    }
  }

  return recommendations.slice(0, 4);
}

type InterventionPlacementLocation = {
  lng: number;
  lat: number;
  label: string;
  suitability: string;
};

export type HeatCorridorActionPlan = {
  status: "ready" | "not_corridor" | "unavailable";
  summary: string;
  probability: number | null;
  targetCoolingC: number | null;
  estimatedCoolingC: number | null;
  coolingRangeC: [number, number] | null;
  estimatedBudget: number | null;
  budgetRange: [number, number] | null;
  interventionCount: number;
  method: string;
  evidenceSources: Array<{ label: string; url: string }>;
  actions: Array<{
    kind: string;
    icon: string;
    count: number;
    unitCost: number | null;
    totalCost: number | null;
    locations: InterventionPlacementLocation[];
    placement: string;
    suitability: string;
    expectedCoolingC: number;
    coolingRangeC: [number, number];
    rationale: string;
  }>;
};

function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter(Boolean);
  }
  if (typeof raw !== "string") {
    return [];
  }
  const val = raw.trim();
  if (!val) {
    return [];
  }
  return val.split(",").map((x) => x.trim()).filter(Boolean);
}

function parseNearbyCellIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter(Boolean);
  }
  if (typeof raw !== "string") {
    return [];
  }
  const val = raw.trim();
  if (!val) {
    return [];
  }
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x)).filter(Boolean);
    }
  } catch {
    // Continue with comma-separated parsing.
  }
  return val.split(",").map((x) => x.trim()).filter(Boolean);
}

function probabilityFromCooling(targetCoolingC: number, estimatedCoolingC: number, coverage: number): number {
  if (targetCoolingC <= 0) {
    return 0.92;
  }
  const ratio = estimatedCoolingC / targetCoolingC;
  const base = 1 / (1 + Math.exp(-3.2 * (ratio - 0.92)));
  const adjusted = base * (0.72 + Math.min(coverage, 1) * 0.24);
  return Math.max(0.08, Math.min(0.94, adjusted));
}

const HEAT_MITIGATION_EVIDENCE = [
  {
    label: "U.S. EPA Heat Island Cooling Strategies",
    url: "https://www.epa.gov/heatislands/heat-island-reduction-solutions",
  },
  {
    label: "U.S. EPA Guide to Reducing Heat Islands",
    url: "https://www.epa.gov/heatislands/guide-reducing-heat-islands",
  },
  {
    label: "U.S. EPA Cool Pavements",
    url: "https://www.epa.gov/heatislands/using-cool-pavements-reduce-heat-islands",
  },
];

type CoolingModel = {
  icon: string;
  coolingC: [number, number, number];
  placement: string;
  rationale: string;
  placementKind: "curb" | "corridor" | "pavement" | "roof";
};

type PlacementCandidate = {
  lng: number;
  lat: number;
  cellId: string;
  temp: number;
  heatCorridor: boolean;
  selected: boolean;
  selectedKinds: string[];
  score: number;
};

function isValidPlacementLocation(loc: InterventionPlacementLocation | null): loc is InterventionPlacementLocation {
  if (!loc) {
    return false;
  }
  return Number.isFinite(loc.lng) && Number.isFinite(loc.lat) && (loc.lng !== 0 || loc.lat !== 0);
}

function scenarioProbability(targetCoolingC: number, lowCooling: number, midCooling: number, highCooling: number, coverage: number): number {
  if (targetCoolingC <= 0) {
    return 0.92;
  }
  const samples = [lowCooling, (lowCooling + midCooling) / 2, midCooling, (midCooling + highCooling) / 2, highCooling];
  const hits = samples.filter((cooling) => cooling >= targetCoolingC).length / samples.length;
  const surplus = Math.max(0, midCooling - targetCoolingC) / Math.max(targetCoolingC, 0.25);
  const evidenceFactor = 0.78 + Math.min(coverage, 1) * 0.16;
  return Math.max(0.06, Math.min(0.95, (hits * 0.72 + Math.min(surplus, 1) * 0.28) * evidenceFactor));
}

function planScore(plan: HeatCorridorActionPlan): number {
  const probability = plan.probability ?? 0;
  const estimatedBudget = plan.estimatedBudget;
  const actionCount = plan.interventionCount;
  const hasStreetCooling = plan.actions.some((action) =>
    ["shade_corridor", "tree", "reflective_pavement", "green_space"].includes(action.kind),
  );
  const hasPavementOrCanopy = plan.actions.some((action) =>
    ["shade_corridor", "tree", "reflective_pavement"].includes(action.kind),
  );
  const budgetPenalty = estimatedBudget === null ? 0.08 : Math.min(0.28, estimatedBudget * 0.025);
  const complexityPenalty = Math.min(0.18, Math.max(0, actionCount - 1) * 0.035);
  const roofOnlyPenalty = hasStreetCooling ? 0 : 0.32;
  const weakCorridorPenalty = hasPavementOrCanopy ? 0 : 0.16;
  return probability - budgetPenalty - complexityPenalty - roofOnlyPenalty - weakCorridorPenalty;
}

function featureCentroid(feature: GeoJSON.Feature): [number, number] | null {
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

function streetEndpoints(properties: Record<string, unknown>): [[number, number], [number, number]] | null {
  const startLng = Number(properties.segment_start_lng);
  const startLat = Number(properties.segment_start_lat);
  const endLng = Number(properties.segment_end_lng);
  const endLat = Number(properties.segment_end_lat);
  if ([startLng, startLat, endLng, endLat].every(Number.isFinite)) {
    return [[startLng, startLat], [endLng, endLat]];
  }

  const geometry = properties.street_geometry as GeoJSON.LineString | undefined;
  const coords = geometry?.type === "LineString" ? geometry.coordinates : [];
  if (coords.length >= 2) {
    const first = coords[0] as [number, number];
    const last = coords[coords.length - 1] as [number, number];
    return [first, last];
  }
  return null;
}

function interpolateStreetPoint(
  endpoints: [[number, number], [number, number]] | null,
  index: number,
  count: number,
): { lng: number; lat: number; normalLng: number; normalLat: number } | null {
  if (!endpoints) {
    return null;
  }
  const [[ax, ay], [bx, by]] = endpoints;
  const t = (index + 1) / (count + 1);
  const lng = ax + (bx - ax) * t;
  const lat = ay + (by - ay) * t;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return {
    lng,
    lat,
    normalLng: -dy / len,
    normalLat: dx / len,
  };
}

function interventionLocation(
  kind: string,
  candidate: PlacementCandidate | undefined,
  properties: Record<string, unknown>,
  index: number,
  count: number,
): { lng: number; lat: number; label: string; suitability: string } | null {
  const endpoints = streetEndpoints(properties);
  const streetPoint = interpolateStreetPoint(endpoints, index, count);
  const fallbackLng = Number(properties.lng);
  const fallbackLat = Number(properties.lat);
  const baseLng = candidate?.lng ?? streetPoint?.lng ?? fallbackLng;
  const baseLat = candidate?.lat ?? streetPoint?.lat ?? fallbackLat;
  if (!Number.isFinite(baseLng) || !Number.isFinite(baseLat)) {
    return null;
  }

  const normalLng = streetPoint?.normalLng ?? 0;
  const normalLat = streetPoint?.normalLat ?? 0;
  const streetLng = streetPoint?.lng ?? baseLng;
  const streetLat = streetPoint?.lat ?? baseLat;
  const blend = (streetWeight: number) => ({
    lng: streetLng * streetWeight + baseLng * (1 - streetWeight),
    lat: streetLat * streetWeight + baseLat * (1 - streetWeight),
  });

  const tempText = Number.isFinite(candidate?.temp) ? `${candidate?.temp.toFixed(1)} C` : "unknown temp";
  const heatText = candidate?.heatCorridor ? "heat-corridor cell" : "nearby warm cell";
  const selectedText = candidate?.selected ? "optimizer-selected" : "candidate";
  const cellText = candidate?.cellId ? `cell ${candidate.cellId}` : "street segment";

  if (kind === "shade_corridor") {
    const p = blend(0.82);
    return {
      lng: p.lng + normalLng * 0.00007,
      lat: p.lat + normalLat * 0.00007,
      label: `continuous shade line at ${cellText}`,
      suitability: `${heatText}; ${selectedText}; ${tempText}`,
    };
  }
  if (kind === "tree") {
    const p = blend(0.78);
    const side = index % 2 === 0 ? 1 : -1;
    return {
      lng: p.lng + normalLng * 0.0001 * side,
      lat: p.lat + normalLat * 0.0001 * side,
      label: `curb tree cluster at ${cellText}`,
      suitability: `${heatText}; ${selectedText}; ${tempText}`,
    };
  }
  if (kind === "reflective_pavement") {
    const p = blend(0.55);
    return {
      lng: p.lng,
      lat: p.lat,
      label: `cool pavement zone at ${cellText}`,
      suitability: `${heatText}; high pavement exposure proxy; ${tempText}`,
    };
  }
  if (kind === "cool_roof") {
    const p = blend(0.18);
    return {
      lng: p.lng + normalLng * 0.00022,
      lat: p.lat + normalLat * 0.00022,
      label: `adjacent roof proxy near ${cellText}`,
      suitability: `${heatText}; building-adjacent proxy from grid data; ${tempText}`,
    };
  }

  return {
    lng: baseLng,
    lat: baseLat,
    label: `${kind} at ${cellText}`,
    suitability: `${heatText}; ${selectedText}; ${tempText}`,
  };
}

export function buildHeatCorridorActionPlan(
  properties: Record<string, unknown> | null,
  fc: GeoJSON.FeatureCollection | undefined,
  threshold: number | null | undefined,
  availableInterventions: string[],
  interventionCosts: Record<string, number> = {},
  requiredConfidence = 0.7,
): HeatCorridorActionPlan {
  const avgTemp = Number(properties?.avg_temp ?? NaN);
  const isHeatCorridor =
    properties?.is_heat_corridor === true ||
    properties?.is_heat_corridor === 1 ||
    properties?.is_heat_corridor === "1" ||
    String(properties?.is_heat_corridor).toLowerCase() === "true";

  if (!properties || !Number.isFinite(avgTemp) || !Number.isFinite(Number(threshold))) {
    return {
      status: "unavailable",
      summary: "Action plan unavailable because this run does not expose a usable corridor threshold for the selected street.",
      probability: null,
      targetCoolingC: null,
      estimatedCoolingC: null,
      coolingRangeC: null,
      estimatedBudget: null,
      budgetRange: null,
      interventionCount: 0,
      method: "No scenario model was run because the selected street lacks threshold or temperature data.",
      evidenceSources: HEAT_MITIGATION_EVIDENCE,
      actions: [],
    };
  }

  if (!isHeatCorridor) {
    return {
      status: "not_corridor",
      summary: "This selected street is already below the current heat-corridor threshold.",
      probability: null,
      targetCoolingC: 0,
      estimatedCoolingC: 0,
      coolingRangeC: [0, 0],
      estimatedBudget: 0,
      budgetRange: [0, 0],
      interventionCount: 0,
      method: "No intervention scenario is needed because the selected street is below the current heat-corridor threshold.",
      evidenceSources: HEAT_MITIGATION_EVIDENCE,
      actions: [],
    };
  }

  const targetCoolingC = Math.max(0.25, avgTemp - Number(threshold) + 0.15);
  const confidenceTarget = Math.max(0.5, Math.min(0.95, requiredConfidence));
  const planningCoolingTarget = targetCoolingC * (1 + Math.max(0, confidenceTarget - 0.6) * 1.35);
  const nearbyCells = new Set(parseNearbyCellIds(properties.nearby_cells));
  const localFeatures = (fc?.features ?? [])
    .filter((feature) => nearbyCells.has(String((feature.properties as Record<string, unknown> | null)?.cell_id ?? "")))
    .sort((a, b) => {
      const at = Number((a.properties as Record<string, unknown> | null)?.observed_temp ?? 0);
      const bt = Number((b.properties as Record<string, unknown> | null)?.observed_temp ?? 0);
      return bt - at;
    });

  const selectedKinds = new Set<string>();
  let selectedCoverage = 0;
  for (const feature of localFeatures) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const count = Number(props.selected_count ?? 0);
    if (count > 0 || props.selected === true) {
      selectedCoverage += 1;
    }
    for (const kind of parseStringList(props.selected_kinds)) {
      selectedKinds.add(kind);
    }
  }

  // Cooling ranges are conservative planning assumptions derived from EPA heat-island mitigation guidance.
  // See docs/COOLING_EVIDENCE.md before changing these coefficients.
  const coolingModel: Record<string, CoolingModel> = {
    shade_corridor: {
      icon: "🌲",
      coolingC: [0.35, 0.85, 1.35],
      placement: "continuous shade along the hottest linked sidewalk cells",
      rationale: "Best first move when the goal is to reduce pedestrian heat exposure across a corridor segment.",
      placementKind: "corridor",
    },
    tree: {
      icon: "🌳",
      coolingC: [0.25, 0.65, 1.1],
      placement: "tree canopy at exposed curb edges and waiting areas",
      rationale: "Adds direct shade and evapotranspiration where people experience radiant heat.",
      placementKind: "curb",
    },
    reflective_pavement: {
      icon: "🟦",
      coolingC: [0.15, 0.45, 0.9],
      placement: "high-sun pavement cells adjacent to the selected street",
      rationale: "Reduces surface heat storage on street and sidewalk materials.",
      placementKind: "pavement",
    },
    green_space: {
      icon: "🌱",
      coolingC: [0.12, 0.38, 0.75],
      placement: "pocket planting in nearby eligible open or median cells",
      rationale: "Adds vegetative cooling where a full canopy intervention may not fit.",
      placementKind: "curb",
    },
    water_feature: {
      icon: "💧",
      coolingC: [0.08, 0.28, 0.55],
      placement: "high-footfall waiting zones or plazas",
      rationale: "Provides localized evaporative relief during severe heat windows.",
      placementKind: "curb",
    },
    cool_roof: {
      icon: "🏠",
      coolingC: [0.05, 0.22, 0.5],
      placement: "large roof surfaces bordering the corridor",
      rationale: "Reduces absorbed building heat that can re-radiate into the street canyon.",
      placementKind: "roof",
    },
  };

  const rankedKinds = availableInterventions
    .filter((kind) => coolingModel[kind])
    .sort((a, b) => {
      const coolingPriority = coolingModel[b].coolingC[1] - coolingModel[a].coolingC[1];
      if (Math.abs(coolingPriority) > 0.12) return coolingPriority;
      const selectedBias = Number(selectedKinds.has(b)) - Number(selectedKinds.has(a));
      if (selectedBias !== 0) return selectedBias;
      return coolingPriority;
    });
  const streetFirstKinds = rankedKinds.filter((kind) => kind !== "cool_roof");
  const roofKinds = rankedKinds.filter((kind) => kind === "cool_roof");
  const planningKinds = [...streetFirstKinds, ...roofKinds];

  const localCellCount = Math.max(1, nearbyCells.size || localFeatures.length || 1);
  const scenarioSeeds = (streetFirstKinds.length > 0 ? streetFirstKinds : planningKinds).slice(0, 5);
  const scenarios: HeatCorridorActionPlan[] = [];
  const maxLocalTemp = Math.max(
    avgTemp,
    ...localFeatures.map((feature) => Number((feature.properties as Record<string, unknown> | null)?.observed_temp ?? avgTemp)),
  );
  const minLocalTemp = Math.min(
    avgTemp,
    ...localFeatures.map((feature) => Number((feature.properties as Record<string, unknown> | null)?.observed_temp ?? avgTemp)),
  );
  const tempSpread = Math.max(0.1, maxLocalTemp - minLocalTemp);
  const locationPool = localFeatures
    .map((feature) => {
      const center = featureCentroid(feature);
      const props = (feature.properties as Record<string, unknown> | null) ?? {};
      const temp = Number(props.observed_temp ?? 0);
      const kinds = parseStringList(props.selected_kinds);
      const selected = Number(props.selected_count ?? 0) > 0 || props.selected === true;
      const heatCorridor =
        props.heat_corridor === true ||
        props.heat_corridor === 1 ||
        props.heat_corridor === "1" ||
        String(props.heat_corridor).toLowerCase() === "true";
      const score =
        (Number.isFinite(temp) ? (temp - minLocalTemp) / tempSpread : 0) +
        (heatCorridor ? 0.45 : 0) +
        (selected ? 0.35 : 0) +
        Math.min(0.2, kinds.length * 0.05);
      return center
        ? {
            lng: center[0],
            lat: center[1],
            cellId: String(props.cell_id ?? "cell"),
            temp,
            heatCorridor,
            selected,
            selectedKinds: kinds,
            score,
          }
        : null;
    })
    .filter((item): item is PlacementCandidate => Boolean(item))
    .sort((a, b) => b.score - a.score);

  for (let seedIndex = 0; seedIndex < Math.max(1, scenarioSeeds.length); seedIndex++) {
    const orderedKinds = [
      ...scenarioSeeds.slice(seedIndex, seedIndex + 1),
      ...streetFirstKinds.filter((kind) => kind !== scenarioSeeds[seedIndex]),
      ...roofKinds,
    ].filter(Boolean);
    const actions: HeatCorridorActionPlan["actions"] = [];
    let lowCooling = 0;
    let estimatedCoolingC = 0;
    let highCooling = 0;
    let remainingCoolingC = planningCoolingTarget;

    for (const kind of orderedKinds) {
      const hasStreetAction = actions.some((action) => action.kind !== "cool_roof");
      if ((remainingCoolingC <= 0.05 && hasStreetAction) || actions.length >= 6) {
        break;
      }
      if (kind === "cool_roof" && !hasStreetAction && streetFirstKinds.length > 0) {
        continue;
      }
      const model = coolingModel[kind];
      const unitCost = Number(interventionCosts[kind]);
      const maxCount = kind === "shade_corridor" || kind === "cool_roof" ? 1 : Math.min(4, Math.max(localCellCount, 3));
      const count = Math.max(1, Math.min(maxCount, Math.ceil(remainingCoolingC / model.coolingC[1])));
      const actionLow = Number((count * model.coolingC[0]).toFixed(2));
      const actionMid = Number((count * model.coolingC[1]).toFixed(2));
      const actionHigh = Number((count * model.coolingC[2]).toFixed(2));
      const locations = Array.from({ length: count }, (_, idx) => {
        const candidate = locationPool[idx % Math.max(1, locationPool.length)];
        return interventionLocation(kind, candidate, properties, idx, count);
      }).filter(isValidPlacementLocation);
      actions.push({
        kind,
        icon: model.icon,
        count,
        unitCost: Number.isFinite(unitCost) ? unitCost : null,
        totalCost: Number.isFinite(unitCost) ? Number((unitCost * count).toFixed(2)) : null,
        locations,
        placement: selectedKinds.has(kind) ? `${model.placement}; prioritize cells already selected by the optimizer` : model.placement,
        suitability: locations[0]?.suitability ?? "Suitability based on nearby thermal cells and configured intervention availability.",
        expectedCoolingC: actionMid,
        coolingRangeC: [actionLow, actionHigh],
        rationale: model.rationale,
      });
      lowCooling += actionLow;
      estimatedCoolingC += actionMid;
      highCooling += actionHigh;
      remainingCoolingC -= actionMid;
    }

    const interventionCount = actions.reduce((sum, action) => sum + action.count, 0);
    const knownBudget = actions.reduce((sum, action) => sum + (action.totalCost ?? 0), 0);
    const hasCompleteBudget = actions.every((action) => action.totalCost !== null);
    const budgetLow = hasCompleteBudget ? Number((knownBudget * 0.85).toFixed(2)) : null;
    const budgetHigh = hasCompleteBudget ? Number((knownBudget * 1.25).toFixed(2)) : null;
    const coverage = Math.max(selectedCoverage / localCellCount, actions.length > 0 ? 0.35 : 0);
    const probability = scenarioProbability(targetCoolingC, lowCooling, estimatedCoolingC, highCooling, coverage);

    scenarios.push({
      status: "ready",
      summary: `Estimated ${interventionCount} targeted intervention${interventionCount === 1 ? "" : "s"} to bring this street below the heat-corridor threshold. Raise required confidence to test a more redundant intervention mix.`,
      probability,
      targetCoolingC: Number(targetCoolingC.toFixed(2)),
      estimatedCoolingC: Number(estimatedCoolingC.toFixed(2)),
      coolingRangeC: [Number(lowCooling.toFixed(2)), Number(highCooling.toFixed(2))],
      estimatedBudget: hasCompleteBudget ? Number(knownBudget.toFixed(2)) : null,
      budgetRange: hasCompleteBudget && budgetLow !== null && budgetHigh !== null ? [budgetLow, budgetHigh] : null,
      interventionCount,
      method: "Planning-grade scenario planner: ranks feasible mixes using EPA-grounded mitigation families, local temperature gap to the run threshold, configured costs, adjacent grid-cell heat, optimizer-selected cells, street-segment geometry, and low/mid/high cooling uncertainty bands. Placement markers are block-level candidates, not surveyed curb assets.",
      evidenceSources: HEAT_MITIGATION_EVIDENCE,
      actions,
    });
  }

  return scenarios.sort((a, b) => planScore(b) - planScore(a))[0];
}

function pointSegmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-18) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export function findNearestStreetFeature(
  streetFc: GeoJSON.FeatureCollection | undefined,
  lng: number,
  lat: number,
  maxDistanceDeg = 0.004,
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!streetFc?.features?.length) {
    return null;
  }

  const maxDist2 = maxDistanceDeg * maxDistanceDeg;
  let bestFeature: GeoJSON.Feature<GeoJSON.LineString> | null = null;
  let bestDist2 = Number.POSITIVE_INFINITY;

  for (const f of streetFc.features) {
    const g = f.geometry as GeoJSON.LineString | null;
    if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates) || g.coordinates.length < 2) {
      continue;
    }

    const coords = g.coordinates as [number, number][];
    let localBest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < coords.length - 1; i++) {
      const [ax, ay] = coords[i];
      const [bx, by] = coords[i + 1];
      const d2 = pointSegmentDistanceSquared(lng, lat, ax, ay, bx, by);
      if (d2 < localBest) {
        localBest = d2;
      }
    }

    if (localBest < bestDist2) {
      bestDist2 = localBest;
      bestFeature = f as GeoJSON.Feature<GeoJSON.LineString>;
    }
  }

  if (!bestFeature || bestDist2 > maxDist2) {
    return null;
  }
  return bestFeature;
}
