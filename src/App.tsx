// FILE: App.tsx
import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { StoreProvider } from './contexts/StoreContext';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { RequireTenant } from './components/Auth/RequireTenant';
import { Layout } from './components/Layout/Layout';
import { LoginPage } from './pages/LoginPage';
import TenantPage from './pages/TenantPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';

const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const ShiftPage = lazy(() => import('./pages/ShiftPage').then(m => ({ default: m.ShiftPage })));

const App: React.FC = () => {
  return (
    <AuthProvider>
      <TenantProvider>
        <StoreProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/tenant"
            element={
              <ProtectedRoute>
                <TenantPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RequireTenant>
                  <Layout>
                    <DashboardPage />
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
                    <HistoryPage />
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
                    <Suspense fallback={<div className="flex justify-center items-center h-screen"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
                      <ShiftPage />
                    </Suspense>
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
                    <Suspense fallback={<div className="flex justify-center items-center h-screen"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>}>
                      <AdminPage />
                    </Suspense>
                  </Layout>
                </RequireTenant>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </StoreProvider>
      </TenantProvider>
    </AuthProvider>
  );
};

export default App;
