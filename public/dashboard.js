const recent = document.getElementById("dashboardRecent");
const totalFiles = document.getElementById("totalFiles");
const greeting = document.getElementById("greeting");
const todayLabel = document.getElementById("todayLabel");

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(value);
}

function greetingText(hour) {
  if (hour < 12) return "Bom dia!";
  if (hour < 18) return "Boa tarde!";
  return "Boa noite!";
}

async function loadFiles() {
  const response = await fetch("/api/saved");
  if (!response.ok) throw new Error("Falha ao carregar arquivos.");
  const payload = await response.json();
  return (payload.files || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderFiles(files) {
  totalFiles.textContent = files.length;
  const items = files.slice(0, 5);
  if (!items.length) {
    recent.innerHTML = '<p class="emptyState compactEmpty">Nenhum PDF salvo ainda.</p>';
    return;
  }
  recent.innerHTML = "";
  items.forEach((file) => {
    const row = document.createElement("a");
    row.className = "dashboardRow";
    row.href = `/salvos.html?arquivo=${encodeURIComponent(file.id)}`;
    row.innerHTML = `<strong>${file.title || "Arquivo salvo"}</strong><span>Concluído</span>`;
    recent.append(row);
  });
}

const now = new Date();
todayLabel.textContent = formatDate(now);
greeting.textContent = greetingText(now.getHours());

loadFiles().then(renderFiles).catch(() => {
  recent.innerHTML = '<p class="emptyState compactEmpty">Não foi possível carregar os PDFs recentes.</p>';
});
