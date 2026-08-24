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
  busy: false,
  editingSavedId: "",
};

const $ = (id) => document.getElementById(id);

function setStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function buttonContent(label, loading = false) {
  return loading ? `<span class="spinner" aria-hidden="true"></span><span>${label}</span>` : label;
}

function getExtractLabel() {
  return "Gerar Folha de Estudo";
}

function getFileName() {
  return "folha-de-estudo-life-group.pdf";
}

function setBusy(isBusy, action = "") {
  state.busy = isBusy;
  const extractBtn = $("extractBtn");
  const downloadMenuBtn = $("downloadMenuBtn");
  const downloadPdfBtn = $("downloadPdfBtn");
  const downloadDocxBtn = $("downloadDocxBtn");
  const saveOnlineBtn = $("saveOnlineBtn");
  const addQuestion = $("addQuestion");
  const fileInput = $("pdfFile");
  const fieldsToToggle = [
    ...fields.map((field) => $(field)),
    ...document.querySelectorAll("#questions textarea, .questionRow button"),
  ];

  extractBtn.disabled = isBusy;
  downloadMenuBtn.disabled = isBusy;
  downloadPdfBtn.disabled = isBusy;
  downloadDocxBtn.disabled = isBusy;
  saveOnlineBtn.disabled = isBusy;
  addQuestion.disabled = isBusy;
  fileInput.disabled = isBusy;
  fieldsToToggle.forEach((field) => {
    field.disabled = isBusy;
  });

  extractBtn.classList.toggle("loading", isBusy && action === "extract");
  downloadMenuBtn.classList.toggle("loading", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.classList.toggle("loading", isBusy && action === "save");
  extractBtn.innerHTML = buttonContent(action === "extract" ? "Montando estrutura..." : getExtractLabel(), isBusy && action === "extract");
  downloadMenuBtn.innerHTML = buttonContent(action === "pdf" ? "Gerando PDF..." : action === "word" ? "Gerando DOCX..." : "Baixar", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.innerHTML = buttonContent(action === "save" ? "Salvando..." : "Salvar Arquivo Online", isBusy && action === "save");
  document.body.classList.toggle("isBusy", isBusy);
}

function fillForm(data) {
  if (data.tipo) {
    setMode(data.tipo);
  }
  fields.forEach((field) => {
    $(field).value = data[field] || "";
  });
  state.perguntas = Array.isArray(data.perguntas) ? data.perguntas : [];
  state.textoExtraido = data.textoExtraido || "";
  renderQuestions();
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

function validatePdfData(data) {
  if (!data.titulo || !data.resumo) {
    setStatus("Preencha pelo menos o título e o resumo antes de baixar.", "error");
    return false;
  }
  return true;
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

async function savePdfOnline(data) {
  const response = await fetch("/api/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: state.editingSavedId,
      name: getFileName(),
      data,
    }),
  });
  const saved = await response.json();
  if (!response.ok) {
    throw new Error(saved.erro || "Não foi possível salvar o arquivo online.");
  }
  state.editingSavedId = saved.id || state.editingSavedId;
  return saved;
}

function loadSavedDraftForEditing() {
  const raw = sessionStorage.getItem("folhaEstudoEditDraft");
  if (!raw) {
    return false;
  }
  sessionStorage.removeItem("folhaEstudoEditDraft");
  try {
    const saved = JSON.parse(raw);
    if (!saved || !saved.data) {
      return false;
    }
    state.editingSavedId = saved.id || "";
    fillForm(saved.data);
    setStatus("Arquivo salvo aberto para edição. Ajuste o que precisar e salve novamente.", "ok");
    return true;
  } catch (error) {
    setStatus("Não foi possível abrir o arquivo salvo para edição.", "error");
    return false;
  }
}

function setMode() {
  if (state.busy) {
    return;
  }
  state.tipo = "life_group";
  $("modeEyebrow").textContent = "Life Group";
  $("tituloLabel").textContent = "Título da série";
  $("subtituloLabel").textContent = "Linha do culto";
  $("resumoLabel").textContent = "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.remove("hidden");
  });
  $("extractBtn").innerHTML = getExtractLabel();
}

$("pdfFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  $("fileName").textContent = file ? file.name : "Nenhum arquivo escolhido";
});

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) {
    return;
  }
  const file = $("pdfFile").files[0];
  if (!file) {
    setStatus("Escolha um PDF ou Word antes de extrair.", "error");
    return;
  }

  setStatus("Lendo o arquivo e organizando os campos...");
  setBusy(true, "extract");
  const form = new FormData();
  form.append("arquivo", file);
  form.append("tipo", "life_group");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.erro || "Não foi possível extrair o arquivo.");
    }
    fillForm(data);
    setStatus("Conteúdo extraído. Revise e ajuste o que precisar antes de baixar.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("addQuestion").addEventListener("click", () => {
  if (state.busy) {
    return;
  }
  state.perguntas.push("");
  renderQuestions();
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
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Gerando o PDF final...");
  setBusy(true, "pdf");
  try {
    const blob = await generatePdfBlob(data);
    downloadBlob(blob, getFileName());
    setStatus("PDF gerado e baixado.", "ok");
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
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Gerando o arquivo Word...");
  setBusy(true, "word");
  try {
    const blob = await generateWordBlob(data);
    downloadBlob(blob, "folha-de-estudo-life-group.docx");
    setStatus("Arquivo Word gerado e baixado.", "ok");
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

$("saveOnlineBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  const data = collectData();
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Salvando o arquivo online...");
  setBusy(true, "save");
  try {
    await savePdfOnline(data);
    setStatus("Arquivo salvo online. Todos podem ver em Arquivos salvos.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

fillForm({
  titulo: "Folha de Estudo Life Group",
  subtitulo: "Culto Presencial e On-Line / Life Group",
  momentoGenerosidade:
    'Todas as ofertas dos "Life Groups" são destinadas ao ministério Amor em Ação. A sua oferta tem impactado e alcançado muitas vidas para Jesus! Glórias a Deus por isso!',
  avisos: "Encontro com Deus: 14 a 16 de agosto / inscrições abertas / informações com seu líder",
  momentoVisao:
    "Nossa Missão: Fazer discípulos de Jesus que impactam o mundo inteiro com uma paixão contagiante por Deus. Nossa Visão: Ser um movimento de plantação de igrejas saudáveis e multiplicadoras.",
  resumo: "",
  perguntas: ["Compartilhe conosco o que essa Palavra de domingo falou com você."],
  conclusao: "",
});

setMode();
loadSavedDraftForEditing();
