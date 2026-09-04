const DB_NAME = "folha-estudo-arquivos";
const DB_VERSION = 1;
const STORE_NAME = "arquivos";

const list = document.getElementById("savedList");
const searchInput = document.getElementById("savedSearch");
const seriesFilter = document.getElementById("seriesFilter");
const sortFilter = document.getElementById("sortFilter");
const deleteModal = document.getElementById("deleteModal");
const deleteModalMessage = document.getElementById("deleteModalMessage");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
const shareModal = document.getElementById("shareModal");
const shareWhatsapp = document.getElementById("shareWhatsapp");
const shareEmail = document.getElementById("shareEmail");
const copyShareLink = document.getElementById("copyShareLink");
const closeShareBtn = document.getElementById("closeShareBtn");

let savedFiles = [];
let pendingDeleteFile = null;
let activeShareFile = null;

function openSavedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.erro || "Não foi possível concluir a ação.");
  }
  return payload;
}

async function getLocalSavedFiles() {
  const db = await openSavedDb();
  const files = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files;
}

async function getSavedFiles() {
  if (window.folhaSupabase?.isReady()) {
    try {
      const files = await window.folhaSupabase.listStudyFiles();
      if (files) {
        return files;
      }
    } catch (error) {
      console.warn("Arquivos do Supabase indisponíveis, usando salvamento antigo.", error);
    }
  }

  try {
    const payload = await fetchJson("/api/saved");
    return (payload.files || []).map((file) => ({ ...file, online: true }));
  } catch (error) {
    console.warn("Arquivos online indisponíveis, usando navegador.", error);
    return (await getLocalSavedFiles()).map((file) => ({ ...file, online: false }));
  }
}

