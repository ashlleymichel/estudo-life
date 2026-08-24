const list = document.getElementById("savedList");

async function getSavedFiles() {
  const response = await fetch("/api/saved");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.erro || "Não foi possível carregar os arquivos salvos.");
  }
  return payload.arquivos || [];
}

async function deleteFile(id) {
  const response = await fetch(`/api/saved?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.erro || "Não foi possível excluir o arquivo.");
  }
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

async function generateDownload(file, format, button) {
  if (!file.data) {
    alert("Este arquivo não possui dados editáveis para gerar o download.");
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando...";
  try {
    const response = await fetch(format === "docx" ? "/api/word" : "/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file.data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.erro || "Não foi possível gerar o arquivo.");
    }
    const blob = await response.blob();
    const filename = format === "docx" ? "folha-de-estudo-life-group.docx" : file.name || "folha-de-estudo-life-group.pdf";
    downloadBlob(blob, filename);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function editFile(file) {
  if (!file.data) {
    alert("Este arquivo não possui dados editáveis.");
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

async function refreshFiles() {
  list.innerHTML = '<p class="emptyState">Carregando arquivos...</p>';
  renderFiles(await getSavedFiles());
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
      generateDownload(file, "pdf", pdf);
    });

    const docx = document.createElement("button");
    docx.type = "button";
    docx.textContent = "DOCX";
    docx.addEventListener("click", () => {
      downloadOptions.classList.add("hidden");
      download.setAttribute("aria-expanded", "false");
      generateDownload(file, "docx", docx);
    });

    download.addEventListener("click", () => {
      const isOpen = !downloadOptions.classList.contains("hidden");
      document.querySelectorAll(".savedActions .downloadOptions").forEach((menu) => {
        if (menu !== downloadOptions) {
          menu.classList.add("hidden");
        }
      });
      downloadOptions.classList.toggle("hidden", isOpen);
      download.setAttribute("aria-expanded", String(!isOpen));
    });

    downloadOptions.append(pdf, docx);
    downloadMenu.append(download, downloadOptions);

    const remove = document.createElement("button");
    remove.className = "deleteSaved";
    remove.type = "button";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      try {
        await deleteFile(file.id);
        await refreshFiles();
      } catch (error) {
        alert(error.message);
      }
    });

    info.append(title, meta);
    actions.append(edit, downloadMenu, remove);
    item.append(info, actions);
    list.append(item);
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".downloadMenu")) {
    return;
  }
  document.querySelectorAll(".savedActions .downloadOptions").forEach((menu) => {
    menu.classList.add("hidden");
  });
  document.querySelectorAll(".savedActions .download").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
});

refreshFiles().catch((error) => {
  list.innerHTML = `<p class="emptyState">${error.message}</p>`;
});
