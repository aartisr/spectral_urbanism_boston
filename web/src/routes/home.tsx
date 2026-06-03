import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getHealth } from "../lib/api";

export function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const status = health.isLoading ? "Checking" : health.error ? "Unavailable" : "Operational";

  return (
    <main className="page-stack">
      <header className="page-hero">
        <div>
          <div className="eyebrow">Urban Climate Intelligence</div>
          <h1>Operate a generic heat-mitigation pipeline from city data to street action.</h1>
          <p>
            Validate inputs, launch reproducible runs, inspect artifacts, and turn spectral diagnostics into
            map-ready interventions without city-specific code paths.
          </p>
        </div>
        <div className={`status-card ${health.error ? "status-card-error" : "status-card-ready"}`}>
          <span className="status-card-label">API Status</span>
          <strong>{status}</strong>
          {health.data?.execution_mode && <span>{String(health.data.execution_mode)} execution</span>}
        </div>
      </header>

      <section className="quick-action-grid">
        <Link className="quick-action-card" to="/map">
          <strong>Open Intervention Map</strong>
          <span>Explore heat corridors, Cheeger bottlenecks, cooling resistance, and address-level plans.</span>
        </Link>
        <Link className="quick-action-card" to="/runs" search={{ status: "succeeded", q: "", limit: 20, offset: 0, sort_by: ["created_at"], sort_dir: ["desc"] }}>
          <strong>Review Runs</strong>
          <span>Track run state, logs, artifacts, and reproducibility metadata.</span>
        </Link>
        <Link className="quick-action-card" to="/configs">
          <strong>Create a Run</strong>
          <span>Use plug-and-play configuration controls for cities, features, objectives, and interventions.</span>
        </Link>
      </section>

      <section className="panel-grid">
        <article className="info-panel">
          <h2>Workflow</h2>
          <ol className="clean-list">
            <li>Configure a city, grid, data catalog, and intervention palette.</li>
            <li>Run the thermal graph, GMRF, spectral, resilience, and equity objectives.</li>
            <li>Inspect Cheeger and cooling-access layers on the map.</li>
            <li>Search an address and translate model signals into street-level mitigation.</li>
          </ol>
        </article>
        <article className="info-panel">
          <h2>Health Detail</h2>
          {health.isLoading && <p>Checking API health...</p>}
          {health.error && <p>API unavailable. Start the API service and refresh this page.</p>}
          {health.data && <pre className="code-block compact-code">{JSON.stringify(health.data, null, 2)}</pre>}
        </article>
      </section>
    </main>
  );
}
