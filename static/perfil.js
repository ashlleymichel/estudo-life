const saveProfile = document.getElementById("saveProfile");

saveProfile.addEventListener("click", () => {
  saveProfile.textContent = "Salvo ✓";
  window.setTimeout(() => {
    saveProfile.textContent = "Salvar alterações";
  }, 1500);
});