async function deleteFile(file) {
  if (file.supabase && window.folhaSupabase?.isReady()) {
    await window.folhaSupabase.deleteStudyFile(file);
    return;
  }

  if (file.online) {
    await fetchJson(`/api/saved?id=${encodeURIComponent(file.id)}`, { method: "DELETE" });
    return;
  }
  const db = await openSavedDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(file.id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTableDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(".", "");
}

function formatSize(bytes) {
  if (!bytes) {
    return "PDF";
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.max(1, Math.round(kb))} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function generateBlob(file, endpoint) {
  if (!file.data) {
    throw new Error("Este arquivo precisa ser salvo novamente para baixar neste formato.");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file.data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.erro || "Não foi possível baixar o arquivo.");
  }
  return response.blob();
}

async function downloadFile(file, format, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando...";
  try {
    if (format === "pdf" && file.pdfUrl) {
      const response = await fetch(file.pdfUrl);
      if (!response.ok) {
        throw new Error("Não foi possível baixar o PDF salvo.");
      }
      downloadBlob(await response.blob(), file.name || "folha-de-estudo-life-group.pdf");
      return;
    }
    if (format === "pdf" && file.blob) {
      downloadBlob(file.blob, file.name || "folha-de-estudo-life-group.pdf");
      return;
    }
    const blob = await generateBlob(file, format === "pdf" ? "/api/pdf" : "/api/word");
    downloadBlob(blob, format === "pdf" ? "folha-de-estudo-life-group.pdf" : "folha-de-estudo-life-group.docx");
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function savedDraftPayload(file, mode = "preview") {
  if (!file.data) {
    return null;
  }
  return {
    id: file.id,
    name: file.name,
    createdAt: file.createdAt,
    data: file.data,
    mode,
  };
}

function viewFile(file) {
  const payload = savedDraftPayload(file, "preview");
  if (!payload) {
    alert("Este arquivo foi salvo antes da função de prévia. Gere e salve novamente para visualizar online.");
    return;
  }
  sessionStorage.setItem("folhaEstudoSavedDraft", JSON.stringify(payload));
  window.location.href = "/index.html";
}

function editFile(file) {
  const payload = savedDraftPayload(file, "edit");
  if (!payload) {
    alert("Este arquivo foi salvo antes da função de edição. Gere e salve novamente para editar online.");
    return;
  }
  sessionStorage.setItem(
    "folhaEstudoSavedDraft",
    JSON.stringify(payload),
  );
  window.location.href = "/index.html";
}

function openDeleteModal(file) {
  pendingDeleteFile = file;
  const title = file.title || "Arquivo salvo";
  deleteModalMessage.textContent = `${title} será removido permanentemente de Arquivos Salvos. Essa ação não pode ser desfeita.`;
  deleteModal.classList.remove("hidden");
  document.body.classList.add("modalOpen");
  cancelDeleteBtn.focus();
}

function closeDeleteModal() {
  pendingDeleteFile = null;
  deleteModal.classList.add("hidden");
  document.body.classList.remove("modalOpen");
  confirmDeleteBtn.disabled = false;
  confirmDeleteBtn.textContent = "Excluir";
}

function shareUrl(file) {
  const url = new URL(window.location.href);
  url.searchParams.set("arquivo", file.id);
  return url.toString();
}

function openShareModal(file) {
  activeShareFile = file;
  const url = shareUrl(file);
  const text = `Folha de Estudo: ${file.title || "Arquivo salvo"}`;
  shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  shareEmail.href = `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`;
  copyShareLink.innerHTML = "Copiar link <span>→</span>";
  shareModal.classList.remove("hidden");
  document.body.classList.add("modalOpen");
}

function closeShareModal() {
  activeShareFile = null;
  shareModal.classList.add("hidden");
  document.body.classList.remove("modalOpen");
}

function updateSeriesOptions(files) {
  const current = seriesFilter.value;
  const titles = [...new Set(files.map((file) => file.title).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  seriesFilter.innerHTML = '<option value="">Todas as séries</option>';
  titles.forEach((title) => {
    const option = document.createElement("option");
    option.value = title;
    option.textContent = title;
    seriesFilter.append(option);
  });
  seriesFilter.value = titles.includes(current) ? current : "";
}

function filteredFiles() {
  const term = searchInput.value.trim().toLowerCase();
  const series = seriesFilter.value;
  const sort = sortFilter.value;
  const files = savedFiles.filter((file) => {
    const text = `${file.title || ""} ${file.name || ""}`.toLowerCase();
    return (!term || text.includes(term)) && (!series || file.title === series);
  });
  files.sort((a, b) => {
    if (sort === "oldest") {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    if (sort === "title") {
      return (a.title || "").localeCompare(b.title || "", "pt-BR");
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return files;
}

function closeAllDownloadMenus(except = null) {
  document.querySelectorAll(".downloadOptions").forEach((menu) => {
    if (menu !== except) {
      menu.classList.add("hidden");
    }
  });
  document.querySelectorAll(".download").forEach((button) => {
    if (!except || !button.parentElement.contains(except)) {
      button.setAttribute("aria-expanded", "false");
    }
  });
}

function authorName(file) {
  return file.author || file.createdBy || file.owner || "PAZ Church";
}

function authorInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function renderFiles() {
  const files = filteredFiles();
  list.innerHTML = "";
  if (!files.length) {
    list.innerHTML = '<section class="savedTableCard emptySavedTable"><p class="emptyState">Nenhum arquivo encontrado.</p></section>';
    return;
  }

  const table = document.createElement("section");
  table.className = "savedTableCard";

  const header = document.createElement("div");
  header.className = "savedTableHeader";
  header.innerHTML = "<span>Documento</span><span>Criado por</span><span>Data</span><span></span><span>Status</span>";
  table.append(header);

  files.forEach((file) => {
    const item = document.createElement("article");
    item.className = "savedTableRow";

    const info = document.createElement("button");
    info.className = "savedDocCell savedRowButton";
    info.type = "button";
    info.addEventListener("click", () => viewFile(file));

    const title = document.createElement("span");
    title.textContent = file.title || "Arquivo salvo";

    const creator = document.createElement("div");
    creator.className = "savedAuthorCell";
    const creatorName = authorName(file);
    const avatar = document.createElement("span");
    avatar.className = "savedAuthorAvatar";
    if (file.avatarUrl) {
      avatar.classList.add("hasPhoto");
      avatar.style.backgroundImage = `url("${file.avatarUrl}")`;
    } else {
      avatar.textContent = authorInitials(creatorName) || "PC";
    }
    const name = document.createElement("span");
    name.textContent = creatorName;
    creator.append(avatar, name);

    const date = document.createElement("span");
    date.className = "savedDateCell";
    date.textContent = formatTableDate(file.createdAt);

    const actions = document.createElement("div");
    actions.className = "savedInlineActions";

    const edit = document.createElement("button");
    edit.className = "secondaryAction";
    edit.type = "button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => editFile(file));

    const downloadMenu = document.createElement("div");
    downloadMenu.className = "downloadMenu";
    const download = document.createElement("button");
    download.className = "download";
    download.type = "button";
    download.textContent = "Baixar";
    download.setAttribute("aria-expanded", "false");
    const downloadOptions = document.createElement("div");
    downloadOptions.className = "downloadOptions hidden";
    const pdf = document.createElement("button");
    pdf.type = "button";
    pdf.textContent = "PDF";
    pdf.addEventListener("click", () => {
      downloadOptions.classList.add("hidden");
      download.setAttribute("aria-expanded", "false");
      downloadFile(file, "pdf", pdf);
    });
    const docx = document.createElement("button");
    docx.type = "button";
    docx.textContent = "DOCX";
    docx.addEventListener("click", () => {
      downloadOptions.classList.add("hidden");
      download.setAttribute("aria-expanded", "false");
      downloadFile(file, "docx", docx);
    });
    download.addEventListener("click", () => {
      const isOpen = !downloadOptions.classList.contains("hidden");
      closeAllDownloadMenus(downloadOptions);
      downloadOptions.classList.toggle("hidden", isOpen);
      download.setAttribute("aria-expanded", String(!isOpen));
    });
    downloadOptions.append(pdf, docx);
    downloadMenu.append(download, downloadOptions);

    const share = document.createElement("button");
    share.className = "secondaryAction";
    share.type = "button";
    share.textContent = "Compartilhar";
    share.addEventListener("click", () => openShareModal(file));

    const remove = document.createElement("button");
    remove.className = "deleteSaved";
    remove.type = "button";
    remove.textContent = "Excluir";
    remove.addEventListener("click", () => openDeleteModal(file));

    const status = document.createElement("span");
    status.className = "savedStatusPill";
    status.textContent = "Concluído";

    info.append(title);
    actions.append(edit, downloadMenu, share, remove);
    item.append(info, creator, date, actions, status);
    table.append(item);
  });

  list.append(table);
}

async function refreshFiles() {
  list.innerHTML = '<div class="savedSkeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
  savedFiles = await getSavedFiles();
  updateSeriesOptions(savedFiles);
  renderFiles();
}

cancelDeleteBtn.addEventListener("click", closeDeleteModal);
closeShareBtn.addEventListener("click", closeShareModal);

deleteModal.addEventListener("click", (event) => {
  if (event.target === deleteModal) {
    closeDeleteModal();
  }
});

shareModal.addEventListener("click", (event) => {
  if (event.target === shareModal) {
    closeShareModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!deleteModal.classList.contains("hidden")) closeDeleteModal();
    if (!shareModal.classList.contains("hidden")) closeShareModal();
  }
});

confirmDeleteBtn.addEventListener("click", async () => {
  if (!pendingDeleteFile) {
    return;
  }
  const deleting = pendingDeleteFile;
  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.textContent = "Excluindo...";
  try {
    await deleteFile(deleting);
    closeDeleteModal();
    savedFiles = savedFiles.filter((file) => file.id !== deleting.id);
    updateSeriesOptions(savedFiles);
    renderFiles();
  } catch (error) {
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = "Excluir";
    deleteModalMessage.textContent = "Não foi possível excluir esse arquivo. Tente novamente.";
  }
});

copyShareLink.addEventListener("click", async () => {
  if (!activeShareFile) {
    return;
  }
  await navigator.clipboard.writeText(shareUrl(activeShareFile));
  copyShareLink.innerHTML = "Copiado ✓";
  window.setTimeout(() => {
    if (activeShareFile) {
      copyShareLink.innerHTML = "Copiar link <span>→</span>";
    }
  }, 1500);
});

[searchInput, seriesFilter, sortFilter].forEach((element) => {
  element.addEventListener("input", renderFiles);
  element.addEventListener("change", renderFiles);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".downloadMenu")) {
    closeAllDownloadMenus();
  }
});

refreshFiles().catch(() => {
  list.innerHTML = '<p class="emptyState">Não foi possível carregar os arquivos salvos.</p>';
});
window.folhaSupabase?.hydrateHeaderProfile();
