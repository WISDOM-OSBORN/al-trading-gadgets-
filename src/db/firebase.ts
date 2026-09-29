import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  getDocFromServer,
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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Test connection on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const testDocRef = doc(firestore, '_health', 'status');
    await getDocFromServer(testDocRef);
    return true;
  } catch (err: any) {
    if (err?.code === 'not-found' || err?.code === 'permission-denied') {
      return true;
    }
    console.warn('Firestore connection notice:', err?.message || err);
    return false;
  }
}

/**
 * Fetch or authenticate user directly from Firestore.
 * Developers can manage / approve users directly in Firestore `users` collection.
 */
export async function getOrCreateFirestoreUser(
  email: string,
  displayName?: string,
  customUid?: string
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const uid = customUid || `user-${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;

  // 1. Try to find user by document ID or email query in Firestore
  try {
    const directDocRef = doc(firestore, 'users', uid);
    const directDoc = await getDoc(directDocRef);

    if (directDoc.exists()) {
      const data = directDoc.data();
      return {
        uid: directDoc.id,
        shopId: data.shopId || 'shop-01',
        name: data.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: data.role || 'seller',
        active: data.active !== false,
        deviceCode: data.deviceCode || 'D01',
        createdAt: data.createdAt || Date.now(),
      };
    }

    // Check by email query
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docSnap = querySnap.docs[0];
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        shopId: data.shopId || 'shop-01',
        name: data.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: data.role || 'seller',
        active: data.active !== false,
        deviceCode: data.deviceCode || 'D01',
        createdAt: data.createdAt || Date.now(),
      };
    }
  } catch (err) {
    console.warn('Firestore user fetch notice:', err);
  }

  // 2. Determine initial role: owner if wisdomosborn65@gmail.com or designated developer
  const isOwner =
    normalizedEmail === 'wisdomosborn65@gmail.com' ||
    normalizedEmail.includes('owner') ||
    normalizedEmail.includes('admin');

  const newUser: User = {
    uid,
    shopId: 'shop-01',
    name: displayName || (isOwner ? 'Store Owner' : 'Staff Manager'),
    email: normalizedEmail,
    role: isOwner ? 'owner' : 'seller',
    active: true,
    deviceCode: isOwner ? 'D01' : 'D02',
    createdAt: Date.now(),
  };

  // 3. Save new user to Firestore so developer can view and manage in Firebase console
  try {
    await setDoc(doc(firestore, 'users', uid), newUser, { merge: true });
  } catch (err) {
    console.warn('Could not write new user to Firestore:', err);
  }

  return newUser;
}

/**
 * Sign in using Google / Gmail popup
 */
export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const fbUser: FirebaseUser = result.user;
  return await getOrCreateFirestoreUser(
    fbUser.email || '',
    fbUser.displayName || undefined,
    fbUser.uid
  );
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
