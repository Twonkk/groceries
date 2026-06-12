const form = document.querySelector("#itemForm");
const list = document.querySelector("#list");
const itemText = document.querySelector("#itemText");
const brand = document.querySelector("#brand");
const quantity = document.querySelector("#quantity");
const requestedBy = document.querySelector("#requestedBy");
const category = document.querySelector("#category");
const urgent = document.querySelector("#urgent");
const search = document.querySelector("#search");
const setupButton = document.querySelector("#setupButton");
const closeSetup = document.querySelector("#closeSetup");
const setupPanel = document.querySelector("#setupPanel");
const qrBox = document.querySelector("#qrBox");
const shareUrl = document.querySelector("#shareUrl");
const urlChoices = document.querySelector("#urlChoices");

const state = {
  items: [],
  filter: "needed",
  query: "",
  shareUrl: window.location.origin + "/",
};

const categoryColors = {
  Groceries: "green",
  Household: "blue",
  Personal: "coral",
  Other: "gold",
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function visibleItems() {
  const query = state.query.toLowerCase();
  return state.items
    .filter((item) => state.filter === "all" || item.status === state.filter)
    .filter((item) => !query || `${item.text} ${item.brand || ""} ${item.category} ${item.quantity} ${item.addedBy}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "needed" ? -1 : 1;
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function render() {
  const items = visibleItems();
  if (!items.length) {
    list.innerHTML = document.querySelector("#emptyTemplate").innerHTML;
    return;
  }

  const grouped = items.reduce((groups, item) => {
    const key = item.category || "Other";
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});

  list.innerHTML = Object.entries(grouped)
    .map(([group, groupItems]) => `
      <div class="group">
        <div class="group-title">
          <span class="swatch ${categoryColors[group] || "gold"}"></span>
          <h2>${escapeHtml(group)}</h2>
          <span>${groupItems.length}</span>
        </div>
        ${groupItems.map(renderItem).join("")}
      </div>
    `)
    .join("");
}

function renderItem(item) {
  const picked = item.status === "picked";
  return `
    <article class="item ${picked ? "picked" : ""} ${item.urgent ? "urgent" : ""}" data-id="${item.id}">
      <button class="check-button" type="button" data-action="toggle" aria-label="${picked ? "Mark needed" : "Mark picked"}">
        <span aria-hidden="true">${picked ? "OK" : ""}</span>
      </button>
      <div class="item-body">
        <div class="item-main">
          <strong>${escapeHtml(item.text)}</strong>
          ${item.brand ? `<span class="brand">${escapeHtml(item.brand)}</span>` : ""}
          ${item.quantity ? `<span class="quantity">${escapeHtml(item.quantity)}</span>` : ""}
          ${item.urgent ? `<span class="need-soon">Soon</span>` : ""}
        </div>
        <div class="meta">
          ${item.addedBy ? `<span>Requested by ${escapeHtml(item.addedBy)}</span>` : ""}
          <span>${timeLabel(item.createdAt)}</span>
        </div>
      </div>
      <button class="delete-button" type="button" data-action="delete" aria-label="Delete item">x</button>
    </article>
  `;
}

async function loadItems() {
  const data = await api("/api/items");
  state.items = data.items || [];
  render();
}

async function loadMeta() {
  const meta = await api("/api/meta");
  const firstLan = (meta.urls || []).find((url) => !url.includes("localhost")) || window.location.origin + "/";
  setShareUrl(firstLan);
  renderUrlChoices(meta.urls || []);
}

function setShareUrl(url) {
  state.shareUrl = url;
  shareUrl.value = url;
  qrBox.innerHTML = "";

  try {
    qrBox.innerHTML = window.createQrSvg(url);
  } catch {
    qrBox.innerHTML = `<div class="qr-fallback">${escapeHtml(url)}</div>`;
  }
}

function renderUrlChoices(urls) {
  urlChoices.innerHTML = urls
    .map((url) => `<button type="button" data-url="${escapeHtml(url)}">${escapeHtml(url)}</button>`)
    .join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = itemText.value.trim();
  const addedBy = requestedBy.value.trim();
  if (!text || !addedBy) return;

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await api("/api/items", {
      method: "POST",
      body: JSON.stringify({
        text,
        brand: brand.value,
        quantity: quantity.value,
        addedBy,
        category: category.value,
        urgent: urgent.checked,
      }),
    });
    localStorage.setItem("grocery-helper-requested-by", addedBy);
    form.reset();
    requestedBy.value = addedBy;
    category.value = "Groceries";
    itemText.focus();
    await loadItems();
  } finally {
    button.disabled = false;
  }
});

document.querySelector(".quick-row").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick]");
  if (!button) return;
  itemText.value = button.dataset.quick;
  itemText.focus();
});

document.querySelector(".tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-filter]");
  if (!tab) return;
  state.filter = tab.dataset.filter;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button === tab));
  render();
});

search.addEventListener("input", () => {
  state.query = search.value;
  render();
});

list.addEventListener("click", async (event) => {
  const itemElement = event.target.closest(".item");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!itemElement || !action) return;

  const item = state.items.find((entry) => entry.id === itemElement.dataset.id);
  if (!item) return;

  if (action === "toggle") {
    await api(`/api/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: item.status === "picked" ? "needed" : "picked" }),
    });
  }

  if (action === "delete") {
    await api(`/api/items/${item.id}`, { method: "DELETE" });
  }

  await loadItems();
});

setupButton.addEventListener("click", async () => {
  setupPanel.hidden = false;
  await loadMeta();
  setupPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

closeSetup.addEventListener("click", () => {
  setupPanel.hidden = true;
});

shareUrl.addEventListener("focus", () => shareUrl.select());

urlChoices.addEventListener("click", (event) => {
  const button = event.target.closest("[data-url]");
  if (button) setShareUrl(button.dataset.url);
});

loadMeta().catch(() => {});
requestedBy.value = localStorage.getItem("grocery-helper-requested-by") || "";
loadItems().catch((error) => {
  list.innerHTML = `<div class="empty-state"><strong>${escapeHtml(error.message)}</strong></div>`;
});

setInterval(() => {
  if (!document.hidden) loadItems().catch(() => {});
}, 5000);
