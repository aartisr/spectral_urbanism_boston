import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api";

export function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  return (
    <div>
      <h2>System Status</h2>
      {health.isLoading && <p>Checking API health...</p>}
      {health.error && <p>API unavailable.</p>}
      {health.data && (
        <pre style={{ background: "#f6f6f6", padding: 12 }}>{JSON.stringify(health.data, null, 2)}</pre>
      )}
    </div>
  );
}
