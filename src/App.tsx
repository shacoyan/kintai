// FILE: App.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { StoreProvider } from './contexts/StoreContext';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { RequireTenant } from './components/Auth/RequireTenant';
import { Layout } from './components/Layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { JoinPage } from './pages/JoinPage';
import { DashboardPage } from './pages/DashboardPage';
import { ErrorBoundary, PageLoader } from './components/ui';
import { lazyWithRetry } from './lib/lazyWithRetry';

const TenantPage = lazyWithRetry(() => import('./pages/TenantPage').then(m => ({ default: m.default })));
const HistoryPage = lazyWithRetry(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const AdminPage = lazyWithRetry(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const ShiftPage = lazyWithRetry(() => import('./pages/ShiftPage').then(m => ({ default: m.ShiftPage })));
const TasksPage = lazyWithRetry(() => import('./pages/TasksPage').then(m => ({ default: m.default })));
const ProjectsPage = lazyWithRetry(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const SalesPage = lazyWithRetry(() => import('./pages/SalesPage').then(m => ({ default: m.SalesPage })));
const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));

const App: React.FC = () => {
  return (
    <AuthProvider>
      <TenantProvider>
        <StoreProvider>
        <ErrorBoundary scope="app">
          <Routes>
            <Route
              path="/login"
              element={
                <ErrorBoundary scope="route">
                  <LoginPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/reset-password"
              element={
                <ErrorBoundary scope="route">
                  <ResetPasswordPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/join"
              element={
                <ErrorBoundary scope="route">
                  <JoinPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/tenant"
              element={
                <ProtectedRoute>
                  <ErrorBoundary scope="route">
                    <Suspense fallback={<PageLoader variant="screen" />}>
                      <TenantPage />
                    </Suspense>
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <DashboardPage />
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <HistoryPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/shift"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <ShiftPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <AdminPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tasks"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <TasksPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <ProjectsPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/sales"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <SalesPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <RequireTenant>
                    <Layout>
                      <ErrorBoundary scope="route">
                        <Suspense fallback={<PageLoader variant="screen" />}>
                          <ReportsPage />
                        </Suspense>
                      </ErrorBoundary>
                    </Layout>
                  </RequireTenant>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
        </StoreProvider>
      </TenantProvider>
    </AuthProvider>
  );
};

export default App;
