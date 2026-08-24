/*
  Fuente de datos: Google Apps Script (Web App) que expone
  un endpoint doGet() con el catálogo en JSON, leído en vivo
  directamente de las pestañas del Sheet (sin el caché lento
  de "Publicar en la web").

  Formato de cada producto:
  id,name,desc,price,img,category,stock,sizes,active,original_price

  Categorías disponibles:
  ropa, calzado, accesorios, belleza, perfumes, vitaminas,
  entrega-inmediata, promociones

  Para que un producto aparezca en más de una categoría,
  sepáralas con coma:
  ropa,promociones

  Columna opcional "original_price": si la pones y es mayor al
  precio actual ("price"), el producto se agrega automáticamente
  también a "promociones" (sin escribirlo a mano) y se muestra el
  precio tachado en la tarjeta.
*/

const SHEET_JSON_URL =
  "https://script.google.com/macros/s/AKfycbz9hPjxGMUzHAgSNQo_PgwNnXthxFDckcdfpg9b9KZrLEDlrWI9_UfypsqW4PA8lW-7BA/exec";
let PRODUCTS = {
  ropa: [],
  calzado: [],
  accesorios: [],
  belleza: [],
  vitaminas: [],
  perfumes: [],
  "entrega-inmediata": [],
  promociones: [],
};

// Índice global id -> producto, usado para el modal de "ver en grande"
// y para poder compartir/abrir un producto sin importar la categoría
// desde la que se compartió.
let PRODUCT_INDEX = {};

let currentSearch = "";
let currentSort = "default";
let catalogStatus = "loading"; // "loading" | "ok" | "error"
let hasLoadedOnce = false;
let deepLinkHandled = false;

const DEMO_PRODUCTS = [
  {
    id: "ropa-001",
    name: "Prenda original",
    desc: "Agrega tus productos desde Google Sheets.",
    price: 0,
    img: "",
    category: "ropa",
    stock: true,
    sizes: ["S", "M", "L"],
  },
  {
    id: "inmediata-001",
    name: "Producto disponible",
    desc: "Producto listo para entrega inmediata.",
    price: 0,
    img: "",
    category: "entrega-inmediata",
    stock: true,
    sizes: [],
  },
  {
    id: "promo-001",
    name: "Oferta especial",
    desc: "Agrega aquí los productos que estén en promoción.",
    price: 0,
    img: "",
    category: "promociones",
    stock: true,
    sizes: [],
  },
];

