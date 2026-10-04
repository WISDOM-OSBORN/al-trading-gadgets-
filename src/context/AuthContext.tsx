import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Shop, UserRole } from '../types';
import { db, initializeDatabase, syncUsersFromFirestore } from '../db';
import {
  signInWithGooglePopup,
  authenticateRegisteredUser,
  authenticateWorkerWithEmailAndPin,
  signOutFirebase,
} from '../db/firebase';
import { verifyPin } from '../utils/crypto';

interface AuthContextType {
  currentUser: User | null;
  currentShop: Shop | null;
  isLoading: boolean;
  isLocked: boolean;
  login: (email: string, role?: UserRole) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  loginWithGmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  loginWithEmailAndPin: (email: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  lockScreen: () => void;
  logout: () => void;
  switchUser: (uid: string) => Promise<void>;
  updateShopSettings: (settings: Partial<Shop['settings']>) => Promise<void>;
  updateShopDetails: (details: Partial<Shop>) => Promise<void>;
  refreshShop: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentShop, setCurrentShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Initialize DB and authenticate active user session
  useEffect(() => {
    async function loadAuth() {
      try {
        await initializeDatabase();
        const shop = await db.shops.toCollection().first();
        if (shop) {
          setCurrentShop(shop);
        }

        let user: User | undefined;
        const savedUid = localStorage.getItem('shopledger_active_uid');
        if (savedUid) {
          const candidate = await db.users.get(savedUid);
          // Strictly verify the candidate account is still ACTIVE
          if (candidate && candidate.active === true) {
            user = candidate;
          } else {
            localStorage.removeItem('shopledger_active_uid');
          }
        }

        // Only authenticate if a valid active session is saved. NEVER auto-login as owner on refresh!
        if (user && user.active === true) {
          setCurrentUser(user);
        } else {
          setCurrentUser(null);
        }

        // Instant UI unlock: Render local data immediately (<20ms)
        setIsLoading(false);

        // Sync remote user list in background without blocking screen render
        syncUsersFromFirestore().catch(() => {});
      } catch (err) {
        console.error('Failed to initialize auth:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, []);

  // Idle lock timer (10 minutes of inactivity)
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;

    const resetIdleTimer = () => {
      if (isLocked) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (currentUser) {
          setIsLocked(true);
        }
      }, 10 * 60 * 1000);
    };

    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);

    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('touchstart', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [currentUser, isLocked]);

  // Sign in with Google / Gmail popup
  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const authRes = await signInWithGooglePopup();
      if (!authRes.success || !authRes.user) {
        return { success: false, error: authRes.error || 'Google login denied.' };
      }

      await db.users.put(authRes.user);
      setCurrentUser(authRes.user);
      localStorage.setItem('shopledger_active_uid', authRes.user.uid);
      setIsLocked(false);
      return { success: true };
    } catch (err: any) {
      console.warn('Google sign-in popup issue:', err);
      return { success: false, error: err?.message || 'Google sign-in popup issue.' };
    }
  };

  // Sign in or authenticate by Gmail / Email from registered users list
  const loginWithGmail = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const authRes = await authenticateRegisteredUser(email);
      if (!authRes.success || !authRes.user) {
        return { success: false, error: authRes.error || 'Authentication denied.' };
      }

      await db.users.put(authRes.user);
      setCurrentUser(authRes.user);
      localStorage.setItem('shopledger_active_uid', authRes.user.uid);
      setIsLocked(false);
      return { success: true };
    } catch (err: any) {
      console.error('Failed to authenticate Gmail user:', err);
      return { success: false, error: err?.message || 'Failed to authenticate user.' };
    }
  };

  const login = async (email: string): Promise<{ success: boolean; error?: string }> => {
    return await loginWithGmail(email);
  };

  const loginWithEmailAndPin = async (
    email: string,
    pin: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const authRes = await authenticateWorkerWithEmailAndPin(email, pin);
      if (!authRes.success || !authRes.user) {
        return { success: false, error: authRes.error || 'Authentication denied.' };
      }

      await db.users.put(authRes.user);
      setCurrentUser(authRes.user);
      localStorage.setItem('shopledger_active_uid', authRes.user.uid);
      setIsLocked(false);
      return { success: true };
    } catch (err: any) {
      console.error('Failed to authenticate with Email and PIN:', err);
      return { success: false, error: err?.message || 'Login error.' };
    }
  };

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    // Cannot unlock if user does not exist or has been deactivated
    if (!currentUser || currentUser.active !== true) return false;
    const trimmedInput = pin.trim();

    // Strict validation: Verify against user's salted SHA-256 pinHash or legacy pin
    const isMatch = await verifyPin(trimmedInput, currentUser.pinHash || currentUser.pin || '1234');
    if (isMatch) {
      setIsLocked(false);
      return true;
    }

    // Owner can also use the Store Security PIN if defined
    if (currentUser.role === 'owner') {
      const isOwnerShopPin = await verifyPin(trimmedInput, currentShop?.settings?.editPin || '1234');
      if (isOwnerShopPin) {
        setIsLocked(false);
        return true;
      }
    }

    return false;
  };

  const lockScreen = () => {
    setIsLocked(true);
  };

  const logout = () => {
    localStorage.removeItem('shopledger_active_uid');
    signOutFirebase();
    setCurrentUser(null);
  };

  const switchUser = async (uid: string) => {
    const user = await db.users.get(uid);
    if (user && user.active) {
      setCurrentUser(user);
      localStorage.setItem('shopledger_active_uid', user.uid);
      setIsLocked(false);
    }
  };

  const updateShopSettings = async (settings: Partial<Shop['settings']>) => {
    if (!currentShop) return;
    const updatedSettings = { ...currentShop.settings, ...settings };
    await db.shops.update(currentShop.id, {
      settings: updatedSettings,
    });
    setCurrentShop((prev) => (prev ? { ...prev, settings: updatedSettings } : null));
  };

  const updateShopDetails = async (details: Partial<Shop>) => {
    if (!currentShop) return;
    await db.shops.update(currentShop.id, {
      ...details,
    });
    setCurrentShop((prev) => (prev ? { ...prev, ...details } : null));
  };

  const refreshShop = async () => {
    if (!currentShop) return;
    const fresh = await db.shops.get(currentShop.id);
    if (fresh) setCurrentShop(fresh);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentShop,
        isLoading,
        isLocked,
        login,
        loginWithGoogle,
        loginWithGmail,
        loginWithEmailAndPin,
        unlockWithPin,
        lockScreen,
        logout,
        switchUser,
        updateShopSettings,
        updateShopDetails,
        refreshShop,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
