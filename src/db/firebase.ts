import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  deleteField,
  collection,
  query,
  where,
  getDocs,
  setLogLevel,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { User } from '../types';
import { db } from './index';
import { hashPin, verifyPin } from '../utils/crypto';

// Silence internal Firestore connection logs so offline fallback works seamlessly without noisy console errors
setLogLevel('silent');

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firestore = initializeFirestore(
  app,
  {
    experimentalAutoDetectLongPolling: true,
  },
  firebaseConfig.firestoreDatabaseId || '(default)'
);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Recursively removes all `undefined` values from an object or array,
 * because Firebase Firestore throws an error if any field is `undefined`.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as any;
  }
  if (typeof data === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      if (value !== undefined) {
        clean[key] = sanitizeForFirestore(value);
      }
    }
    return clean as T;
  }
  return data;
}

// Business Name & Pre-configured Admin and Staff Accounts
export const BUSINESS_NAME = 'AL-Q ELECTRICALS';

export const DESIGNATED_USERS: Record<
  string,
  { name: string; role: 'owner' | 'seller'; deviceCode: string }
> = {
  'rajifarrid@gmail.com': {
    name: 'Raji Farrid',
    role: 'owner',
    deviceCode: 'D01',
  },
  'wisdomosborn65@gmail.com': {
    name: 'Wisdom Osborn',
    role: 'owner',
    deviceCode: 'D01',
  },
  'abuyahwisdomosborn@gmail.com': {
    name: 'Abuyah Wisdom Osborn',
    role: 'seller',
    deviceCode: 'D02',
  },
};

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

