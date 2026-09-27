import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Configuration : liste des matières proposées à tout le monde ----
// Modifie cette liste si tu veux changer les matières.
const MATIERES = ["Mathématiques", "Français", "Histoire-Géo", "Physique-Chimie", "SVT", "Anglais", "Philosophie", "SES"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let state = {
  user: null, profile: null,
  classeConsultee: null, matiere: MATIERES[0],
  fiches: [], unsubFiches: null,
  chatOpen: false, chatMsgs: [], unsubChat: null,
  classesDisponibles: [],
};

// ---------------------------------------------------------------------
// AUTHENTIFICATION
// ---------------------------------------------------------------------
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    document.getElementById("form-login").hidden = !isLogin;
    document.getElementById("form-signup").hidden = isLogin;
  };
});

document.getElementById("form-login").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errEl.textContent = "Email ou mot de passe incorrect.";
  }
});

document.getElementById("form-signup").addEventListener("submit", async e => {
  e.preventDefault();
  const pseudo = document.getElementById("signup-pseudo").value.trim();
  const code = document.getElementById("signup-code").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const errEl = document.getElementById("signup-error");
  errEl.textContent = "";

  try {
    const invRef = doc(db, "invitations", code);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) {
      errEl.textContent = "Code d'invitation invalide. Demande-le à un délégué ou un professeur.";
      return;
    }
    const classe = invSnap.data().classe;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), { pseudo, classe, email });
  } catch (err) {
    if (err.code === "auth/email-already-in-use") errEl.textContent = "Cet email a déjà un compte.";
    else if (err.code === "auth/weak-password") errEl.textContent = "Mot de passe trop court (6 caractères minimum).";
    else errEl.textContent = "Une erreur est survenue. Réessaie.";
  }
});

document.getElementById("btn-logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (user) {
    const profSnap = await getDoc(doc(db, "users", user.uid));
    if (!profSnap.exists()) { await signOut(auth); return; }
    state.user = user;
    state.profile = profSnap.data();
    state.classeConsultee = state.profile.classe;
    document.getElementById("view-auth").hidden = true;
    document.getElementById("view-app").hidden = false;
    document.getElementById("user-pseudo").textContent = state.profile.pseudo;
    await loadClassesDisponibles();
    renderSidebar();
    subscribeFiches();
    subscribeChat();
  } else {
    state.user = null; state.profile = null;
    if (state.unsubFiches) state.unsubFiches();
    if (state.unsubChat) state.unsubChat();
    document.getElementById("view-app").hidden = true;
    document.getElementById("view-auth").hidden = false;
  }
});

// ---------------------------------------------------------------------
// CLASSES / MATIÈRES (barre latérale)
// ---------------------------------------------------------------------
async function loadClassesDisponibles() {
  const snap = await getDocs(collection(db, "invitations"));
  const set = new Set();
  snap.forEach(d => set.add(d.data().classe));
  set.add(state.profile.classe);
  state.classesDisponibles = [...set].sort();
}

function renderSidebar() {
  const sel = document.getElementById("classe-select");
  sel.innerHTML = state.classesDisponibles.map(c =>
    `<option value="${c}" ${c === state.classeConsultee ? "selected" : ""}>${c}${c === state.profile.classe ? " (ta classe)" : ""}</option>`
  ).join("");
  sel.onchange = e => { state.classeConsultee = e.target.value; subscribeFiches(); subscribeChat(); renderMainHeader(); };

  const tabs = document.getElementById("matiere-tabs");
  tabs.innerHTML = MATIERES.map(m =>
    `<button class="matiere-tab ${m === state.matiere ? "active" : ""}" data-m="${m}">${m}</button>`
  ).join("");
  tabs.querySelectorAll(".matiere-tab").forEach(btn => {
    btn.onclick = () => { state.matiere = btn.dataset.m; renderSidebar(); subscribeFiches(); };
  });
  renderMainHeader();
}

function renderMainHeader() {
  document.getElementById("matiere-title").textContent = `${state.matiere} — ${state.classeConsultee}`;
  document.getElementById("btn-upload").style.display = (state.classeConsultee === state.profile.classe) ? "" : "none";
}

// ---------------------------------------------------------------------
// FICHES
// ---------------------------------------------------------------------
function score(f) { return (f.up || []).length - (f.down || []).length; }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function subscribeFiches() {
  if (state.unsubFiches) state.unsubFiches();
  state.fiches = [];
  renderFiches();
  const q = query(collection(db, "fiches"),
    where("classe", "==", state.classeConsultee),
    where("matiere", "==", state.matiere));
  state.unsubFiches = onSnapshot(q, snap => {
    state.fiches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFiches();
  }, err => console.error(err));
}

