import { Suspense, lazy } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { PublicLayout } from "@/layouts/PublicLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { RequireRole } from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Landing } from "@/pages/Landing";
import { Connect } from "@/pages/Connect";

const Register = lazy(() => import("@/pages/Register").then((m) => ({ default: m.Register })));
const FarmerDashboard = lazy(() => import("@/pages/FarmerDashboard").then((m) => ({ default: m.FarmerDashboard })));
const RegisterBatch = lazy(() => import("@/pages/RegisterBatch").then((m) => ({ default: m.RegisterBatch })));
const Batches = lazy(() => import("@/pages/Batches").then((m) => ({ default: m.Batches })));
const BatchDetails = lazy(() => import("@/pages/BatchDetails").then((m) => ({ default: m.BatchDetails })));
const Dashboards = () => import("@/pages/ParticipantDashboards");
const DistributorDashboard = lazy(() => Dashboards().then((m) => ({ default: m.DistributorDashboard })));
const WarehouseDashboard = lazy(() => Dashboards().then((m) => ({ default: m.WarehouseDashboard })));
const RetailerDashboard = lazy(() => Dashboards().then((m) => ({ default: m.RetailerDashboard })));
const Trace = lazy(() => import("@/pages/Trace").then((m) => ({ default: m.Trace })));
const Scan = lazy(() => import("@/pages/Scan").then((m) => ({ default: m.Scan })));
const Transactions = lazy(() => import("@/pages/Transactions").then((m) => ({ default: m.Transactions })));
const Admin = lazy(() => import("@/pages/Admin").then((m) => ({ default: m.Admin })));
const Payments = lazy(() => import("@/pages/Payments").then((m) => ({ default: m.Payments })));

const Loading = () => (
  <div className="container space-y-4 py-10">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-64" />
  </div>
);

function NotFound() {
  return (
    <div className="container py-24 text-center">
      <p className="text-sm font-semibold text-secondary">404</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-2 text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Button asChild className="mt-6"><Link to="/">Back home</Link></Button>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Landing />} />
          <Route path="connect" element={<Connect />} />
          <Route path="trace/:batchId" element={<Trace />} />
          <Route path="scan" element={<Scan />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route element={<DashboardLayout />}>
          <Route path="register" element={<Register />} />
          <Route path="dashboard/farmer" element={<RequireRole roles={["Farmer"]}><FarmerDashboard /></RequireRole>} />
          <Route path="dashboard/distributor" element={<RequireRole roles={["Distributor"]}><DistributorDashboard /></RequireRole>} />
          <Route path="dashboard/warehouse" element={<RequireRole roles={["Warehouse"]}><WarehouseDashboard /></RequireRole>} />
          <Route path="dashboard/retailer" element={<RequireRole roles={["Retailer"]}><RetailerDashboard /></RequireRole>} />
          <Route path="batches" element={<RequireRole roles={["Farmer"]}><Batches /></RequireRole>} />
          <Route path="batches/new" element={<RequireRole roles={["Farmer"]}><RegisterBatch /></RequireRole>} />
          <Route path="batches/:id" element={<BatchDetails />} />
          <Route path="payments" element={<RequireRole><Payments /></RequireRole>} />
          <Route path="admin" element={<RequireRole admin><Admin /></RequireRole>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
