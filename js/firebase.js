import { firebaseConfig as FIREBASE_CONFIG, TOURNAMENT_ID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, collection, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, getDocs,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export function firebaseReady(){
  return FIREBASE_CONFIG && FIREBASE_CONFIG.projectId;
}

export function initFirebase(){
  if(!firebaseReady()) return null;
  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);
  return {
    app, db, auth,
    TOURNAMENT_ID,
    _f:{
      doc,collection,getDoc,setDoc,updateDoc,onSnapshot,serverTimestamp,query,orderBy,getDocs,deleteField,
      signInWithEmailAndPassword,signOut,onAuthStateChanged
    }
  };
}

export function tournamentRef(FB){
  const {db,_f}=FB;
  return _f.doc(db, "tournaments", FB.TOURNAMENT_ID);
}
export function matchRef(FB, matchId){
  const {db,_f}=FB;
  return _f.doc(db, "tournaments", FB.TOURNAMENT_ID, "matches", matchId);
}
export function matchesCol(FB){
  const {db,_f}=FB;
  return _f.collection(db, "tournaments", FB.TOURNAMENT_ID, "matches");
}