// Seed default shop and designated accounts into Firestore
export async function seedFirestoreBusinessDefaults(): Promise<void> {
  try {
    // 1. Seed Shop info
    const shopRef = doc(firestore, 'shops', 'shop-electrical-01');
    await setDoc(
      shopRef,
      {
        id: 'shop-electrical-01',
        name: BUSINESS_NAME,
        currency: 'GHS',
        currencySymbol: 'GH₵',
        phone: '+233 24 123 4567',
        address: 'Accra, Ghana',
        taxRate: 0,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    // Clean up deprecated accounts in Firestore
    const deprecatedIds = [
      'user-gha_gmail_com',
      'user-gha',
      'user-owner_shopledger_app',
    ];
    for (const dId of deprecatedIds) {
      try {
        await deleteDoc(doc(firestore, 'users', dId));
      } catch {
        // non-blocking
      }
    }

    // Explicitly delete any Firestore document with email gha@gmail.com
    try {
      const ghaQuery = query(collection(firestore, 'users'), where('email', '==', 'gha@gmail.com'));
      const ghaSnap = await getDocs(ghaQuery);
      for (const d of ghaSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch {
      // non-blocking
    }

    // 2. Pre-create designated owner record in Firestore with hashed PIN
    const defaultOwnerHash = await hashPin('1234');
    for (const [email, info] of Object.entries(DESIGNATED_USERS)) {
      const uid = `user-${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const userRef = doc(firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          uid,
          shopId: 'shop-electrical-01',
          name: info.name,
          email,
          role: info.role,
          deviceCode: info.deviceCode,
          active: true,
          pinHash: defaultOwnerHash,
          pin: deleteField(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn('Firestore seed notice (offline fallback active):', err);
  }
}

// Test connection & provision defaults safely
export async function testFirestoreConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await seedFirestoreBusinessDefaults();
    return true;
  } catch {
    return false;
  }
}

/**
 * Strictly authenticates registered and active users only.
 * Disallows arbitrary user creation.
 */
export async function authenticateRegisteredUser(
  email: string,
  displayName?: string,
  customUid?: string
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { success: false, error: 'Email address cannot be empty.' };
  }

  // Explicitly block removed accounts
  if (normalizedEmail === 'gha@gmail.com') {
    return {
      success: false,
      error: 'Access Denied: The account "gha@gmail.com" has been permanently removed from this system.',
    };
  }

  // 1. Check if designated team member (Raji Farrid, Wisdom Osborn, Abuyah Wisdom Osborn)
  const designated = DESIGNATED_USERS[normalizedEmail];
  if (designated) {
    const fallbackUid = `user-${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const userUid = customUid || fallbackUid;
    const localUser = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
    const defaultHash = await hashPin('1234');
    const matchedUser: User = {
      uid: localUser?.uid || userUid,
      shopId: localUser?.shopId || 'shop-electrical-01',
      name: designated.name,
      email: normalizedEmail,
      role: designated.role,
      active: true,
      deviceCode: designated.deviceCode,
      pinHash: localUser?.pinHash || defaultHash,
      createdAt: localUser?.createdAt || (Date.now() - 30 * 24 * 60 * 60 * 1000),
    };
    await db.users.put(matchedUser);
    return { success: true, user: matchedUser };
  }

  // 2. Look up user in Firestore 'users' collection
  let foundUser: User | null = null;
  try {
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docSnap = querySnap.docs[0];
      const data = docSnap.data();
      const pinHash = data.pinHash || (data.pin ? await hashPin(data.pin) : await hashPin('1234'));
      foundUser = {
        uid: docSnap.id,
        shopId: data.shopId || 'shop-electrical-01',
        name: data.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: data.role || 'seller',
        active: data.active === true,
        deviceCode: data.deviceCode || 'D02',
        pinHash,
        createdAt: data.createdAt || Date.now(),
      };

      // If legacy plaintext pin was in Firestore, scrub it immediately!
      if (data.pin) {
        try {
          await setDoc(docSnap.ref, { pin: deleteField(), pinHash, updatedAt: Date.now() }, { merge: true });
        } catch {}
      }
    } else if (customUid) {
      const directDoc = await getDoc(doc(firestore, 'users', customUid));
      if (directDoc.exists()) {
        const data = directDoc.data();
        if (data.email?.toLowerCase() === normalizedEmail) {
          const pinHash = data.pinHash || (data.pin ? await hashPin(data.pin) : await hashPin('1234'));
          foundUser = {
            uid: directDoc.id,
            shopId: data.shopId || 'shop-electrical-01',
            name: data.name || displayName || normalizedEmail.split('@')[0],
            email: data.email || normalizedEmail,
            role: data.role || 'seller',
            active: data.active === true,
            deviceCode: data.deviceCode || 'D02',
            pinHash,
            createdAt: data.createdAt || Date.now(),
          };

          if (data.pin) {
            try {
              await setDoc(directDoc.ref, { pin: deleteField(), pinHash, updatedAt: Date.now() }, { merge: true });
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    console.warn('Firestore user lookup error (fallback to local verification):', err);
  }

  // 3. Fallback: Check local IndexedDB db.users (staff added by admin locally)
  if (!foundUser) {
    try {
      const localUser = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
      if (localUser) {
        foundUser = localUser;
      }
    } catch {
      // IndexedDB query notice
    }
  }

  // 4. SECURITY ENFORCEMENT: Only emails added by the admin are permitted
  if (!foundUser) {
    return {
      success: false,
      error: `Access Denied: The email "${normalizedEmail}" is not authorized. Only staff accounts pre-registered by the store admin can log in.`,
    };
  }

  // 5. SECURITY ENFORCEMENT: Must be a fully active email
  if (foundUser.active !== true) {
    return {
      success: false,
      error: `Account Deactivated: The account for "${foundUser.name || normalizedEmail}" is currently disabled by the shop owner.`,
    };
  }

  return {
    success: true,
    user: foundUser,
  };
}

/**
 * Sign in using Google / Gmail popup with strict authorization check
 */
export async function signInWithGooglePopup(): Promise<AuthResult> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const fbUser: FirebaseUser = result.user;
    const email = fbUser.email || '';
    if (!email) {
      await signOutFirebase();
      return { success: false, error: 'No email found in this Google account.' };
    }

    const authRes = await authenticateRegisteredUser(
      email,
      fbUser.displayName || undefined,
      fbUser.uid
    );

    if (!authRes.success) {
      // Immediately sign out from Firebase Auth so unapproved session doesn't linger
      await signOutFirebase();
    }

    return authRes;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Google sign-in was closed or blocked.',
    };
  }
}

/**
 * Sign out from Firebase Auth
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await fbSignOut(auth);
  } catch (err) {
    console.warn('Sign out notice:', err);
  }
}

/**
 * Mobile-friendly and desktop direct worker/staff login via registered Email and assigned PIN.
 * Eliminates popup dependencies on mobile phones.
 */
export async function authenticateWorkerWithEmailAndPin(
  email: string,
  pin: string
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedPin = pin.trim();

  if (!normalizedEmail) {
    return { success: false, error: 'Please enter your registered email address.' };
  }
  if (!trimmedPin) {
    return { success: false, error: 'Please enter your 4-digit security PIN.' };
  }

  if (normalizedEmail === 'gha@gmail.com') {
    return {
      success: false,
      error: 'Access Denied: The account "gha@gmail.com" has been blocked and removed.',
    };
  }

  // Check if designated team member logging in via PIN
  if (DESIGNATED_USERS[normalizedEmail]) {
    const designated = DESIGNATED_USERS[normalizedEmail];
    const userLocal = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
    const isMatch = await verifyPin(trimmedPin, userLocal?.pinHash || userLocal?.pin || '1234');
    if (isMatch) {
      const pinHash = userLocal?.pinHash || (await hashPin(trimmedPin));
      const fallbackUid = `user-${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const userObj: User = {
        uid: userLocal?.uid || fallbackUid,
        shopId: userLocal?.shopId || 'shop-electrical-01',
        name: designated.name,
        email: normalizedEmail,
        role: designated.role,
        active: true,
        deviceCode: designated.deviceCode,
        pinHash,
        createdAt: userLocal?.createdAt || (Date.now() - 30 * 24 * 60 * 60 * 1000),
      };
      await db.users.put(userObj);
      return { success: true, user: userObj };
    } else {
      return { success: false, error: 'Incorrect 4-digit security PIN.' };
    }
  }

  // 1. Look up user in Firestore
  let foundUser: User | null = null;
  let userDocRef: any = null;
  try {
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const docData = docSnap.data();
      userDocRef = docSnap.ref;
      const pinHash = docData.pinHash || (docData.pin ? await hashPin(docData.pin) : await hashPin('1234'));
      foundUser = {
        uid: docSnap.id,
        shopId: docData.shopId || 'shop-electrical-01',
        name: docData.name || normalizedEmail.split('@')[0],
        email: docData.email || normalizedEmail,
        role: docData.role || 'seller',
        active: docData.active === true,
        deviceCode: docData.deviceCode || 'D02',
        pinHash,
        pin: docData.pin,
        createdAt: docData.createdAt || Date.now(),
      };
    }
  } catch (err) {
    console.warn('Firestore worker lookup error:', err);
  }

  // 2. Check local Dexie
  if (!foundUser) {
    try {
      const local = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
      if (local) foundUser = local;
    } catch {
      // offline fallback
    }
  }

  if (!foundUser) {
    return {
      success: false,
      error: `Access Denied: "${normalizedEmail}" is not registered. Please ask the shop owner to register your email in Cashiers & Staff Accounts.`,
    };
  }

  if (foundUser.active !== true) {
    return {
      success: false,
      error: `Account Deactivated: The account for "${foundUser.name}" has been disabled by the store owner.`,
    };
  }

  // Verify PIN securely using cryptographic hash verification
  const isMatch = await verifyPin(trimmedPin, foundUser.pinHash || foundUser.pin || '1234');
  if (!isMatch) {
    return {
      success: false,
      error: 'Incorrect PIN: Please check your 4-digit PIN or ask the store owner.',
    };
  }

  // If the record had an unhashed plaintext PIN, upgrade to secure hash now and clean Firestore!
  if (foundUser.pin || !foundUser.pinHash) {
    const freshHash = await hashPin(trimmedPin);
    foundUser.pinHash = freshHash;
    delete foundUser.pin;
    try {
      const ref = userDocRef || doc(firestore, 'users', foundUser.uid);
      await setDoc(ref, { pin: deleteField(), pinHash: freshHash, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.warn('PIN hash migration sync notice:', e);
    }
  }

  // Save/cache to local Dexie
  await db.users.put(foundUser);

  return {
    success: true,
    user: foundUser,
  };
}