function formatCOP(value) {
  const rounded = Math.round(Number(value) || 0);
  return `$${rounded.toLocaleString("es-CO")}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function addProduct(product) {
  const categories = String(product.category || "")
    .toLowerCase()
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);

  const originalPrice = Number(product.original_price) || 0;

  // Tallas / presentaciones. Si cada opción trae "nombre:precio"
  // (ej. "1 unidad:8000, caja x 6:45800, caja x 28:109000"), el
  // producto tiene precio por presentación y el precio cambia según
  // lo que el cliente elija en el selector. Si las opciones no traen
  // ":" (ej. tallas de ropa "S, M, L"), se sigue usando el precio
  // único de la columna "price" para todas.
  const sizesRaw = product.sizes
    ? String(product.sizes)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  const hasSizePricing =
    sizesRaw.length > 0 && sizesRaw.every((entry) => entry.includes(":"));

  const sizePrices = {};
  if (hasSizePricing) {
    sizesRaw.forEach((entry) => {
      const separatorIndex = entry.indexOf(":");
      const label = entry.slice(0, separatorIndex).trim();
      const rawPrice = entry.slice(separatorIndex + 1).trim();
      sizePrices[label] = Number(rawPrice.replace(/[^\d.-]/g, "")) || 0;
    });
  }

  const sizes = hasSizePricing
    ? sizesRaw.map((entry) => entry.slice(0, entry.indexOf(":")).trim())
    : sizesRaw;

  const price = hasSizePricing
    ? Math.min(...Object.values(sizePrices))
    : Number(product.price) || 0;

  const onSale = originalPrice > price;

  const item = {
    id: String(product.id),
    name: product.name || "Producto Sweet Girl",
    desc: product.desc || "",
    price,
    hasSizePricing,
    sizePrices,
    originalPrice: onSale ? originalPrice : 0,
    img: product.img || "",
    stock: String(product.stock || "").toLowerCase() !== "no",
    sizes,
    // Variantes tipo color/olor/sabor. Formato en el Sheet:
    // "Vainilla|https://imagen1.jpg, Flor de cerezo|https://imagen2.jpg"
    // La imagen es opcional: "Vainilla, Flor de cerezo" también funciona
    // y se muestra como una pastilla de texto en vez de una foto.
    variants: product.variants
      ? String(product.variants)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [name, img] = entry.split("|").map((part) => part.trim());
            return { name, img: img || "" };
          })
      : [],
  };

  // Si el producto trae "original_price" mayor al precio actual, se
  // considera en oferta y se agrega también a "promociones" sin
  // necesidad de escribirlo manualmente en la columna "category".
  if (onSale && !categories.includes("promociones")) {
    categories.push("promociones");
  }

  categories.forEach((category) => {
    if (!PRODUCTS[category]) return;
    const entry = { ...item, category };
    PRODUCTS[category].push(entry);
    // Guardamos la primera aparición de este id en el índice global.
    if (!PRODUCT_INDEX[item.id]) {
      PRODUCT_INDEX[item.id] = entry;
    }
  });
}

async function loadProducts(options = {}) {
  const { silent = false } = options;
  const previousProducts = PRODUCTS;
  const previousIndex = PRODUCT_INDEX;

  PRODUCTS = {
    ropa: [],
    calzado: [],
    accesorios: [],
    belleza: [],
    vitaminas: [],
    perfumes: [],
    "entrega-inmediata": [],
    promociones: [],
  };
  PRODUCT_INDEX = {};

  if (
    !SHEET_JSON_URL.trim() ||
    SHEET_JSON_URL.includes("PON_AQUI_TU_ID_DE_IMPLEMENTACION")
  ) {
    DEMO_PRODUCTS.forEach(addProduct);
    catalogStatus = "ok";
    hasLoadedOnce = true;
    return;
  }

  try {
    // Se agrega un parámetro con la hora actual para evitar que el
    // navegador (o algún proxy) devuelva una copia vieja en caché.
    // El Web App de Apps Script consulta el Sheet en vivo en cada
    // solicitud, así que aquí no hay caché lento de Google de por medio.
    const cacheBustedUrl = `${SHEET_JSON_URL}?_=${Date.now()}`;
    const response = await fetch(cacheBustedUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("No se pudo cargar el catálogo.");
    }

    const data = await response.json();
    const products = Array.isArray(data.products) ? data.products : [];

    products.forEach((product) => {
      if (!product.id || !product.category) return;
      if (String(product.active).toLowerCase() === "no") return;

      addProduct(product);
    });

    catalogStatus = "ok";
  } catch (error) {
    console.error("Error cargando productos:", error);
    // Si ya habíamos cargado el catálogo antes (por ejemplo, en un
    // refresco automático que falló), no borramos lo que el usuario
    // ya estaba viendo: solo marcamos el error para el próximo render.
    PRODUCTS = previousProducts;
    PRODUCT_INDEX = previousIndex;
    catalogStatus = "error";
  } finally {
    hasLoadedOnce = true;
  }
}

function getCurrentProducts() {
  const category = document.body.dataset.category;
  let items = [...(PRODUCTS[category] || [])];

  if (currentSearch.trim()) {
    const search = currentSearch.toLowerCase();

    items = items.filter((product) =>
      `${product.name} ${product.desc}`.toLowerCase().includes(search),
    );
  }

  if (currentSort === "price-asc") {
    items.sort((a, b) => a.price - b.price);
  }

  if (currentSort === "price-desc") {
    items.sort((a, b) => b.price - a.price);
  }

  return items;
}

// Dibuja los swatches de variante (color/olor/sabor) para la tarjeta
// ("card") o el modal ("modal"). Cada swatch guarda su nombre en
// data-variant-name y, si tiene foto, en data-variant-img.
function renderVariantSwatches(product, id, scope) {
  if (!product.variants.length) return "";

  const idAttr = `data-variant-for="${id}" data-variant-scope="${scope}"`;

  return `
    <div class="variant-swatches" ${idAttr} role="group" aria-label="Elige una opción de ${escapeHtml(product.name)}">
      ${product.variants
        .map((variant, index) => {
          const safeName = escapeHtml(variant.name);
          const style = variant.img
            ? `style="background-image:url('${escapeHtml(variant.img)}')"`
            : "";

          return `
            <button
              type="button"
              class="variant-swatch ${variant.img ? "has-img" : "text-only"} ${index === 0 ? "selected" : ""}"
              data-variant-name="${safeName}"
              data-variant-img="${escapeHtml(variant.img)}"
              title="${safeName}"
              aria-label="${safeName}"
              ${product.stock ? "" : "disabled"}
              onclick="event.stopPropagation(); selectVariant('${id}', '${scope}', this)"
              ${style}
            >
              ${variant.img ? "" : safeName.charAt(0)}
            </button>
          `;
        })
        .join("")}
      <span class="variant-selected-name" data-variant-label-for="${id}" data-variant-scope="${scope}">${escapeHtml(product.variants[0].name)}</span>
    </div>
  `;
}

// Marca el swatch elegido, actualiza el nombre visible y cambia la
// foto principal si esa variante trae imagen propia.
function selectVariant(id, scope, button) {
  const group = button.closest(`[data-variant-for="${CSS.escape(id)}"]`);
  if (!group) return;

  group
    .querySelectorAll(".variant-swatch")
    .forEach((swatch) => swatch.classList.remove("selected"));
  button.classList.add("selected");

  const label = document.querySelector(
    `[data-variant-label-for="${CSS.escape(id)}"][data-variant-scope="${scope}"]`,
  );
  if (label) label.textContent = button.dataset.variantName;

  const variantImg = button.dataset.variantImg;
  if (variantImg) {
    if (scope === "card") {
      const media = document.querySelector(
        `[data-media-for="${CSS.escape(id)}"] img`,
      );
      if (media) media.src = variantImg;
    } else {
      const modalImg = document.getElementById("sgModalImg");
      if (modalImg) modalImg.src = variantImg;
    }
  }
}

function getSelectedVariant(id, scope) {
  const group = document.querySelector(
    `[data-variant-for="${CSS.escape(id)}"][data-variant-scope="${scope}"]`,
  );
  if (!group) return null;

  const selected = group.querySelector(".variant-swatch.selected");
  if (!selected) return null;

  return {
    name: selected.dataset.variantName,
    img: selected.dataset.variantImg || "",
  };
}

function renderProductCount(count) {
  const countElement = document.getElementById("productCount");
  if (!countElement) return;

  if (!count) {
    countElement.textContent = "";
    return;
  }

  countElement.textContent = count === 1 ? "1 producto" : `${count} productos`;
}

// Ícono de compartir (flecha hacia arriba saliendo de una caja),
// el mismo estilo usado en la referencia que compartiste.
const SHARE_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 16V4"></path>
    <path d="M7 9l5-5 5 5"></path>
    <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"></path>
  </svg>
`;

function renderProducts() {
  const grid = document.getElementById("productGrid");

  if (!grid) return;

  if (!hasLoadedOnce) {
    grid.innerHTML = Array.from({ length: 6 })
      .map(
        () => `
          <article class="product-card skeleton-card" aria-hidden="true">
            <div class="product-media skeleton-block"></div>
            <div class="product-body">
              <div class="skeleton-line skeleton-line-title"></div>
              <div class="skeleton-line skeleton-line-text"></div>
            </div>
          </article>
        `,
      )
      .join("");
    renderProductCount(0);
    return;
  }

  if (catalogStatus === "error") {
    grid.innerHTML = `
      <div class="empty-message">
        <h3>No pudimos cargar el catálogo</h3>
        <p>
          Ocurrió un problema al conectar con nuestro catálogo. Verifica tu
          conexión e inténtalo de nuevo.
        </p>
        <button
          type="button"
          class="btn btn-outline"
          onclick="refreshProductsNow()"
        >
          Reintentar
        </button>
      </div>
    `;
    renderProductCount(0);
    return;
  }

  const products = getCurrentProducts();

  if (!products.length) {
    grid.innerHTML = `
      <div class="empty-message">
        <h3>Próximamente</h3>
        <p>Aún no tenemos productos disponibles en esta categoría.</p>
      </div>
    `;
    renderProductCount(0);
    return;
  }

  renderProductCount(products.length);

  grid.innerHTML = products
    .map((product) => {
      const id = escapeHtml(product.id);
      const name = escapeHtml(product.name);
      const desc = escapeHtml(product.desc);

      const image = product.img
        ? `<img src="${escapeHtml(product.img)}" alt="${name}">`
        : `<span class="initial">${name.charAt(0)}</span>`;

      const sizePlaceholder = product.hasSizePricing
        ? "Selecciona una opción"
        : "Selecciona talla";

      const sizeSelect = product.sizes.length
        ? `
          <select
            class="size-select"
            data-size-for="${id}"
            aria-label="${escapeHtml(sizePlaceholder)} de ${name}"
            ${product.stock ? "" : "disabled"}
            ${product.hasSizePricing ? `onchange="updateSizePrice('${id}', 'card', this.value)"` : ""}
          >
            ${product.stock ? `<option value="">${escapeHtml(sizePlaceholder)}</option>` : ""}
            ${product.sizes
              .map(
                (size, index) =>
                  `<option value="${escapeHtml(size)}" ${!product.stock && index === 0 ? "selected" : ""}>${escapeHtml(size)}</option>`,
              )
              .join("")}
          </select>
        `
        : "";

      const variantSwatches = renderVariantSwatches(product, id, "card");

      return `
        <article class="product-card" data-product-id="${id}">
          <div
            class="product-media sg-clickable-media"
            data-media-for="${id}"
            onclick="openProductModal('${id}')"
            role="button"
            tabindex="0"
            aria-label="Ver ${name} en grande"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductModal('${id}');}"
          >
            <button
              type="button"
              class="sg-share-btn"
              aria-label="Compartir ${name}"
              onclick="event.stopPropagation(); shareProduct('${id}')"
            >
              ${SHARE_ICON_SVG}
            </button>
            ${image}
            ${product.stock ? "" : '<span class="stock-badge">Agotado</span>'}
          </div>

          <div class="product-body">
            <h3>${name}</h3>
            <p class="desc">${desc}</p>
            ${variantSwatches}
            ${sizeSelect}

            <div class="product-foot">
              <span class="price-wrap">
                ${
                  product.originalPrice
                    ? `<span class="price-original">${formatCOP(product.originalPrice)}</span>`
                    : ""
                }
                <span class="price" data-price-for="${id}" data-price-scope="card">${
                  product.hasSizePricing
                    ? `Desde ${formatCOP(product.price)}`
                    : formatCOP(product.price)
                }</span>
              </span>
              <button
                class="add-btn"
                data-id="${id}"
                ${product.stock ? "" : "disabled"}
                onclick="event.stopPropagation(); addProductFromCard('${id}')"
              >
                ${product.stock ? "Agregar" : "Agotado"}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

// Actualiza el precio visible (en la tarjeta o en el modal) cuando el
// cliente elige una presentación/talla que tiene su propio precio.
function updateSizePrice(id, scope, sizeValue) {
  const product = PRODUCT_INDEX[id];
  if (!product || !product.hasSizePricing) return;

  const priceElement =
    scope === "modal"
      ? document.getElementById("sgModalPrice")
      : document.querySelector(
          `[data-price-for="${CSS.escape(id)}"][data-price-scope="card"]`,
        );

  if (!priceElement) return;

  if (sizeValue && product.sizePrices[sizeValue] != null) {
    priceElement.textContent = formatCOP(product.sizePrices[sizeValue]);
  } else {
    priceElement.textContent = `Desde ${formatCOP(product.price)}`;
  }
}

// Para productos con precio por presentación, devuelve el precio de la
// opción elegida; si no aplica, devuelve el precio único del producto.
function resolveSelectedPrice(product, size) {
  if (!product) return 0;
  if (product.hasSizePricing && size && product.sizePrices[size] != null) {
    return product.sizePrices[size];
  }
  return product.price;
}

function addProductFromCard(id) {
  const sizeElement = document.querySelector(
    `[data-size-for="${CSS.escape(id)}"]`,
  );

  const size = sizeElement ? sizeElement.value : "";

  if (sizeElement && !size) {
    alert(
      PRODUCT_INDEX[id]?.hasSizePricing
        ? "Por favor selecciona una opción."
        : "Por favor selecciona una talla.",
    );
    return;
  }

  const product = PRODUCT_INDEX[id];
  const variant = getSelectedVariant(id, "card");
  const price = resolveSelectedPrice(product, size);

  addToCart(
    id,
    size || null,
    variant ? variant.name : null,
    variant ? variant.img : null,
    price,
  );
}

async function refreshProductsNow() {
  const button = document.getElementById("refreshBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "Actualizando...";
  }

  await loadProducts({ silent: true });
  renderProducts();

  if (typeof renderCart === "function") {
    renderCart();
  }

  if (button) {
    button.disabled = false;
    button.textContent = "Actualizar";
  }

  maybeOpenDeepLinkedProduct();
}

function setupCatalog() {
  const searchInput = document.getElementById("searchInput");
  const sortSelect = document.getElementById("sortSelect");

  searchInput?.addEventListener("input", (event) => {
    currentSearch = event.target.value;
    renderProducts();
  });

  sortSelect?.addEventListener("change", (event) => {
    currentSort = event.target.value;
    renderProducts();
  });

  renderProducts();
}

/* ============================================================
   COMPARTIR PRODUCTO
   ============================================================ */

function buildProductShareUrl(id) {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.set("producto", id);
  return url.toString();
}

function showSgToast(message) {
  let toast = document.getElementById("sgToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sgToast";
    toast.className = "sg-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.remove("sg-toast-show");
  // Forzamos reflow para poder reiniciar la animación si ya estaba visible.
  void toast.offsetWidth;
  toast.classList.add("sg-toast-show");

  clearTimeout(showSgToast._timer);
  showSgToast._timer = setTimeout(() => {
    toast.classList.remove("sg-toast-show");
  }, 2200);
}

async function shareProduct(id) {
  const product = PRODUCT_INDEX[id];
  if (!product) return;

  const url = buildProductShareUrl(id);
  const shareData = {
    title: `${product.name} | Sweet Girl`,
    text: product.desc ? `${product.name} - ${product.desc}` : product.name,
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      // Si el usuario cancela el share nativo, no hacemos nada más.
      if (error && error.name === "AbortError") return;
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      showSgToast("Enlace copiado ✅");
      return;
    } catch (error) {
      // Sigue al fallback de abajo.
    }
  }

  window.prompt("Copia el enlace del producto:", url);
}

/* ============================================================
   MODAL "VER EN GRANDE"
   ============================================================ */

function ensureProductModal() {
  let modal = document.getElementById("sgProductModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "sgProductModal";
  modal.className = "sg-modal-overlay";
  modal.innerHTML = `
    <div class="sg-modal" role="dialog" aria-modal="true" aria-labelledby="sgModalTitle">
      <button type="button" class="sg-modal-close" aria-label="Cerrar" onclick="closeProductModal()">✕</button>
      <div class="sg-modal-media">
        <button type="button" class="sg-share-btn sg-modal-share" id="sgModalShareBtn" aria-label="Compartir producto">
          ${SHARE_ICON_SVG}
        </button>
        <img id="sgModalImg" src="" alt="" />
        <span id="sgModalStockBadge" class="stock-badge" hidden>Agotado</span>
      </div>
      <div class="sg-modal-body">
        <h3 id="sgModalTitle"></h3>
        <p id="sgModalDesc" class="desc"></p>
        <div id="sgModalVariantWrap"></div>
        <div id="sgModalSizeWrap"></div>
        <div class="product-foot">
          <span class="price-wrap">
            <span id="sgModalPriceOriginal" class="price-original" hidden></span>
            <span id="sgModalPrice" class="price"></span>
          </span>
          <button type="button" class="add-btn" id="sgModalAddBtn" data-id="">Agregar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeProductModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("sg-modal-open")) {
      closeProductModal();
    }
  });

  return modal;
}

