const form = document.querySelector("#itemForm");
const list = document.querySelector("#list");
const itemText = document.querySelector("#itemText");
const brand = document.querySelector("#brand");
const quantity = document.querySelector("#quantity");
const photo = document.querySelector("#photo");
const requestedBy = document.querySelector("#requestedBy");
const category = document.querySelector("#category");
const urgent = document.querySelector("#urgent");
const search = document.querySelector("#search");
const userFilter = document.querySelector("#userFilter");
const requesterFilters = document.querySelector("#requesterFilters");
const setupButton = document.querySelector("#setupButton");
const closeSetup = document.querySelector("#closeSetup");
const setupPanel = document.querySelector("#setupPanel");
const qrBox = document.querySelector("#qrBox");
const shareUrl = document.querySelector("#shareUrl");
const urlChoices = document.querySelector("#urlChoices");
const photoPreview = document.querySelector("#photoPreview");
const photoModal = document.querySelector("#photoModal");
const photoModalImage = document.querySelector("#photoModalImage");
const closePhoto = document.querySelector("#closePhoto");

const state = {
  items: [],
  filter: "needed",
  requester: "",
  query: "",
  shareUrl: window.location.origin + "/",
};

const categoryColors = {
  Produce: "green",
  Dairy: "blue",
  Meats: "coral",
  Frozen: "cyan",
  Pantry: "gold",
  Bakery: "brown",
  Drinks: "teal",
  Household: "gray",
  Personal: "rose",
  Other: "ink",
};

const categoryRules = [
  ["Produce", ["apple", "banana", "berry", "berries", "lettuce", "tomato", "onion", "potato", "carrot", "pepper", "avocado", "fruit", "salad"]],
  ["Dairy", ["milk", "cheese", "yogurt", "butter", "cream", "eggs", "sour cream"]],
  ["Meats", ["beef", "chicken", "pork", "turkey", "steak", "bacon", "sausage", "ham", "fish", "salmon", "shrimp"]],
  ["Frozen", ["frozen", "ice cream", "pizza rolls", "waffles", "popsicle"]],
  ["Bakery", ["bread", "bagel", "bun", "roll", "tortilla", "muffin", "donut"]],
  ["Drinks", ["water", "soda", "juice", "coffee", "tea", "gatorade", "beer"]],
  ["Household", ["paper towel", "toilet paper", "trash bag", "laundry", "soap", "detergent", "cleaner", "foil", "battery"]],
  ["Personal", ["shampoo", "conditioner", "toothpaste", "deodorant", "razor", "medicine", "lotion"]],
  ["Pantry", ["cereal", "rice", "pasta", "sauce", "beans", "soup", "chips", "cracker", "flour", "sugar", "oil"]],
];

let categoryTouched = false;

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
    .filter((item) => !state.requester || item.addedBy === state.requester)
    .filter((item) => !query || `${item.text} ${item.brand || ""} ${item.category} ${item.quantity} ${item.addedBy}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "needed" ? -1 : 1;
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function render() {
  renderRequesterFilters();
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
        ${item.photo ? `<button class="photo-thumb" type="button" data-action="photo" aria-label="View item photo"><img src="${item.photo}" alt=""></button>` : ""}
      </div>
      <button class="delete-button" type="button" data-action="delete" aria-label="Delete item">x</button>
    </article>
  `;
}

function renderRequesterFilters() {
  const neededItems = state.items.filter((item) => item.status === "needed");
  const counts = neededItems.reduce((result, item) => {
    const name = item.addedBy || "Unknown";
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  if (state.requester && !counts[state.requester]) state.requester = "";
  userFilter.hidden = names.length === 0;
  requesterFilters.innerHTML = [
    `<button type="button" class="${state.requester === "" ? "active" : ""}" data-requester="">Everyone <span>${neededItems.length}</span></button>`,
    ...names.map((name) => `
      <button type="button" class="${state.requester === name ? "active" : ""}" data-requester="${escapeHtml(name)}">
        ${escapeHtml(name)} <span>${counts[name]}</span>
      </button>
    `),
  ].join("");
}

function suggestedCategory(value) {
  const text = value.toLowerCase();
  const match = categoryRules.find(([, words]) => words.some((word) => text.includes(word)));
  return match ? match[0] : "Pantry";
}

function updateSuggestedCategory() {
  if (categoryTouched || !itemText.value.trim()) return;
  category.value = suggestedCategory(itemText.value);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function photoToDataUrl(file) {
  if (!file) return "";

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressed = canvas.toDataURL("image/jpeg", 0.72);
  if (compressed.length > 1400000) {
    throw new Error("Photo is too large. Try a closer or lower-resolution photo.");
  }
  return compressed;
}

async function renderPhotoPreview() {
  const file = photo.files && photo.files[0];
  if (!file) {
    photoPreview.hidden = true;
    photoPreview.innerHTML = "";
    return;
  }

  const url = URL.createObjectURL(file);
  photoPreview.innerHTML = `<img src="${url}" alt=""><span>${escapeHtml(file.name)}</span>`;
  photoPreview.hidden = false;
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
    const photoData = await photoToDataUrl(photo.files && photo.files[0]);
    await api("/api/items", {
      method: "POST",
      body: JSON.stringify({
        text,
        brand: brand.value,
        quantity: quantity.value,
        photo: photoData,
        addedBy,
        category: category.value,
        urgent: urgent.checked,
      }),
    });
    localStorage.setItem("grocery-helper-requested-by", addedBy);
    form.reset();
    requestedBy.value = addedBy;
    categoryTouched = false;
    category.value = "Pantry";
    photoPreview.hidden = true;
    photoPreview.innerHTML = "";
    itemText.focus();
    await loadItems();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector(".quick-row").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick]");
  if (!button) return;
  itemText.value = button.dataset.quick;
  updateSuggestedCategory();
  itemText.focus();
});

itemText.addEventListener("input", updateSuggestedCategory);
category.addEventListener("change", () => {
  categoryTouched = true;
});
photo.addEventListener("change", () => {
  renderPhotoPreview().catch(() => {
    photoPreview.hidden = true;
    photoPreview.innerHTML = "";
  });
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

requesterFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-requester]");
  if (!button) return;
  state.requester = button.dataset.requester || "";
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

  if (action === "photo") {
    photoModalImage.src = item.photo;
    photoModal.hidden = false;
    return;
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

closePhoto.addEventListener("click", () => {
  photoModal.hidden = true;
  photoModalImage.src = "";
});

photoModal.addEventListener("click", (event) => {
  if (event.target === photoModal) {
    photoModal.hidden = true;
    photoModalImage.src = "";
  }
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
