import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import LoadingScreen from '../src/components/LoadingScreen';

/**
 * This is the first screen Expo Router loads.
 *
 * We wait for auth + Firestore role to be ready, then redirect:
 *
 *   NOT LOGGED IN  ->  /auth/login
 *   LOGGED IN      ->  /(admin) | /(driver) | /(salesman)
 *
 * isReady ensures we NEVER redirect before the role is known,
 * which fixes the "stuck on login" race condition.
 */
export default function IndexRedirectGate() {
  const { user, appUser, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isReady) return;

    console.log('REDIRECT GATE: ready, user=', !!user, 'role=', appUser?.role);

    if (!user) {
      // Not logged in → show login screen
      router.replace('/auth/login');
      return;
    }

    // Logged in – navigate based on role
    const role = appUser?.role;

    if (role === 'admin') {
      router.replace('/(admin)');
    } else if (role === 'driver') {
      router.replace('/(driver)');
    } else if (role === 'salesman') {
      router.replace('/(salesman)');
    } else {
      // Role not available yet (shouldn't happen since isReady is true,
      // but as a safety net go to login)
      console.warn('No role found, redirecting to login');
      router.replace('/auth/login');
    }
  }, [isReady, user, appUser]);

  // Show a loading indicator until isReady becomes true
  return <LoadingScreen message="Loading..." />;
}