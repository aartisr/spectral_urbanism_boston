import { useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createRun, validateConfig } from "../lib/api";

const defaultConfig = {
  run: { run_id: "api_run", seed: 42, out_dir: "outputs" },
  city: {
    name: "Boston",
    bbox: [-71.1912, 42.2279, -70.986, 42.3969],
    crs: "EPSG:4326",
    grid_resolution_m: 1000,
  },
  data_paths: {
    root: "data",
    osm: "data/osm/boston.osm.pbf",
    lst_landsat: "data/thermal/landsat_lst.tif",
    ndvi_s2: "data/ndvi/sentinel2_ndvi.tif",
    albedo: "data/albedo/albedo.tif",
    impervious: "data/landcover/impervious.tif",
    wind: "data/wind/noaa_wind.csv",
    svi: "data/equity/cdc_svi.csv",
    buildings: "data/buildings/buildings.gpkg",
    canopy: "data/canopy/canopy.gpkg"
  },
  features: {
    auto_discover_plugins: false,
    plugins: ["raster_features", "defaults", "equity_placeholder"],
    plugin_contract_version: "1.0",
    required_capabilities: ["thermal-observations", "feature-fallback", "equity"],
    observed_temp_column: "lst",
    defaults: { lst: 35.0, ndvi: 0.2, albedo: 0.15, impervious: 0.5 },
  },
  graph: { edge_mode: "adjacency_plus_wind", wind_k: 1, weight_model: {} },
  gmrf: { tau: 1.0, epsilon: 0.001, obs_noise: 0.5 },
  interventions: {
    budget_k: 5,
    types: ["tree", "cool_roof", "reflective_pavement", "shade_corridor"],
    costs: { tree: 1.0, cool_roof: 1.0, reflective_pavement: 0.7, shade_corridor: 0.65 },
    effects: {
      tree: { edge_weight_multiplier: 1.17 },
      cool_roof: { edge_weight_multiplier: 1.15 },
      reflective_pavement: { edge_weight_multiplier: 1.18 },
      shade_corridor: { edge_weight_multiplier: 1.2 },
    },
  },
  objective: {
    alpha_lambda2: 1.0,
    beta_reliability: 1.0,
    gamma_equity: 1.0,
    equity: { svi_column: "SVI", top_quantile: 0.8 },
  },
  experiments: {
    monte_carlo_draws: 50,
    reliability_p_keep: 0.9,
    confidence_alpha: 0.05,
    enforce_thermal_variation_gate: false,
    ablations: [],
  },
  optimization: {
    eval_top_k: 100,
    stop_if_nonpositive_gain: true,
    corridor_preference_weight: 0.0,
  },
  baselines: { enabled: ["random", "hottest", "population"] },
};

type InterventionView = {
  kind: string;
  enabled: boolean;
  cost: number;
  multiplier: number;
};

type InterventionProfile = {
  name: string;
  budget_k: number;
  rows: Array<{ kind: string; enabled: boolean; cost: number; multiplier: number }>;
};

const PROFILE_STORAGE_KEY = "spectral-urbanism-intervention-profiles-v1";

const INTERVENTION_PRESETS: Array<{
  key: string;
  label: string;
  budget_k: number;
  rows: Array<{ kind: string; enabled: boolean; cost: number; multiplier: number }>;
}> = [
  {
    key: "balanced",
    label: "Balanced",
    budget_k: 5,
    rows: [
      { kind: "tree", enabled: true, cost: 1.0, multiplier: 1.17 },
      { kind: "cool_roof", enabled: true, cost: 1.0, multiplier: 1.15 },
      { kind: "reflective_pavement", enabled: true, cost: 0.7, multiplier: 1.18 },
      { kind: "shade_corridor", enabled: true, cost: 0.65, multiplier: 1.2 },
    ],
  },
  {
    key: "equity-shade",
    label: "Equity + Shade",
    budget_k: 6,
    rows: [
      { kind: "tree", enabled: true, cost: 0.9, multiplier: 1.18 },
      { kind: "cool_roof", enabled: true, cost: 1.0, multiplier: 1.14 },
      { kind: "reflective_pavement", enabled: true, cost: 0.85, multiplier: 1.14 },
      { kind: "shade_corridor", enabled: true, cost: 0.55, multiplier: 1.24 },
    ],
  },
  {
    key: "low-cost",
    label: "Low Cost",
    budget_k: 8,
    rows: [
      { kind: "tree", enabled: true, cost: 0.85, multiplier: 1.12 },
      { kind: "cool_roof", enabled: true, cost: 0.7, multiplier: 1.11 },
      { kind: "reflective_pavement", enabled: true, cost: 0.5, multiplier: 1.13 },
      { kind: "shade_corridor", enabled: false, cost: 1.4, multiplier: 1.16 },
    ],
  },
];