function openProductModal(id) {
  const product = PRODUCT_INDEX[id];
  if (!product) return;

  const modal = ensureProductModal();

  const img = document.getElementById("sgModalImg");
  const title = document.getElementById("sgModalTitle");
  const desc = document.getElementById("sgModalDesc");
  const priceEl = document.getElementById("sgModalPrice");
  const priceOriginalEl = document.getElementById("sgModalPriceOriginal");
  const stockBadge = document.getElementById("sgModalStockBadge");
  const sizeWrap = document.getElementById("sgModalSizeWrap");
  const addBtn = document.getElementById("sgModalAddBtn");
  const shareBtn = document.getElementById("sgModalShareBtn");

  if (product.img) {
    img.src = product.img;
    img.alt = product.name;
    img.style.display = "";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
  }

  title.textContent = product.name;
  desc.textContent = product.desc || "";

  if (product.originalPrice) {
    priceOriginalEl.hidden = false;
    priceOriginalEl.textContent = formatCOP(product.originalPrice);
  } else {
    priceOriginalEl.hidden = true;
  }
  priceEl.textContent = product.hasSizePricing
    ? `Desde ${formatCOP(product.price)}`
    : formatCOP(product.price);

  stockBadge.hidden = product.stock;

  const variantWrap = document.getElementById("sgModalVariantWrap");
  variantWrap.innerHTML = renderVariantSwatches(product, product.id, "modal");
  if (product.variants.length && product.variants[0].img) {
    img.src = product.variants[0].img;
  }

  if (product.sizes.length) {
    const sizePlaceholder = product.hasSizePricing
      ? "Selecciona una opción"
      : "Selecciona talla";

    sizeWrap.innerHTML = `
      <select
        id="sgModalSizeSelect"
        class="size-select"
        aria-label="${escapeHtml(sizePlaceholder)} de ${escapeHtml(product.name)}"
        ${product.stock ? "" : "disabled"}
        ${product.hasSizePricing ? `onchange="updateSizePrice('${product.id}', 'modal', this.value)"` : ""}
      >
        ${product.stock ? `<option value="">${escapeHtml(sizePlaceholder)}</option>` : ""}
        ${product.sizes
          .map(
            (size, index) =>
              `<option value="${escapeHtml(size)}" ${!product.stock && index === 0 ? "selected" : ""}>${escapeHtml(size)}</option>`,
          )
          .join("")}
      </select>
    `;
  } else {
    sizeWrap.innerHTML = "";
  }

  addBtn.disabled = !product.stock;
  addBtn.textContent = product.stock ? "Agregar" : "Agotado";
  addBtn.dataset.id = product.id;
  addBtn.onclick = () => addProductFromModal(product.id);

  shareBtn.onclick = () => shareProduct(product.id);

  modal.classList.add("sg-modal-open");
  document.body.classList.add("sg-modal-locked");

  // Reflejamos el producto abierto en la URL para poder compartirlo.
  const url = new URL(window.location.href);
  url.searchParams.set("producto", product.id);
  window.history.replaceState({}, "", url);
}

