const fields = [
  "titulo",
  "subtitulo",
  "momentoGenerosidade",
  "avisos",
  "momentoVisao",
  "resumo",
  "conclusao",
];

const state = {
  perguntas: [],
  tipo: "life_group",
  textoExtraido: "",
  editingSavedId: "",
  savedName: "",
  busy: false,
};

const DB_NAME = "folha-estudo-arquivos";
const DB_VERSION = 1;
const STORE_NAME = "arquivos";

const $ = (id) => document.getElementById(id);

function setStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = "srOnly";
}

function buttonContent(label, loading = false) {
  return loading ? `<span class="spinner" aria-hidden="true"></span><span>${label}</span>` : label;
}

function getFileName() {
  return "folha-de-estudo-life-group.pdf";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.erro || "Não foi possível concluir a ação.");
  }
  return payload;
}

function setBusy(isBusy, action = "") {
  state.busy = isBusy;
  const buttons = [$("saveOnlineBtn"), $("downloadMenuBtn"), $("downloadPdfBtn"), $("downloadDocxBtn"), $("addQuestion")];
  const fieldsToToggle = [
    ...fields.map((field) => $(field)),
    ...document.querySelectorAll("#questions textarea, .questionRow button"),
  ];

  buttons.forEach((button) => {
    if (button) {
      button.disabled = isBusy;
    }
  });
  fieldsToToggle.forEach((field) => {
    if (field) {
      field.disabled = isBusy;
    }
  });

  $("saveOnlineBtn").classList.toggle("loading", isBusy && action === "save");
  $("downloadMenuBtn").classList.toggle("loading", isBusy && (action === "pdf" || action === "word"));
  $("saveOnlineBtn").innerHTML = buttonContent(action === "save" ? "Salvando..." : "Salvar", isBusy && action === "save");
  $("downloadMenuBtn").innerHTML = buttonContent(action === "pdf" ? "Gerando PDF..." : action === "word" ? "Gerando DOCX..." : "Baixar", isBusy && (action === "pdf" || action === "word"));
  document.body.classList.toggle("isBusy", isBusy);
}

function setMode() {
  state.tipo = "life_group";
  $("tituloLabel").textContent = "Título da ministração ou da série";
  $("subtituloLabel").textContent = "Linha do culto";
  $("resumoLabel").textContent = "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.remove("hidden");
  });
}

