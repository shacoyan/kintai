import { useAuth as useAuthContext } from '../contexts/AuthContext';

// シンプルなラッパーとしてre-export
export const useAuth = () => {
  return useAuthContext();
};
