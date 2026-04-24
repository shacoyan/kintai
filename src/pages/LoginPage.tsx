import React from 'react';
import { Navigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { LoginForm } from '../components/Auth/LoginForm';
import { useAuth } from '../hooks/useAuth';

export const LoginPage: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 px-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 px-4 py-10 gap-6">
      <div className="text-center">
        <Clock className="w-12 h-12 text-blue-600 dark:text-blue-400 mx-auto mb-2" />
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">kintai</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">シフトも、打刻も、一つに。</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">勤怠・給与・シフト希望をワンストップで。</p>
      </div>
      <LoginForm />
    </div>
  );
};