function renderFiches() {
  const grid = document.getElementById("fiches-grid");
  const list = [...state.fiches].sort((a, b) => score(b) - score(a));
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty">Aucune fiche pour l'instant dans cette matière.</div>`;
    return;
  }
  const uid = state.user.uid;
  grid.innerHTML = list.map(f => {
    const upV = (f.up || []).includes(uid), downV = (f.down || []).includes(uid);
    const mine = f.auteurUid === uid;
    return `<div class="fiche-card">
      <h3>${escapeHtml(f.titre)}</h3>
      <div class="fiche-meta">Par ${escapeHtml(f.auteurPseudo)} · ${escapeHtml(f.classe)}</div>
      <div class="fiche-content">${escapeHtml(f.contenu)}</div>
      <div class="fiche-actions">
        <button class="vote-btn ${upV ? "voted" : ""}" data-id="${f.id}" data-dir="up">👍</button>
        <span class="score">${score(f)}</span>
        <button class="vote-btn ${downV ? "voted" : ""}" data-id="${f.id}" data-dir="down">👎</button>
        ${mine ? `<button class="del-link" data-id="${f.id}">Supprimer</button>` : ""}
      </div>
    </div>`;
  }).join("");
  grid.querySelectorAll(".vote-btn").forEach(b => b.onclick = () => vote(b.dataset.id, b.dataset.dir));
  grid.querySelectorAll(".del-link").forEach(b => b.onclick = () => {
    if (confirm("Supprimer cette fiche ?")) deleteDoc(doc(db, "fiches", b.dataset.id));
  });
}

async function vote(id, dir) {
  const ref = doc(db, "fiches", id);
  const snap = await getDoc(ref);
  const f = snap.data();
  const uid = state.user.uid;
  let up = (f.up || []).filter(v => v !== uid), down = (f.down || []).filter(v => v !== uid);
  if (dir === "up" && !(f.up || []).includes(uid)) up.push(uid);
  if (dir === "down" && !(f.down || []).includes(uid)) down.push(uid);
  await updateDoc(ref, { up, down });
}

// ---------------------------------------------------------------------
// IMPORT + GÉNÉRATION IA
// ---------------------------------------------------------------------
document.getElementById("btn-upload").onclick = openUploadModal;
let uploadMode = "photo";
let uploadedImage = null;

function openUploadModal() {
  uploadMode = "photo"; uploadedImage = null;
  document.getElementById("modal-root").innerHTML = `
  <div class="modal-overlay" id="ov">
    <div class="modal">
      <h2>Importer un cours</h2>
      <p class="sub">${state.matiere} — ${state.profile.classe}</p>
      <div class="mode-toggle">
        <button type="button" id="mode-photo" class="active">Photo du cours</button>
        <button type="button" id="mode-texte">Coller le texte</button>
      </div>
      <label>Titre du chapitre</label>
      <input type="text" id="titre-input" placeholder="Ex : Les fonctions dérivées">
      <div id="mode-content"></div>
      <div id="gen-status" class="status-msg"></div>
      <div class="modal-actions">
        <button class="btn" id="cancel-upload">Annuler</button>
        <button class="btn btn-primary" id="gen-btn">Générer la fiche</button>
      </div>
    </div>
  </div>`;
  renderModeContent();
  document.getElementById("mode-photo").onclick = () => { uploadMode = "photo"; toggleModeBtns(); renderModeContent(); };
  document.getElementById("mode-texte").onclick = () => { uploadMode = "texte"; toggleModeBtns(); renderModeContent(); };
  document.getElementById("cancel-upload").onclick = () => document.getElementById("modal-root").innerHTML = "";
  document.getElementById("ov").onclick = e => { if (e.target.id === "ov") document.getElementById("modal-root").innerHTML = ""; };
  document.getElementById("gen-btn").onclick = generateFiche;
}

function toggleModeBtns() {
  document.getElementById("mode-photo").classList.toggle("active", uploadMode === "photo");
  document.getElementById("mode-texte").classList.toggle("active", uploadMode === "texte");
}

