const saveProfile = document.getElementById("saveProfile");
const logoutProfile = document.getElementById("logoutProfile");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profilePhoto = document.getElementById("profilePhoto");
const profileAvatar = document.querySelector(".profileAvatar");
const profileStatus = document.getElementById("profileStatus");

function setProfileStatus(message, type = "") {
  profileStatus.textContent = message;
  profileStatus.className = `authStatus ${type}`.trim();
}

function initials(value) {
  return String(value || "PC")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function setAvatar({ name, avatarUrl }) {
  profileAvatar.textContent = avatarUrl ? "" : initials(name);
  profileAvatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
}

async function loadProfile() {
  if (!window.folhaSupabase?.isReady()) {
    setProfileStatus("Supabase não carregou. Tente atualizar a página.", "error");
    return;
  }
  const user = await window.folhaSupabase.currentUser();
  if (!user) {
    window.location.href = "/login.html";
    return;
  }
  const profile = await window.folhaSupabase.getProfile(user.id).catch(() => null);
  const name = profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "PAZ Church";
  profileName.value = name;
  profileEmail.value = profile?.email || user.email || "";
  setAvatar({ name, avatarUrl: profile?.avatar_url || "" });
}

profilePhoto.addEventListener("change", () => {
  const file = profilePhoto.files?.[0];
  if (!file) {
    return;
  }
  const url = URL.createObjectURL(file);
  setAvatar({ avatarUrl: url });
});

saveProfile.addEventListener("click", async () => {
  if (!window.folhaSupabase?.isReady()) {
    setProfileStatus("Supabase não carregou. Tente atualizar a página.", "error");
    return;
  }
  saveProfile.disabled = true;
  saveProfile.textContent = "Salvando...";
  setProfileStatus("Salvando perfil...");
  try {
    const profile = await window.folhaSupabase.upsertProfile({
      name: profileName.value.trim(),
      email: profileEmail.value.trim(),
      avatarFile: profilePhoto.files?.[0],
    });
    setAvatar({ name: profile.name, avatarUrl: profile.avatar_url || "" });
    await window.folhaSupabase.hydrateHeaderProfile();
    setProfileStatus("Perfil salvo com sucesso.", "ok");
    saveProfile.textContent = "Salvo ✓";
    window.setTimeout(() => {
      saveProfile.textContent = "Salvar alterações";
    }, 1500);
  } catch (error) {
    setProfileStatus(error.message || "Não foi possível salvar o perfil.", "error");
    saveProfile.textContent = "Salvar alterações";
  } finally {
    saveProfile.disabled = false;
  }
});

logoutProfile.addEventListener("click", async () => {
  try {
    await window.folhaSupabase?.signOut();
  } finally {
    window.location.href = "/login.html";
  }
});

loadProfile().catch((error) => {
  setProfileStatus(error.message || "Não foi possível carregar o perfil.", "error");
});
