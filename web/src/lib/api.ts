const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api/v1";

async function readApiError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return new Error(`${fallback}: ${detail}`);
    }
    if (Array.isArray(detail)) {
      return new Error(`${fallback}: ${detail.map((item) => item?.msg ?? JSON.stringify(item)).join("; ")}`);
    }
    return new Error(`${fallback}: ${JSON.stringify(body)}`);
  } catch {
    return new Error(`${fallback}: HTTP ${res.status}`);
  }
}

export type ThermalSourceName = "landsat" | "ecostress" | "realtime";

export type ThermalSourcesResponse = {
  available_sources: ThermalSourceName[];
  sources: Record<string, Record<string, unknown>>;
  note?: string;
};

export type SetThermalSourceResponse = {
  status: string;
  thermal_source: ThermalSourceName;
  timestamp: string;
};

export async function getHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("health request failed");
  return res.json();
}

export async function validateConfig(config: object) {
  const res = await fetch(`${API_BASE}/configs/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) throw await readApiError(res, "validation failed");
  return res.json();
}

export async function createRun(runName: string, config: object) {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_name: runName, config }),
  });
  if (!res.ok) throw await readApiError(res, "run creation failed");
  return res.json();
}

export async function listRuns(params?: {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
  sort_by?: string | string[];
  sort_dir?: "asc" | "desc" | Array<"asc" | "desc">;
}) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (typeof params?.limit === "number") sp.set("limit", String(params.limit));
  if (typeof params?.offset === "number") sp.set("offset", String(params.offset));
  if (params?.sort_by) {
    sp.set("sort_by", Array.isArray(params.sort_by) ? params.sort_by.join(",") : params.sort_by);
  }
  if (params?.sort_dir) {
    sp.set("sort_dir", Array.isArray(params.sort_dir) ? params.sort_dir.join(",") : params.sort_dir);
  }
  const query = sp.toString();
  const url = query ? `${API_BASE}/runs?${query}` : `${API_BASE}/runs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("run list failed");
  return res.json();
}

export async function getRun(runId: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}`);
  if (!res.ok) throw new Error("run lookup failed");
  return res.json();
}

export async function getRunArtifacts(runId: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}/artifacts`);
  if (!res.ok) throw new Error("artifact lookup failed");
  return res.json();
}

export async function getRunLogs(runId: string, tail = 200) {
  const res = await fetch(`${API_BASE}/runs/${runId}/logs?tail=${tail}`);
  if (!res.ok) throw new Error("run logs lookup failed");
  return res.json();
}

export async function getRunMap(runId: string, source?: Exclude<ThermalSourceName, "realtime">) {
  const query = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await fetch(`${API_BASE}/runs/${runId}/map${query}`);
  if (!res.ok) throw new Error("map lookup failed");
  return res.json();
}

export async function getThermalSources(): Promise<ThermalSourcesResponse> {
  const res = await fetch(`${API_BASE}/thermal-sources`);
  if (!res.ok) throw new Error("thermal sources lookup failed");
  return res.json();
}

export async function setThermalSource(source: ThermalSourceName): Promise<SetThermalSourceResponse> {
  const res = await fetch(`${API_BASE}/thermal-sources/set?source=${encodeURIComponent(source)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("failed to switch thermal source");
  return res.json();
}