function parseJsonConfig(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getBudget(raw: string): number {
  const cfg = parseJsonConfig(raw);
  const interventions = cfg?.interventions as Record<string, unknown> | undefined;
  const budget = Number(interventions?.budget_k ?? 5);
  return Number.isFinite(budget) && budget >= 1 ? budget : 5;
}

function readInterventions(raw: string): InterventionView[] {
  const cfg = parseJsonConfig(raw);
  const interventions = cfg?.interventions as Record<string, unknown> | undefined;
  const types = Array.isArray(interventions?.types)
    ? interventions?.types.map((x) => String(x))
    : [];
  const costs = (interventions?.costs ?? {}) as Record<string, unknown>;
  const effects = (interventions?.effects ?? {}) as Record<string, Record<string, unknown>>;
  const kinds = new Set<string>([
    ...types,
    ...Object.keys(costs ?? {}),
    ...Object.keys(effects ?? {}),
  ]);

  return Array.from(kinds)
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => ({
      kind,
      enabled: types.includes(kind),
      cost: Number(costs?.[kind] ?? 1.0),
      multiplier: Number(effects?.[kind]?.edge_weight_multiplier ?? 1.0),
    }));
}

function withInterventionPatch(raw: string, patch: (curr: InterventionView[]) => InterventionView[]): string {
  const cfg = parseJsonConfig(raw);
  if (!cfg) {
    return raw;
  }
  const updated = patch(readInterventions(raw));
  const normalized = updated
    .filter((x) => x.kind.trim().length > 0)
    .map((x) => ({ ...x, kind: x.kind.trim() }));
  const enabledKinds = normalized.filter((x) => x.enabled).map((x) => x.kind);
  const costs: Record<string, number> = {};
  const effects: Record<string, { edge_weight_multiplier: number }> = {};
  for (const row of normalized) {
    costs[row.kind] = Number.isFinite(row.cost) ? row.cost : 1.0;
    effects[row.kind] = {
      edge_weight_multiplier: Number.isFinite(row.multiplier) ? row.multiplier : 1.0,
    };
  }

  const interventions = (cfg.interventions ?? {}) as Record<string, unknown>;
  cfg.interventions = {
    ...interventions,
    budget_k: Number(interventions.budget_k ?? 5),
    types: enabledKinds,
    costs,
    effects,
  };

  return JSON.stringify(cfg, null, 2);
}

function withBudget(raw: string, budget: number): string {
  const cfg = parseJsonConfig(raw);
  if (!cfg) {
    return raw;
  }
  const interventions = (cfg.interventions ?? {}) as Record<string, unknown>;
  cfg.interventions = {
    ...interventions,
    budget_k: Math.max(1, Math.floor(budget)),
  };
  return JSON.stringify(cfg, null, 2);
}

function applyProfileToConfig(raw: string, profile: InterventionProfile): string {
  let next = raw;
  next = withInterventionPatch(next, () => profile.rows.map((r) => ({ ...r })));
  next = withBudget(next, profile.budget_k);
  return next;
}

