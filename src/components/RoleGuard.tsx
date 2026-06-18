import { ReactNode, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import LoadingScreen from './LoadingScreen';

export default function RoleGuard({
  role,
  children,
}: {
  role: UserRole;
  children: ReactNode;
}) {
  const { user, appUser, isReady } = useAuth();
  const router = useRouter();
  const isAllowed = Boolean(user && appUser?.role === role && appUser.isActive !== false);

  useEffect(() => {
    if (!isReady || isAllowed) return;
    router.replace(user ? '/' : role === 'customer' ? '/auth/customer-login' : '/auth/login');
  }, [isAllowed, isReady, role, router, user]);

  if (!isReady || !isAllowed) {
    return <LoadingScreen message="Checking access..." />;
  }

  return children;
}
