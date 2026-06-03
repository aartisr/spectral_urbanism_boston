import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { listRuns } from "../lib/api";
import {
  normalizeRunsSearch,
  SORT_KEYS,
  SortDir,
  SortKey,
} from "./runs-search";

type RunRecord = {
  run_id: string;
  run_name?: string;
  status?: string;
  created_at?: string;
  execution_backend?: string;
  job_mode?: string;
};

type SecondarySort = SortKey | "none";

export function RunsPage() {
  const search = useSearch({ from: "/runs" });
  const navigate = useNavigate({ from: "/runs" });

  const statusFilter = search.status;
  const queryText = search.q;
  const limit = search.limit;
  const offset = search.offset;
  const sortBy = search.sort_by[0] ?? "created_at";
  const sortDir = search.sort_dir[0] ?? "desc";
  const sortSecondary = (search.sort_by[1] ?? "none") as SecondarySort;
  const sortSecondaryDir = search.sort_dir[1] ?? sortDir;

  function patchSearch(nextValues: Record<string, unknown>) {
    navigate({
      to: "/runs",
      replace: true,
      search: (prev) => normalizeRunsSearch({ ...prev, ...nextValues }),
    });
  }

  function toggleSort(next: SortKey) {
    if (sortBy === next) {
      patchSearch({ sort_dir: [sortDir === "asc" ? "desc" : "asc", sortSecondaryDir], offset: 0 });
    } else {
      const secondary = sortSecondary !== "none" && sortSecondary !== next ? sortSecondary : undefined;
      const secondaryDir = sortSecondaryDir;
      patchSearch({
        sort_by: secondary ? [next, secondary] : [next],
        sort_dir: secondary ? ["asc", secondaryDir] : ["asc"],
        offset: 0,
      });
    }
  }

  const queryParams = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      q: queryText.trim() ? queryText.trim() : undefined,
      limit,
      offset,
      sort_by: sortSecondary === "none" ? [sortBy] : [sortBy, sortSecondary],
      sort_dir: sortSecondary === "none" ? [sortDir] : [sortDir, sortSecondaryDir],
    }),
    [statusFilter, queryText, limit, offset, sortBy, sortDir, sortSecondary, sortSecondaryDir],
  );

  const columns: ColumnDef<RunRecord>[] = useMemo(
    () => [
      {
        accessorKey: "run_id",
        header: () => (
          <button className="sort-btn" onClick={() => toggleSort("run_id")}>
            Run ID {sortBy === "run_id" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </button>
        ),
        cell: ({ row }) => (
          <Link to="/runs/$runId" params={{ runId: row.original.run_id }}>
            {row.original.run_id}
          </Link>
        ),
      },
      {
        accessorKey: "run_name",
        header: () => (
          <button className="sort-btn" onClick={() => toggleSort("run_name")}>
            Name {sortBy === "run_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </button>
        ),
      },
      {
        accessorKey: "status",
        header: () => (
          <button className="sort-btn" onClick={() => toggleSort("status")}>
            Status {sortBy === "status" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </button>
        ),
      },
      {
        accessorKey: "execution_backend",
        header: () => (
          <button className="sort-btn" onClick={() => toggleSort("execution_backend")}>
            Backend {sortBy === "execution_backend" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </button>
        ),
        cell: ({ row }) => row.original.execution_backend ?? row.original.job_mode ?? "unknown",
      },
      {
        accessorKey: "created_at",
        header: () => (
          <button className="sort-btn" onClick={() => toggleSort("created_at")}>
            Created {sortBy === "created_at" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </button>
        ),
      },
      {
        id: "logs",
        header: "Logs",
        cell: ({ row }) => (
          <a href={`/runs/${row.original.run_id}#live-logs`}>View Logs</a>
        ),
      },
    ],
    [sortBy, sortDir],
  );

  const runsQuery = useQuery({
    queryKey: ["runs", queryParams],
    queryFn: () => listRuns(queryParams),
    refetchInterval: 2500,
  });

  const runs = (runsQuery.data?.runs ?? []) as RunRecord[];
  const total = Number(runsQuery.data?.total ?? 0);
  const hasNext = Boolean(runsQuery.data?.has_next);
  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  const active = runs.filter((run) => ["queued", "running"].includes(String(run.status))).length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const table = useReactTable({ data: runs, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <main className="page-stack">
      <header className="page-header-row">
        <div>
          <div className="eyebrow">Execution Registry</div>
          <h1>Runs</h1>
          <p>Launch, filter, and inspect reproducible city optimization runs. The table refreshes automatically.</p>
        </div>
        <Link className="primary-link-button" to="/configs">New Run</Link>
      </header>

      <section className="metric-strip">
        <div className="metric-card"><span>Total</span><strong>{total}</strong></div>
        <div className="metric-card"><span>Visible succeeded</span><strong>{succeeded}</strong></div>
        <div className="metric-card"><span>Visible active</span><strong>{active}</strong></div>
        <div className="metric-card"><span>Visible failed</span><strong>{failed}</strong></div>
      </section>

      <section className="content-panel">
      <div className="runs-controls">
        <label>
          Status
          <select
            className="input-full"
            value={statusFilter}
            onChange={(e) => {
              patchSearch({ status: e.target.value, offset: 0 });
            }}
          >
            <option value="all">all</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
          </select>
        </label>

        <label>
          Search
          <input
            className="input-full"
            value={queryText}
            onChange={(e) => {
              patchSearch({ q: e.target.value, offset: 0 });
            }}
            placeholder="run id or run name"
          />
        </label>

        <label>
          Page Size
          <select
            className="input-full"
            value={String(limit)}
            onChange={(e) => {
              patchSearch({ limit: Number(e.target.value), offset: 0 });
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </label>

        <label>
          Primary Direction
          <select
            className="input-full"
            value={sortDir}
            onChange={(e) => {
              const nextDir = e.target.value as SortDir;
              patchSearch({
                sort_dir: sortSecondary === "none" ? [nextDir] : [nextDir, sortSecondaryDir],
                offset: 0,
              });
            }}
          >
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>

        <label>
          Secondary Sort
          <select
            className="input-full"
            value={sortSecondary}
            onChange={(e) => {
              const nextSecondary = e.target.value as SecondarySort;
              if (nextSecondary === "none") {
                patchSearch({ sort_by: [sortBy], sort_dir: [sortDir], offset: 0 });
                return;
              }

              patchSearch({
                sort_by: [sortBy, nextSecondary],
                sort_dir: [sortDir, sortSecondaryDir],
                offset: 0,
              });
            }}
          >
            <option value="none">none</option>
            {SORT_KEYS.filter((k) => k !== sortBy).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        <label>
          Secondary Direction
          <select
            className="input-full"
            value={sortSecondaryDir}
            disabled={sortSecondary === "none"}
            onChange={(e) => {
              const nextDir = e.target.value as SortDir;
              if (sortSecondary === "none") {
                return;
              }
              patchSearch({ sort_dir: [sortDir, nextDir], offset: 0 });
            }}
          >
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>
      </div>
      {runsQuery.isLoading && <p>Loading runs...</p>}

      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pager-row">
        <button
          onClick={() => patchSearch({ offset: Math.max(0, offset - limit) })}
          disabled={offset === 0}
        >
          Previous
        </button>
        <span>
          Showing {Math.min(offset + 1, total)}-{Math.min(offset + runs.length, total)} of {total}
        </span>
        <button onClick={() => patchSearch({ offset: offset + limit })} disabled={!hasNext}>
          Next
        </button>
      </div>
      </section>
    </main>
  );
}