function closeProductModal() {
  const modal = document.getElementById("sgProductModal");
  if (!modal) return;

  modal.classList.remove("sg-modal-open");
  document.body.classList.remove("sg-modal-locked");

  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  window.history.replaceState({}, "", url);
}

function addProductFromModal(id) {
  const sizeSelect = document.getElementById("sgModalSizeSelect");
  const size = sizeSelect ? sizeSelect.value : "";
  const product = PRODUCT_INDEX[id];

  if (sizeSelect && !size) {
    alert(
      product && product.hasSizePricing
        ? "Por favor selecciona una opción."
        : "Por favor selecciona una talla.",
    );
    return;
  }

  const variant = getSelectedVariant(id, "modal");
  const price = resolveSelectedPrice(product, size);

  addToCart(
    id,
    size || null,
    variant ? variant.name : null,
    variant ? variant.img : null,
    price,
  );
  closeProductModal();
}

function maybeOpenDeepLinkedProduct() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("producto");
  if (!id || !PRODUCT_INDEX[id]) return;

  openProductModal(id);
  deepLinkHandled = true;
}

window.PRODUCTS_READY = loadProducts();

document.addEventListener("DOMContentLoaded", async () => {
  // Muestra el skeleton de inmediato en vez de esperar a que
  // termine la primera carga del catálogo.
  renderProducts();

  await window.PRODUCTS_READY;
  setupCatalog();
  maybeOpenDeepLinkedProduct();
});

setInterval(async () => {
  if (document.hidden) return;

  await loadProducts({ silent: true });
  renderProducts();

  if (typeof renderCart === "function") {
    renderCart();
  }

  if (!deepLinkHandled) {
    maybeOpenDeepLinkedProduct();
  }
}, 45000);
