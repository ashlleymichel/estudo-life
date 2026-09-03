const saveProfile = document.getElementById("saveProfile");
const logoutProfile = document.getElementById("logoutProfile");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profilePhoto = document.getElementById("profilePhoto");
const profileAvatar = document.querySelector(".profileAvatar");
const profileStatus = document.getElementById("profileStatus");
const cropModal = document.getElementById("cropModal");
const cropFrame = document.getElementById("cropFrame");
const cropImage = document.getElementById("cropImage");
const cropZoom = document.getElementById("cropZoom");
const cancelCrop = document.getElementById("cancelCrop");
const applyCrop = document.getElementById("applyCrop");
const profileToast = document.getElementById("profileToast");
const profileToastTitle = document.getElementById("profileToastTitle");
const profileToastMessage = document.getElementById("profileToastMessage");
const closeProfileToast = document.getElementById("closeProfileToast");

let selectedAvatarFile = null;
let cropSourceUrl = "";
let cropSourceFileName = "perfil.jpg";
let cropState = {
  dragging: false,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  lastX: 0,
  lastY: 0,
  zoom: 1,
};

function setProfileStatus(message, type = "") {
  profileStatus.textContent = message;
  profileStatus.className = `authStatus srOnly ${type}`.trim();
}

function showProfileToast(title, message, type = "ok") {
  profileToastTitle.textContent = title;
  profileToastMessage.textContent = message;
  profileToast.classList.toggle("error", type === "error");
  profileToast.classList.remove("hidden");
  window.clearTimeout(showProfileToast.timer);
  showProfileToast.timer = window.setTimeout(() => {
    profileToast.classList.add("hidden");
  }, 4200);
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

function applyCropTransform() {
  if (cropImage.naturalWidth && cropImage.naturalHeight && cropFrame.clientWidth) {
    const frameSize = cropFrame.clientWidth;
    const scaleBase = Math.max(frameSize / cropImage.naturalWidth, frameSize / cropImage.naturalHeight);
    const displayWidth = cropImage.naturalWidth * scaleBase * cropState.zoom;
    const displayHeight = cropImage.naturalHeight * scaleBase * cropState.zoom;
    const limitX = Math.max(0, (displayWidth - frameSize) / 2);
    const limitY = Math.max(0, (displayHeight - frameSize) / 2);
    cropState.x = Math.max(-limitX, Math.min(limitX, cropState.x));
    cropState.y = Math.max(-limitY, Math.min(limitY, cropState.y));
  }
  cropImage.style.transform = `translate(-50%, -50%) translate(${cropState.x}px, ${cropState.y}px) scale(${cropState.zoom})`;
}

function closeCropModal() {
  cropModal.classList.add("hidden");
  document.body.classList.remove("modalOpen");
  if (cropSourceUrl) {
    URL.revokeObjectURL(cropSourceUrl);
  }
  cropSourceUrl = "";
  profilePhoto.value = "";
}

function openCropModal(file) {
  cropSourceFileName = file.name || "perfil.jpg";
  cropSourceUrl = URL.createObjectURL(file);
  cropImage.src = cropSourceUrl;
  cropImage.onload = applyCropTransform;
  cropZoom.value = "1";
  cropState = {
    dragging: false,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    zoom: 1,
  };
  applyCropTransform();
  cropModal.classList.remove("hidden");
  document.body.classList.add("modalOpen");
}

function pointerPosition(event) {
  const point = event.touches?.[0] || event.changedTouches?.[0] || event;
  return { x: point.clientX, y: point.clientY };
}

function startCropDrag(event) {
  event.preventDefault();
  const point = pointerPosition(event);
  cropState.dragging = true;
  cropState.startX = point.x;
  cropState.startY = point.y;
  cropState.lastX = cropState.x;
  cropState.lastY = cropState.y;
}

function moveCropDrag(event) {
  if (!cropState.dragging) {
    return;
  }
  event.preventDefault();
  const point = pointerPosition(event);
  cropState.x = cropState.lastX + point.x - cropState.startX;
  cropState.y = cropState.lastY + point.y - cropState.startY;
  applyCropTransform();
}

function endCropDrag() {
  cropState.dragging = false;
}

function cropToFile() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const frameSize = cropFrame.clientWidth;
      const scaleBase = Math.max(frameSize / image.naturalWidth, frameSize / image.naturalHeight);
      const scale = scaleBase * cropState.zoom;
      const visibleSize = frameSize / scale;
      const sourceX = (image.naturalWidth - visibleSize) / 2 - cropState.x / scale;
      const sourceY = (image.naturalHeight - visibleSize) / 2 - cropState.y / scale;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, sourceX, sourceY, visibleSize, visibleSize, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Não foi possível recortar a foto."));
          return;
        }
        resolve(new File([blob], cropSourceFileName.replace(/\.[^.]+$/, "") + "-perfil.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.9);
    };
    image.onerror = () => reject(new Error("Não foi possível carregar a foto."));
    image.src = cropSourceUrl;
  });
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
  openCropModal(file);
});

cropZoom.addEventListener("input", () => {
  cropState.zoom = Number(cropZoom.value);
  applyCropTransform();
});

cropFrame.addEventListener("mousedown", startCropDrag);
cropFrame.addEventListener("touchstart", startCropDrag, { passive: false });
window.addEventListener("mousemove", moveCropDrag);
window.addEventListener("touchmove", moveCropDrag, { passive: false });
window.addEventListener("mouseup", endCropDrag);
window.addEventListener("touchend", endCropDrag);

cancelCrop.addEventListener("click", closeCropModal);
cropModal.addEventListener("click", (event) => {
  if (event.target === cropModal) {
    closeCropModal();
  }
});

applyCrop.addEventListener("click", async () => {
  applyCrop.disabled = true;
  applyCrop.textContent = "Aplicando...";
  try {
    selectedAvatarFile = await cropToFile();
    setAvatar({ avatarUrl: URL.createObjectURL(selectedAvatarFile) });
    closeCropModal();
    setProfileStatus("Foto ajustada. Clique em salvar alterações.", "ok");
    showProfileToast("Foto ajustada", "Clique em salvar alterações para concluir.");
  } catch (error) {
    setProfileStatus(error.message || "Não foi possível ajustar a foto.", "error");
    showProfileToast("Não foi possível ajustar", error.message || "Tente escolher outra imagem.", "error");
  } finally {
    applyCrop.disabled = false;
    applyCrop.textContent = "Usar foto";
  }
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
      avatarFile: selectedAvatarFile,
    });
    setAvatar({ name: profile.name, avatarUrl: profile.avatar_url || "" });
    await window.folhaSupabase.hydrateHeaderProfile();
    setProfileStatus("Perfil salvo com sucesso.", "ok");
    showProfileToast("Alteração salva com sucesso!", "Seu perfil foi atualizado.");
    saveProfile.textContent = "Salvo ✓";
    window.setTimeout(() => {
      saveProfile.textContent = "Salvar alterações";
    }, 1500);
  } catch (error) {
    setProfileStatus(error.message || "Não foi possível salvar o perfil.", "error");
    showProfileToast("Não foi possível salvar", error.message || "Tente novamente em instantes.", "error");
    saveProfile.textContent = "Salvar alterações";
  } finally {
    saveProfile.disabled = false;
  }
});

closeProfileToast.addEventListener("click", () => {
  profileToast.classList.add("hidden");
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