export function ConfigsPage() {
  const [result, setResult] = useState<string>("");
  const [newInterventionKind, setNewInterventionKind] = useState<string>("");
  const [newProfileName, setNewProfileName] = useState<string>("");
  const [selectedProfileName, setSelectedProfileName] = useState<string>("");
  const [profiles, setProfiles] = useState<InterventionProfile[]>([]);

  const form = useForm({
    defaultValues: {
      runName: "api_run",
      configJson: JSON.stringify(defaultConfig, null, 2),
    },
    onSubmit: async ({ value }) => {
      try {
        const parsed = JSON.parse(value.configJson);
        const validation = await validateMutation.mutateAsync(parsed);
        if (!validation.valid) {
          setResult(JSON.stringify(validation, null, 2));
          return;
        }
        const run = await runMutation.mutateAsync({ runName: value.runName, config: parsed });
        setResult(JSON.stringify(run, null, 2));
      } catch (err) {
        setResult(
          JSON.stringify(
            {
              ok: false,
              error: err instanceof Error ? err.message : "Validate + Launch Run failed",
            },
            null,
            2,
          ),
        );
      }
    },
  });

  const validateMutation = useMutation({ mutationFn: (config: object) => validateConfig(config) });
  const runMutation = useMutation({
    mutationFn: (x: { runName: string; config: object }) => createRun(x.runName, x.config),
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .filter((x) => x && typeof x === "object")
          .map((x) => x as InterventionProfile)
          .filter((x) => typeof x.name === "string");
        setProfiles(normalized);
      }
    } catch {
      setProfiles([]);
    }
  }, []);

  function persistProfiles(next: InterventionProfile[]) {
    setProfiles(next);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  }

  const canUseProfiles = useMemo(() => Boolean(parseJsonConfig(form.state.values.configJson)), [form.state.values.configJson]);

  return (
    <main className="page-stack">
      <header className="page-header-row">
        <div>
          <div className="eyebrow">Configuration Studio</div>
          <h1>Configs</h1>
          <p>Compose generic city runs, tune intervention families, validate schema, and launch jobs.</p>
        </div>
        <div className="status-card status-card-ready">
          <span className="status-card-label">Plug-and-play</span>
          <strong>{readInterventions(form.state.values.configJson).filter((row) => row.enabled).length}</strong>
          <span>enabled intervention types</span>
        </div>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="form-grid">
          <form.Field name="runName">
            {(field) => (
              <label>
                Run Name
                <input
                  className="input-full"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </label>
            )}
          </form.Field>

          <form.Field name="configJson">
            {(field) => (
              <>
                <div className="intervention-panel">
                  <div className="intervention-panel-header">
                    <strong>Intervention Tuning</strong>
                    <span>Enable kinds and tune costs/effects without hand-editing JSON.</span>
                  </div>

                  <div className="intervention-preset-row">
                    <strong>Presets</strong>
                    <div className="intervention-preset-buttons">
                      {INTERVENTION_PRESETS.map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => {
                            let next = withInterventionPatch(field.state.value, () =>
                              preset.rows.map((r) => ({ ...r })),
                            );
                            next = withBudget(next, preset.budget_k);
                            field.handleChange(next);
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="intervention-profile-row">
                    <strong>Profiles</strong>
                    <div className="intervention-profile-controls">
                      <input
                        className="input-full"
                        placeholder="profile name"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={!canUseProfiles}
                        onClick={() => {
                          const name = newProfileName.trim();
                          if (!name) {
                            return;
                          }
                          const nextProfile: InterventionProfile = {
                            name,
                            budget_k: getBudget(field.state.value),
                            rows: readInterventions(field.state.value).map((x) => ({ ...x })),
                          };
                          const existing = profiles.filter((p) => p.name !== name);
                          persistProfiles([...existing, nextProfile].sort((a, b) => a.name.localeCompare(b.name)));
                          setNewProfileName("");
                          setSelectedProfileName(name);
                        }}
                      >
                        Save Profile
                      </button>
                      <select
                        className="input-full"
                        title="Select intervention profile"
                        aria-label="Select intervention profile"
                        value={selectedProfileName}
                        onChange={(e) => setSelectedProfileName(e.target.value)}
                      >
                        <option value="">Select profile</option>
                        {profiles.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedProfileName}
                        onClick={() => {
                          const profile = profiles.find((p) => p.name === selectedProfileName);
                          if (!profile) {
                            return;
                          }
                          field.handleChange(applyProfileToConfig(field.state.value, profile));
                        }}
                      >
                        Load Profile
                      </button>
                      <button
                        type="button"
                        disabled={!selectedProfileName}
                        onClick={() => {
                          const next = profiles.filter((p) => p.name !== selectedProfileName);
                          persistProfiles(next);
                          setSelectedProfileName("");
                        }}
                      >
                        Delete Profile
                      </button>
                    </div>
                  </div>

                  {parseJsonConfig(field.state.value) ? (
                    <div className="intervention-table">
                      <div><strong>Use</strong></div>
                      <div><strong>Kind</strong></div>
                      <div><strong>Cost</strong></div>
                      <div><strong>Edge Weight Multiplier</strong></div>

                      {readInterventions(field.state.value).map((row) => (
                        <div key={row.kind} className="intervention-row-fragment">
                          <label>
                            <input
                              type="checkbox"
                              title={`Enable ${row.kind}`}
                              aria-label={`Enable ${row.kind}`}
                              checked={row.enabled}
                              onChange={(e) => {
                                field.handleChange(
                                  withInterventionPatch(field.state.value, (curr) =>
                                    curr.map((x) =>
                                      x.kind === row.kind ? { ...x, enabled: e.target.checked } : x,
                                    ),
                                  ),
                                );
                              }}
                            />
                          </label>

                          <div className="intervention-kind">{row.kind}</div>

                          <input
                            type="number"
                            title={`${row.kind} cost`}
                            aria-label={`${row.kind} cost`}
                            step="0.05"
                            min="0"
                            value={Number.isFinite(row.cost) ? row.cost : 1.0}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              field.handleChange(
                                withInterventionPatch(field.state.value, (curr) =>
                                  curr.map((x) =>
                                    x.kind === row.kind ? { ...x, cost: Number.isFinite(next) ? next : x.cost } : x,
                                  ),
                                ),
                              );
                            }}
                          />

                          <input
                            type="number"
                            title={`${row.kind} edge weight multiplier`}
                            aria-label={`${row.kind} edge weight multiplier`}
                            step="0.01"
                            min="0.01"
                            value={Number.isFinite(row.multiplier) ? row.multiplier : 1.0}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              field.handleChange(
                                withInterventionPatch(field.state.value, (curr) =>
                                  curr.map((x) =>
                                    x.kind === row.kind
                                      ? { ...x, multiplier: Number.isFinite(next) ? next : x.multiplier }
                                      : x,
                                  ),
                                ),
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>Config JSON is invalid. Fix JSON to enable intervention tuning UI.</div>
                  )}

                  <div className="intervention-add-row">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      title="intervention budget"
                      aria-label="intervention budget"
                      value={getBudget(field.state.value)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (Number.isFinite(next)) {
                          field.handleChange(withBudget(field.state.value, next));
                        }
                      }}
                    />
                    <input
                      className="input-full"
                      placeholder="new_intervention_kind"
                      value={newInterventionKind}
                      onChange={(e) => setNewInterventionKind(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = newInterventionKind.trim();
                        if (!trimmed) {
                          return;
                        }
                        field.handleChange(
                          withInterventionPatch(field.state.value, (curr) => {
                            if (curr.some((x) => x.kind === trimmed)) {
                              return curr;
                            }
                            return [
                              ...curr,
                              { kind: trimmed, enabled: true, cost: 1.0, multiplier: 1.05 },
                            ];
                          }),
                        );
                        setNewInterventionKind("");
                      }}
                    >
                      Add Intervention Type
                    </button>
                  </div>
                </div>

                <label>
                  Config JSON
                  <textarea
                    className="textarea-config"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              </>
            )}
          </form.Field>

          <button type="submit" disabled={runMutation.isPending || validateMutation.isPending}>
            Validate + Launch Run
          </button>
        </div>
      </form>

      {result && (
        <section className="content-panel">
          <h2>Launch Result</h2>
          <pre className="code-block code-block-top-gap">{result}</pre>
        </section>
      )}
    </main>
  );
}
