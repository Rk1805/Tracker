import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import firebaseService from '../services/firebase';
import { AppUser, UserRole } from '../types';
import { customerAuthService } from '../services/customerAuth';

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  isReady: boolean;
  role: UserRole | null;
  loginWithPhone: (normalizedPhone: string) => Promise<'logged_in' | 'new_user'>;
  registerWithPhone: (normalizedPhone: string, displayName: string, role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  customerLogin: (phoneNumber: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | undefined;

    const unsubscribeAuth = firebaseService.onAuthChanged(async (firebaseUser) => {
      setUser(firebaseUser);

      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = undefined;
      }

      if (!firebaseUser) {
        setAppUser(null);
        setIsReady(true);
        return;
      }

      setIsReady(false);

      unsubscribeDoc = onSnapshot(
        doc(firebaseService.firestore, 'users', firebaseUser.uid),
        (snapshot) => {
          if (snapshot.exists()) {
            setAppUser(snapshot.data() as AppUser);
          } else {
            setAppUser(null);
          }
          setIsReady(true);
        },
        (error) => {
          console.error(error);
          setIsReady(true);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, []);

  const loginWithPhone = async (normalizedPhone: string) => {
    return firebaseService.loginWithPhone(normalizedPhone);
  };

  const registerWithPhone = async (normalizedPhone: string, displayName: string, role: UserRole) => {
    await firebaseService.registerWithPhone(normalizedPhone, displayName, role);
  };

  const logout = async () => {
    await firebaseService.logout();
    setAppUser(null);
  };

  const customerLogin = async (phoneNumber: string) => {
    await customerAuthService.loginWithPhoneNumber(phoneNumber);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        appUser,
        isReady,
        role: appUser?.role || null,
        loginWithPhone,
        registerWithPhone,
        logout,
        customerLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