function renderQuestions() {
  const container = $("questions");
  container.innerHTML = "";
  state.perguntas.forEach((question, index) => {
    const row = document.createElement("div");
    row.className = "questionRow";

    const number = document.createElement("div");
    number.className = "number";
    number.textContent = index + 1;

    const input = document.createElement("textarea");
    input.rows = 2;
    input.value = question;
    input.addEventListener("input", () => {
      state.perguntas[index] = input.value;
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remover pergunta";
    remove.addEventListener("click", () => {
      state.perguntas.splice(index, 1);
      renderQuestions();
    });

    row.append(number, input, remove);
    container.append(row);
  });
}

function fillForm(data) {
  setMode();
  fields.forEach((field) => {
    $(field).value = data[field] || "";
  });
  state.perguntas = Array.isArray(data.perguntas) ? data.perguntas : [];
  state.textoExtraido = data.textoExtraido || "";
  renderQuestions();
}

function collectData() {
  const data = {};
  fields.forEach((field) => {
    data[field] = $(field).value.trim();
  });
  data.perguntas = state.perguntas.map((item) => item.trim()).filter(Boolean);
  data.tipo = "life_group";
  data.textoExtraido = state.textoExtraido;
  return data;
}

function validateData(data) {
  if (!data.titulo || !data.resumo) {
    setStatus("Preencha pelo menos o título e o resumo antes de baixar ou salvar.", "error");
    return false;
  }
  return true;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function updateHeading(saved) {
  const date = saved.createdAt ? ` - ${formatDate(saved.createdAt)}` : "";
  $("editTitle").textContent = `Folha de Estudo Life Group${date}`;
}

async function generatePdfBlob(data) {
  const response = await fetch("/api/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.erro || "Não foi possível gerar o PDF.");
  }
  return response.blob();
}

async function generateWordBlob(data) {
  const response = await fetch("/api/word", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.erro || "Não foi possível gerar o Word.");
  }
  return response.blob();
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

async function savePdfOnline(blob, data) {
  if (window.folhaSupabase?.isReady()) {
    try {
      const record = await window.folhaSupabase.saveStudyFile({
        id: state.editingSavedId || "",
        name: state.savedName || getFileName(),
        title: data.titulo || "Arquivo sem título",
        size: blob.size,
        data,
        pdfBlob: blob,
      });
      if (record) {
        state.editingSavedId = record.id || state.editingSavedId;
        state.savedName = record.name || state.savedName;
        return record;
      }
    } catch (error) {
      if (/entre na sua conta/i.test(error.message || "")) {
        throw error;
      }
      console.warn("Supabase indisponível, usando salvamento antigo.", error);
    }
  }

  const payload = {
    id: state.editingSavedId || "",
    name: state.savedName || getFileName(),
    title: data.titulo || "Arquivo sem título",
    size: blob.size,
    data,
  };
  try {
    const record = await fetchJson("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.editingSavedId = record.id || state.editingSavedId;
    state.savedName = record.name || state.savedName;
    return record;
  } catch (error) {
    console.warn("Salvamento online indisponível, usando navegador.", error);
  }

  const db = await openSavedDb();
  const file = {
    id: state.editingSavedId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: state.savedName || getFileName(),
    title: data.titulo || "Arquivo sem título",
    type: data.tipo,
    size: blob.size,
    createdAt: new Date().toISOString(),
    data,
    blob,
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  state.editingSavedId = file.id;
  return file;
}

function loadSavedDraftForEditing() {
  const raw = sessionStorage.getItem("folhaEstudoEditDraft");
  if (!raw) {
    setStatus("Nenhum arquivo foi selecionado para edição. Volte para Arquivos salvos e escolha Editar.", "error");
    return false;
  }
  sessionStorage.removeItem("folhaEstudoEditDraft");
  try {
    const saved = JSON.parse(raw);
    if (!saved || !saved.data) {
      setStatus("Este arquivo não possui dados editáveis. Gere e salve novamente para editar online.", "error");
      return false;
    }
    state.editingSavedId = saved.id || "";
    state.savedName = saved.name || "";
    fillForm(saved.data);
    updateHeading(saved);
    setStatus("Arquivo aberto para edição.", "ok");
    return true;
  } catch (error) {
    setStatus("Não foi possível abrir o arquivo salvo para edição.", "error");
    return false;
  }
}

$("addQuestion").addEventListener("click", () => {
  if (state.busy) {
    return;
  }
  state.perguntas.push("");
  renderQuestions();
});

$("saveOnlineBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  const data = collectData();
  if (!validateData(data)) {
    return;
  }

  setStatus("Salvando alterações...");
  setBusy(true, "save");
  try {
    const blob = await generatePdfBlob(data);
    await savePdfOnline(blob, data);
    $("saveOnlineBtn").textContent = "Salvo ✓";
    setStatus("Alterações salvas.", "ok");
    window.setTimeout(() => {
      if (!state.busy) {
        $("saveOnlineBtn").textContent = "Salvar";
      }
    }, 1500);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

function closeDownloadMenu() {
  $("downloadOptions").classList.add("hidden");
  $("downloadMenuBtn").setAttribute("aria-expanded", "false");
}

$("downloadMenuBtn").addEventListener("click", () => {
  if (state.busy) {
    return;
  }
  const isOpen = !$("downloadOptions").classList.contains("hidden");
  $("downloadOptions").classList.toggle("hidden", isOpen);
  $("downloadMenuBtn").setAttribute("aria-expanded", String(!isOpen));
});

$("downloadPdfBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  closeDownloadMenu();
  const data = collectData();
  if (!validateData(data)) {
    return;
  }

  setStatus("Gerando PDF...");
  setBusy(true, "pdf");
  try {
    const blob = await generatePdfBlob(data);
    downloadBlob(blob, getFileName());
    setStatus("PDF baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("downloadDocxBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  closeDownloadMenu();
  const data = collectData();
  if (!validateData(data)) {
    return;
  }

  setStatus("Gerando Word...");
  setBusy(true, "word");
  try {
    const blob = await generateWordBlob(data);
    downloadBlob(blob, "folha-de-estudo-life-group.docx");
    setStatus("Word baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".downloadMenu")) {
    closeDownloadMenu();
  }
});

loadSavedDraftForEditing();
window.folhaSupabase?.hydrateHeaderProfile();
