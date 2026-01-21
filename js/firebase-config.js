// Firebase web config is public; security comes from Firestore Rules + Auth.

export const firebaseConfig = {
  apiKey: "AIzaSyC01GEi5mCcPvbLyPlBO0gIbF_gcGZ9hEc",
  authDomain: "mpgb-premier-league-final.firebaseapp.com",
  projectId: "mpgb-premier-league-final",
  storageBucket: "mpgb-premier-league-final.firebasestorage.app",
  messagingSenderId: "421631682034",
  appId: "1:421631682034:web:154cc5d678700ec130776b"
};

// Tournament document path
export const TOURNAMENT_ID = "mpgbpl2026";

// (Optional safety) some files may import this name
export const FIREBASE_CONFIG = firebaseConfig;