function renderModeContent() {
  const el = document.getElementById("mode-content");
  if (uploadMode === "photo") {
    el.innerHTML = `
      <label>Photo du cours</label>
      <div class="file-drop" id="file-drop">Clique pour choisir une photo</div>
      <input type="file" id="file-input" accept="image/*" style="display:none">`;
    const drop = document.getElementById("file-drop");
    const input = document.getElementById("file-input");
    drop.onclick = () => input.click();
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        uploadedImage = { mediaType: file.type, data: reader.result.split(",")[1] };
        drop.textContent = "✓ " + file.name;
        drop.classList.add("has-file");
      };
      reader.readAsDataURL(file);
    };
  } else {
    el.innerHTML = `<label>Texte du cours</label><textarea id="texte-input" placeholder="Colle ici le contenu de ton cours..."></textarea>`;
  }
}

async function generateFiche() {
  const titre = document.getElementById("titre-input").value.trim();
  const statusEl = document.getElementById("gen-status");
  const texte = uploadMode === "texte" ? document.getElementById("texte-input").value.trim() : null;

  if (!titre) { statusEl.textContent = "Ajoute un titre."; statusEl.className = "status-msg error"; return; }
  if (uploadMode === "photo" && !uploadedImage) { statusEl.textContent = "Choisis une photo."; statusEl.className = "status-msg error"; return; }
  if (uploadMode === "texte" && !texte) { statusEl.textContent = "Colle le texte du cours."; statusEl.className = "status-msg error"; return; }

  statusEl.textContent = "Génération de la fiche en cours..."; statusEl.className = "status-msg";
  document.getElementById("gen-btn").disabled = true;

  try {
    const res = await fetch("/api/generate-fiche", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre, matiere: state.matiere, texte, image: uploadMode === "photo" ? uploadedImage : null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");

    await addDoc(collection(db, "fiches"), {
      classe: state.profile.classe, matiere: state.matiere, titre,
      contenu: data.contenu, auteurUid: state.user.uid, auteurPseudo: state.profile.pseudo,
      up: [], down: [], ts: Date.now()
    });
    document.getElementById("modal-root").innerHTML = "";
  } catch (e) {
    statusEl.textContent = "La génération a échoué. Réessaie.";
    statusEl.className = "status-msg error";
    document.getElementById("gen-btn").disabled = false;
  }
}

// ---------------------------------------------------------------------
// CHAT (visible uniquement par les élèves de la classe consultée)
// ---------------------------------------------------------------------
document.getElementById("chat-toggle").onclick = () => { state.chatOpen = !state.chatOpen; renderChat(); };

function subscribeChat() {
  if (state.unsubChat) state.unsubChat();
  state.chatMsgs = [];
  renderChat();
  const q = query(collection(db, "chat"),
    where("classe", "==", state.classeConsultee),
    orderBy("ts", "asc"), limit(100));
  state.unsubChat = onSnapshot(q, snap => {
    state.chatMsgs = snap.docs.map(d => d.data());
    renderChat();
  }, err => console.error(err));
}

function renderChat() {
  const root = document.getElementById("chat-root");
  if (!state.chatOpen) { root.innerHTML = ""; return; }
  const isOwnClass = state.classeConsultee === state.profile.classe;
  root.innerHTML = `
  <div class="chat-panel">
    <div class="chat-header"><span>${state.classeConsultee}</span><button class="del-link" id="chat-close">Fermer</button></div>
    <div class="chat-msgs" id="chat-msgs-el">
      ${isOwnClass
        ? (state.chatMsgs.map(m => `<div class="chat-msg"><b>${escapeHtml(m.auteurPseudo)} :</b> ${escapeHtml(m.texte)}</div>`).join("") || '<div class="empty">Aucun message. Lance la discussion !</div>')
        : '<div class="empty">Le chat n\'est visible que par les élèves de cette classe.</div>'}
    </div>
    ${isOwnClass ? `<div class="chat-input"><input id="chat-input" placeholder="Écrire un message..."><button id="chat-send">Envoyer</button></div>` : ""}
  </div>`;
  document.getElementById("chat-close").onclick = () => { state.chatOpen = false; renderChat(); };
  if (isOwnClass) {
    const send = () => {
      const inp = document.getElementById("chat-input");
      const v = inp.value.trim();
      if (!v) return;
      addDoc(collection(db, "chat"), { classe: state.profile.classe, texte: v, auteurPseudo: state.profile.pseudo, auteurUid: state.user.uid, ts: Date.now() });
      inp.value = "";
    };
    document.getElementById("chat-send").onclick = send;
    document.getElementById("chat-input").onkeydown = e => { if (e.key === "Enter") send(); };
  }
  const box = document.getElementById("chat-msgs-el");
  if (box) box.scrollTop = box.scrollHeight;
}
