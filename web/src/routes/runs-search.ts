export type SortKey = "created_at" | "status" | "run_name" | "run_id" | "execution_backend";
export type SortDir = "asc" | "desc";

export type RunsSearch = {
  status: string;
  q: string;
  limit: number;
  offset: number;
  sort_by: SortKey[];
  sort_dir: SortDir[];
};

export const SORT_KEYS: SortKey[] = [
  "created_at",
  "status",
  "run_name",
  "run_id",
  "execution_backend",
];

function parseCsv(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .flatMap((x) => String(x).split(","))
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeRunsSearch(search: Record<string, unknown>): RunsSearch {
  const statusRaw = String(search.status ?? "all");
  const qRaw = String(search.q ?? "");

  const limitRaw = Number(search.limit ?? 20);
  const offsetRaw = Number(search.offset ?? 0);

  const sortKeysRaw = parseCsv(search.sort_by);
  const sortDirsRaw = parseCsv(search.sort_dir);

  const sortBy = sortKeysRaw.filter((x): x is SortKey => SORT_KEYS.includes(x as SortKey));
  const sortDir = sortDirsRaw.filter((x): x is SortDir => x === "asc" || x === "desc");

  const primarySort = sortBy[0] ?? "created_at";
  const primaryDir = sortDir[0] ?? "desc";

  const secondarySort = sortBy[1];
  const secondaryDir = sortDir[1] ?? primaryDir;

  const finalSortBy: SortKey[] = secondarySort ? [primarySort, secondarySort] : [primarySort];
  const finalSortDir: SortDir[] = secondarySort ? [primaryDir, secondaryDir] : [primaryDir];

  return {
    status: statusRaw,
    q: qRaw,
    limit: [10, 20, 50].includes(limitRaw) ? limitRaw : 20,
    offset: Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0,
    sort_by: finalSortBy,
    sort_dir: finalSortDir,
  };
}
