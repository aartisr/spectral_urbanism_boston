import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { getRun, getRunArtifacts, getRunLogs } from "../lib/api";

type Artifact = { name: string; path: string; size_bytes: number };
type RunLogsResponse = {
  run_id: string;
  available: boolean;
  updated_at: string | null;
  lines: string[];
};

const columns: ColumnDef<Artifact>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "path", header: "Path" },
  { accessorKey: "size_bytes", header: "Size (bytes)" },
];

export function RunDetailPage() {
  const { runId } = useParams({ from: "/runs/$runId" });

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    refetchInterval: 2500,
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", runId],
    queryFn: () => getRunArtifacts(runId),
    refetchInterval: 2500,
  });

  const logsQuery = useQuery<RunLogsResponse>({
    queryKey: ["run-logs", runId],
    queryFn: () => getRunLogs(runId, 400),
    refetchInterval: 2000,
  });

  const artifacts = (artifactsQuery.data?.artifacts ?? []) as Artifact[];
  const table = useReactTable({ data: artifacts, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div>
      <h2>Run Detail</h2>
      <p>Run ID: {runId}</p>
      {runQuery.isLoading && <p>Loading run...</p>}
      {runQuery.data && (
        <pre className="code-block">{JSON.stringify(runQuery.data, null, 2)}</pre>
      )}

      <h3 id="live-logs">Live Logs</h3>
      {logsQuery.isLoading && <p>Loading logs...</p>}
      {logsQuery.data && !logsQuery.data.available && <p>No logs yet for this run.</p>}
      {logsQuery.data?.available && (
        <pre className="code-block run-logs-block">
          {logsQuery.data.lines.join("\n") || "(empty log)"}
        </pre>
      )}
      {logsQuery.error && <p>Failed to load logs.</p>}

      <h3>Artifacts</h3>
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
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
