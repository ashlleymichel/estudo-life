const DB_NAME = "folha-estudo-arquivos";
const DB_VERSION = 1;
const STORE_NAME = "arquivos";

const list = document.getElementById("savedList");

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

async function getSavedFiles() {
  const db = await openSavedDb();
  const files = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function deleteFile(id) {
  const db = await openSavedDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
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

function downloadFile(file) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "arquivo-salvo.pdf";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function editFile(file) {
  if (!file.data) {
    alert("Este arquivo foi salvo antes da função de edição. Gere e salve novamente para editar online.");
    return;
  }
  sessionStorage.setItem(
    "folhaEstudoEditDraft",
    JSON.stringify({
      id: file.id,
      name: file.name,
      createdAt: file.createdAt,
      data: file.data,
    }),
  );
  window.location.href = "/editar.html";
}

function renderFiles(files) {
  list.innerHTML = "";
  if (!files.length) {
    list.innerHTML = '<p class="emptyState">Nenhum arquivo salvo ainda.</p>';
    return;
  }

  files.forEach((file) => {
    const item = document.createElement("article");
    item.className = "savedItem";

    const info = document.createElement("div");
    info.className = "savedInfo";

    const title = document.createElement("h2");
    title.textContent = file.title || "Arquivo salvo";

    const meta = document.createElement("p");
    meta.textContent = `${formatDate(file.createdAt)} · ${formatSize(file.size)}`;

    const actions = document.createElement("div");
    actions.className = "savedActions";

    const download = document.createElement("button");
    download.className = "download";
    download.type = "button";
    download.textContent = "Baixar";
    download.addEventListener("click", () => downloadFile(file));

    const edit = document.createElement("button");
    edit.className = "secondaryAction";
    edit.type = "button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => editFile(file));

    const remove = document.createElement("button");
    remove.className = "deleteSaved";
    remove.type = "button";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      await deleteFile(file.id);
      renderFiles(await getSavedFiles());
    });

    info.append(title, meta);
    actions.append(edit, download, remove);
    item.append(info, actions);
    list.append(item);
  });
}

getSavedFiles()
  .then(renderFiles)
  .catch(() => {
    list.innerHTML = '<p class="emptyState">Não foi possível carregar os arquivos salvos.</p>';
  });
