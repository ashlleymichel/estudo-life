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
  status.className = `status ${type}`.trim();
}

function buttonContent(label, loading = false) {
  return loading ? `<span class="spinner" aria-hidden="true"></span><span>${label}</span>` : label;
}

function getFileName() {
  return state.tipo === "tadel" ? "resumo-tadel.pdf" : "folha-de-estudo-life-group.pdf";
}

function setBusy(isBusy, action = "") {
  state.busy = isBusy;
  const buttons = [$("saveOnlineBtn"), $("downloadBtn"), $("downloadWordBtn"), $("addQuestion")];
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
  $("downloadBtn").classList.toggle("loading", isBusy && action === "pdf");
  $("downloadWordBtn").classList.toggle("loading", isBusy && action === "word");
  $("saveOnlineBtn").innerHTML = buttonContent(action === "save" ? "Salvando..." : "Salvar", isBusy && action === "save");
  $("downloadBtn").innerHTML = buttonContent(action === "pdf" ? "Gerando..." : "Baixar PDF", isBusy && action === "pdf");
  $("downloadWordBtn").innerHTML = buttonContent(action === "word" ? "Gerando..." : "Baixar Word", isBusy && action === "word");
  document.body.classList.toggle("isBusy", isBusy);
}

function setMode(tipo) {
  state.tipo = tipo === "tadel" ? "tadel" : "life_group";
  const isTadel = state.tipo === "tadel";
  $("tituloLabel").textContent = isTadel ? "Resumo TADEL" : "Título da ministração ou da série";
  $("subtituloLabel").textContent = isTadel ? "DATA" : "Linha do culto";
  $("resumoLabel").textContent = isTadel ? "Conteúdo do TADEL" : "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.toggle("hidden", isTadel);
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
  setMode(data.tipo);
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
  data.tipo = state.tipo;
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
  const data = saved.data || {};
  const base = data.tipo === "tadel" ? "Resumo TADEL" : "Folha de Estudo Life Group";
  const date = saved.createdAt ? ` - ${formatDate(saved.createdAt)}` : "";
  $("editTitle").textContent = `${base}${date}`;
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
    setStatus("Alterações salvas.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("downloadBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
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

$("downloadWordBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  const data = collectData();
  if (!validateData(data)) {
    return;
  }

  setStatus("Gerando Word...");
  setBusy(true, "word");
  try {
    const blob = await generateWordBlob(data);
    downloadBlob(blob, state.tipo === "tadel" ? "resumo-tadel.docx" : "folha-de-estudo-life-group.docx");
    setStatus("Word baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

loadSavedDraftForEditing();
