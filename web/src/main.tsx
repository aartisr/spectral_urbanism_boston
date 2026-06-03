import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  Link,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { HomePage } from "./routes/home";
import { RunsPage } from "./routes/runs";
import { RunDetailPage } from "./routes/run-detail";
import { ConfigsPage } from "./routes/configs";
import { normalizeRunsSearch } from "./routes/runs-search";
import "./styles.css";

const queryClient = new QueryClient();
const MapPage = React.lazy(() => import("./routes/map").then((module) => ({ default: module.MapPage })));

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="panel">
          <h2>Something went wrong</h2>
          <p>{this.state.error.message}</p>
        </main>
      );
    }

    return this.props.children;
  }
}

function RootLayout() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <Link to="/" className="app-brand" aria-label="Spectral Urbanism home">
          <span className="app-brand-mark">SU</span>
          <span>
            <span className="app-brand-title">Spectral Urbanism</span>
            <span className="app-brand-subtitle">City intervention workbench</span>
          </span>
        </Link>
        <nav className="app-nav">
          <Link to="/">Overview</Link>
          <Link to="/map">Map</Link>
          <Link to="/runs" search={normalizeRunsSearch({})}>Runs</Link>
          <Link to="/configs">Configs</Link>
        </nav>
        <div className="app-sidebar-note">
          Generic pipelines, explainable artifacts, and street-level mitigation in one workspace.
        </div>
      </aside>
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  validateSearch: (search) => normalizeRunsSearch(search),
  component: RunsPage,
});
const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: RunDetailPage,
});
const configsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/configs",
  component: ConfigsPage,
});
const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  component: () => (
    <Suspense fallback={<main className="panel">Loading map...</main>}>
      <MapPage />
    </Suspense>
  ),
});

const routeTree = rootRoute.addChildren([indexRoute, runsRoute, runDetailRoute, configsRoute, mapRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
