document.getElementById("globalSearch").addEventListener("input", (e) => {
  if (e.target.value && page !== "materials") {
    go("materials");
    document.getElementById("matSearch")?.focus();
    document.getElementById("matSearch").value = e.target.value;
    filterMaterials();
  }
});
startApp();
