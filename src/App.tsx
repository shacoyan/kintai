// FILE: App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { RequireTenant } from './components/Auth/RequireTenant';
import { Layout } from './components/Layout/Layout';
import { LoginPage } from './pages/LoginPage';
import TenantPage from './pages/TenantPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { AdminPage } from './pages/AdminPage';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <TenantProvider>
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
            path="/admin"
            element={
              <ProtectedRoute>
                <RequireTenant>
                  <Layout>
                    <AdminPage />
                  </Layout>
                </RequireTenant>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TenantProvider>
    </AuthProvider>
  );
};

export default App;
