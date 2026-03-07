declare module '@firebase/auth/dist/index.rn' {
  import { FirebaseApp } from 'firebase/app';
  import { Auth, Dependencies } from 'firebase/auth';

  export function initializeAuth(app: FirebaseApp, deps?: Dependencies): Auth;
  export function getReactNativePersistence(storage: unknown): Dependencies['persistence'];
}
