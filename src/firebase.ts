import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, onSnapshot, orderBy, addDoc, updateDoc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

const ADMIN_EMAIL = "vtu26208@veltech.edu.in";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Helper for Google Login
export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await ensureUserProfile(user);
    return user;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
};

// Helper for Email/Password Login
export const loginWithEmail = async (email: string, pass: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    // Ensure profile exists (in case it was created via some other method or failed previously)
    await ensureUserProfile(result.user);
    return result.user;
  } catch (error: any) {
    // If user doesn't exist, try to register
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        await ensureUserProfile(result.user);
        return result.user;
      } catch (regError) {
        throw regError;
      }
    }
    throw error;
  }
};

// Helper for Registration (if needed separately)
export const registerWithEmail = async (email: string, pass: string) => {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  await ensureUserProfile(result.user);
  return result.user;
};

async function ensureUserProfile(user: User) {
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Anonymous',
        email: user.email || '',
        photoURL: user.photoURL || '',
        role: user.email === ADMIN_EMAIL ? 'admin' : 'customer'
      });
    } else if (user.email === ADMIN_EMAIL && userSnap.data().role !== 'admin') {
      // Ensure the specific user is always admin if they log in
      await updateDoc(userRef, { role: 'admin' });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

// Helper for Logout
export const logout = () => signOut(auth);

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
