import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import type { RoleCode } from './services/types';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import { EmptyState, LoadingBlock } from './components/ui';

// Route-level code splitting keeps the first load small.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ResourcesPage = lazy(() => import('./pages/ResourcesPage'));
const ResourceDetailPage = lazy(() => import('./pages/ResourceDetailPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const NewBookingPage = lazy(() => import('./pages/NewBookingPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const BookingDetailPage = lazy(() => import('./pages/BookingDetailPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const AdminResourcesPage = lazy(() => import('./pages/AdminResourcesPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-7 animate-spin text-lagoon" aria-label="Loading" /></div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: RoleCode[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) {
    return (
      <div className="glass"><EmptyState title="You don't have access to this page" action={<Link to="/" className="font-semibold text-lagoon hover:underline">Go to overview</Link>}>
        Ask an administrator if you need this permission.
      </EmptyState></div>
    );
  }
  return <>{children}</>;
}

const STAFF: RoleCode[] = ['FACULTY', 'COORDINATOR', 'ADMIN'];
const APPROVERS: RoleCode[] = ['COORDINATOR', 'ADMIN'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="*" element={
          <Suspense fallback={<LoadingBlock rows={6} />}>
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="resources/:id" element={<ResourceDetailPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="book" element={<NewBookingPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="bookings/:id" element={<BookingDetailPage />} />
              <Route path="approvals" element={<RequireRole roles={APPROVERS}><ApprovalsPage /></RequireRole>} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route path="analytics" element={<RequireRole roles={STAFF}><AnalyticsPage /></RequireRole>} />
              <Route path="admin/resources" element={<RequireRole roles={['ADMIN']}><AdminResourcesPage /></RequireRole>} />
              <Route path="admin/users" element={<RequireRole roles={['ADMIN']}><UsersPage /></RequireRole>} />
              <Route path="audit" element={<RequireRole roles={APPROVERS}><AuditPage /></RequireRole>} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={
                <div className="glass"><EmptyState title="Page not found" action={<Link to="/" className="font-semibold text-lagoon hover:underline">Go to overview</Link>}>
                  The address may be mistyped or the page may have moved.
                </EmptyState></div>
              } />
            </Routes>
          </Suspense>
        } />
      </Route>
    </Routes>
  );
}
