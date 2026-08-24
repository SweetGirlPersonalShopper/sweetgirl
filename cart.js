const WHATSAPP_NUMBER = "16465381517";
const CART_KEY = "sweet_girl_cart";

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCart();
}

function findProduct(id) {
  for (const category of Object.keys(PRODUCTS)) {
    const product = PRODUCTS[category].find((item) => item.id === id);
    if (product) return product;
  }

  return null;
}

function addToCart(
  id,
  size = null,
  variant = null,
  variantImg = null,
  price = null,
) {
  const cart = getCart();
  const lineId = [id, size, variant].filter(Boolean).join("__");
  const line = cart.find((item) => item.lineId === lineId);
  const product = findProduct(id);
  // Guardamos el precio de la línea explícitamente: si el producto tiene
  // precio por presentación (ej. "1 unidad" vs "caja x 28"), product.price
  // solo trae el precio más bajo de referencia, así que necesitamos el
  // precio real que se eligió en ese momento.
  const finalPrice = price != null ? price : product ? product.price : 0;

  if (line) {
    line.quantity += 1;
    line.price = finalPrice;
  } else {
    cart.push({
      id,
      size,
      variant,
      variantImg: variantImg || "",
      lineId,
      quantity: 1,
      price: finalPrice,
    });
  }

  saveCart(cart);
  flashAddedButton(id);
  openCart();
}

function changeQuantity(lineId, amount) {
  const cart = getCart();
  const line = cart.find((item) => item.lineId === lineId);

  if (!line) return;

  const nextQuantity = line.quantity + amount;

  if (nextQuantity <= 0) {
    // Bajar la cantidad a 0 elimina el producto: pedimos confirmación
    // porque es fácil llegar aquí sin querer haciendo clic varias veces.
    const product = findProduct(line.id);

    showConfirmModal({
      title: "Quitar producto",
      message: `¿Quitar "${product ? product.name : "este producto"}" del carrito?`,
      confirmLabel: "Quitar",
      cancelLabel: "Cancelar",
      onConfirm: () => removeFromCart(lineId),
    });
    return;
  }

  line.quantity = nextQuantity;
  saveCart(cart);
}

function removeFromCart(lineId) {
  const cart = getCart();
  const removedLine = cart.find((line) => line.lineId === lineId);

  saveCart(cart.filter((line) => line.lineId !== lineId));

  if (removedLine) {
    showUndoToast(removedLine);
  }
}

function cartCount(cart) {
  return cart.reduce((total, line) => total + line.quantity, 0);
}

function cartTotal(cart) {
  return cart.reduce((total, line) => {
    const product = findProduct(line.id);
    if (!product) return total;
    const unitPrice = line.price != null ? line.price : product.price;
    return total + unitPrice * line.quantity;
  }, 0);
}

function flashAddedButton(id) {
  const buttons = document.querySelectorAll(
    `.add-btn[data-id="${CSS.escape(id)}"]`,
  );

  buttons.forEach((button) => {
    const text = button.textContent;
    button.textContent = "Agregado ✓";
    button.classList.add("added");

    setTimeout(() => {
      button.textContent = text;
      button.classList.remove("added");
    }, 1200);
  });
}

// ---------- Toast "Producto eliminado · Deshacer" ----------

let undoToastTimeout = null;

function showUndoToast(removedLine) {
  clearTimeout(undoToastTimeout);

  let toast = document.getElementById("cartToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "cartToast";
    toast.className = "cart-toast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <span>Producto eliminado</span>
    <button type="button" id="cartUndoBtn">Deshacer</button>
  `;
  toast.classList.add("show");

  document.getElementById("cartUndoBtn").addEventListener("click", () => {
    const cart = getCart();
    cart.push(removedLine);
    saveCart(cart);
    toast.classList.remove("show");
    clearTimeout(undoToastTimeout);
  });

  undoToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 5000);
}

// ---------- Modal de confirmación (reemplaza window.confirm) ----------

function showConfirmModal({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div
      class="confirm-box"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmTitle"
      aria-describedby="confirmMsg"
    >
      <h4 id="confirmTitle">${title}</h4>
      <p id="confirmMsg">${message}</p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" data-action="cancel">
          ${cancelLabel}
        </button>
        <button type="button" class="btn btn-primary" data-action="confirm">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const confirmBtn = overlay.querySelector('[data-action="confirm"]');
  const cancelBtn = overlay.querySelector('[data-action="cancel"]');
  const previouslyFocused = document.activeElement;

  function cleanup() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    previouslyFocused?.focus?.();
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      cleanup();
      onCancel?.();
    }
  }

  confirmBtn.addEventListener("click", () => {
    cleanup();
    onConfirm?.();
  });

  cancelBtn.addEventListener("click", () => {
    cleanup();
    onCancel?.();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      cleanup();
      onCancel?.();
    }
  });

  document.addEventListener("keydown", onKeydown);
  confirmBtn.focus();
}

// ---------- Productos relacionados (llena el espacio vacío del carrito) ----------

function renderRelatedProducts(cart) {
  const container = document.getElementById("cartRelated");

  if (!container) return;

  // Solo mostramos sugerencias cuando el carrito tiene pocos productos:
  // con muchos productos el espacio ya está lleno y no hace falta.
  if (!cart.length || cart.length > 2) {
    container.innerHTML = "";
    return;
  }

  const cartIds = new Set(cart.map((line) => line.id));
  const firstProduct = findProduct(cart[0].id);
  const preferredCategory = firstProduct ? firstProduct.category : null;

  let pool = preferredCategory ? [...(PRODUCTS[preferredCategory] || [])] : [];
  pool = pool.filter((product) => !cartIds.has(product.id) && product.stock);

  if (pool.length < 3) {
    const allProducts = Object.values(PRODUCTS).flat();
    const extra = allProducts.filter(
      (product) =>
        !cartIds.has(product.id) &&
        product.stock &&
        !pool.some((existing) => existing.id === product.id),
    );
    pool = pool.concat(extra);
  }

  const picks = pool.slice(0, 3);

  if (!picks.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <p class="cart-related-title">También te puede interesar</p>
    <div class="cart-related-grid">
      ${picks
        .map((product) => {
          const name = escapeHtml(product.name);
          const image = product.img
            ? `<img src="${escapeHtml(product.img)}" alt="${name}">`
            : `<span>${name.charAt(0)}</span>`;

          return `
            <a class="cart-related-item" href="${product.category}.html">
              <span class="cart-related-media">${image}</span>
              <span class="cart-related-name">${name}</span>
              <span class="cart-related-price">${formatCOP(product.price)}</span>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

// ---------- Nota de envío (varía por destino y peso, no por monto) ----------

function renderShippingNote() {
  const element = document.getElementById("cartShipping");

  if (!element || element.dataset.rendered) return;

  element.dataset.rendered = "true";
  element.innerHTML = `
    <p class="shipping-note">
      Envío ≈ $15.000 en Medellín y el área metropolitana. Fuera de esa
      zona, el valor varía según destino y peso del paquete —
      te lo confirmamos por WhatsApp.
    </p>
  `;
}

// ---------- Render principal del carrito ----------

function renderCart() {
  const cart = getCart();
  const itemsElement = document.getElementById("cartItems");
  const totalElement = document.getElementById("cartTotal");
  const sendButton = document.getElementById("cartSendBtn");
  const clearButton = document.getElementById("cartClearBtn");
  const headingElement = document.getElementById("cartHeading");

  const items = cartCount(cart);

  document.querySelectorAll(".cart-count").forEach((element) => {
    element.textContent = items;
    element.style.display = items ? "flex" : "none";
  });

  if (headingElement) {
    headingElement.textContent = items ? `Tu carrito (${items})` : "Tu carrito";
  }

  if (!itemsElement) return;

  const validLines = cart.filter((line) => findProduct(line.id));

  if (clearButton) {
    clearButton.style.display = validLines.length ? "inline-flex" : "none";
  }

  if (!validLines.length) {
    itemsElement.innerHTML = `
      <div class="cart-empty">
        <img src="multimedia/logo.jpg" alt="Sweet Girl" class="cart-empty-logo">
        <p>Tu carrito está vacío.<br>Agrega tus productos favoritos.</p>
      </div>
    `;

    totalElement.textContent = formatCOP(0);
    sendButton.disabled = true;
    renderRelatedProducts([]);
    return;
  }

  itemsElement.innerHTML = validLines
    .map((line) => {
      const product = findProduct(line.id);

      const lineImgSrc = line.variantImg || product.img;
      const image = lineImgSrc
        ? `<img src="${lineImgSrc}" alt="${product.name}">`
        : `<span>${product.name.charAt(0)}</span>`;

      const unitPrice = line.price != null ? line.price : product.price;

      const unitPriceRow =
        line.quantity > 1
          ? `<span class="line-unit-price">${formatCOP(unitPrice)} c/u</span>`
          : "";

      return `
        <div class="cart-line">
          <div class="line-media">${image}</div>

          <div class="line-info">
            <h5>
              ${product.name}
              ${line.variant ? `<small> · ${line.variant}</small>` : ""}
              ${line.size ? `<small> · ${line.size}</small>` : ""}
            </h5>

            <div class="line-qty">
              <button class="qty-btn" onclick="changeQuantity('${line.lineId}', -1)">−</button>
              <span>${line.quantity}</span>
              <button class="qty-btn" onclick="changeQuantity('${line.lineId}', 1)">+</button>
            </div>

            <button class="line-remove" onclick="removeFromCart('${line.lineId}')">
              Quitar
            </button>
          </div>

          <span class="line-price">
            ${unitPriceRow}
            <strong>${formatCOP(unitPrice * line.quantity)}</strong>
          </span>
        </div>
      `;
    })
    .join("");

  const total = cartTotal(validLines);

  totalElement.textContent = formatCOP(total);
  sendButton.disabled = false;

  renderRelatedProducts(validLines);
}

// ---------- Abrir / cerrar el drawer ----------

let lastFocusedBeforeCart = null;

function openCart() {
  lastFocusedBeforeCart = document.activeElement;

  document.getElementById("cartOverlay")?.classList.add("open");
  document.getElementById("cartDrawer")?.classList.add("open");

  document.getElementById("cartClose")?.focus();
}

function closeCart() {
  document.getElementById("cartOverlay")?.classList.remove("open");
  document.getElementById("cartDrawer")?.classList.remove("open");

  lastFocusedBeforeCart?.focus?.();
}

function clearCart() {
  const cart = getCart();

  if (!cart.length) return;

  showConfirmModal({
    title: "Vaciar carrito",
    message: "¿Seguro que quieres quitar todos los productos del carrito?",
    confirmLabel: "Vaciar",
    cancelLabel: "Cancelar",
    onConfirm: () => saveCart([]),
  });
}

function sendCartToWhatsApp() {
  const cart = getCart().filter((line) => findProduct(line.id));

  if (!cart.length) return;

  let message = "Hola Sweet Girl ✨ quiero consultar por este pedido:\n\n";

  cart.forEach((line) => {
    const product = findProduct(line.id);
    const unitPrice = line.price != null ? line.price : product.price;
    const details = [line.variant, line.size].filter(Boolean).join(", ");
    const detailsText = details ? ` (${details})` : "";

    message += `• ${product.name}${detailsText} x${line.quantity} — ${formatCOP(
      unitPrice * line.quantity,
    )}\n`;
  });

  message += `\nTotal: ${formatCOP(cartTotal(cart))}\n\n`;
  message +=
    "Estoy en: \n\n¿Me confirmas disponibilidad, precio final y forma de envío?";

  window.open(
    `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`,
    "_blank",
    "noopener",
  );

  // Evita que el mismo pedido se vuelva a enviar por error si el
  // cliente vuelve a abrir el carrito más tarde.
  showConfirmModal({
    title: "Pedido enviado",
    message:
      "Abrimos WhatsApp con tu pedido. ¿Quieres vaciar el carrito ahora?",
    confirmLabel: "Vaciar carrito",
    cancelLabel: "Mantener carrito",
    onConfirm: () => {
      saveCart([]);
      closeCart();
    },
  });
}

// ---------- Accesibilidad: atrapar el foco (Tab) dentro del drawer ----------

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

function injectCart() {
  const overlay = document.createElement("div");
  overlay.id = "cartOverlay";
  overlay.className = "cart-overlay";
  overlay.addEventListener("click", closeCart);

  const drawer = document.createElement("aside");
  drawer.id = "cartDrawer";
  drawer.className = "cart-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "cartHeading");

  drawer.innerHTML = `
    <div class="cart-head">
      <h3 id="cartHeading">Tu carrito</h3>
      <button id="cartClose" class="cart-close" aria-label="Cerrar carrito" onclick="closeCart()">×</button>
    </div>

    <div class="cart-items" id="cartItems"></div>

    <div class="cart-related" id="cartRelated"></div>

    <div class="cart-foot">
      <div class="cart-shipping" id="cartShipping"></div>

      <div class="cart-total-row">
        <span>Total</span>
        <span id="cartTotal">$0</span>
      </div>

      <button class="btn btn-wa btn-block" id="cartSendBtn" onclick="sendCartToWhatsApp()">
        Enviar consulta por WhatsApp
      </button>

      <button type="button" id="cartClearBtn" class="cart-clear-btn" onclick="clearCart()">
        Vaciar carrito
      </button>

      <p class="cart-note">
        Confirmamos disponibilidad, precio final y envío por WhatsApp.
      </p>
    </div>
  `;

  document.body.append(overlay, drawer);

  renderShippingNote();

  document.querySelectorAll("[data-cart-toggle]").forEach((button) => {
    button.addEventListener("click", openCart);
  });

  document.addEventListener("keydown", (event) => {
    if (!drawer.classList.contains("open")) return;

    if (event.key === "Escape") {
      closeCart();
      return;
    }

    if (event.key === "Tab") {
      const focusable = getFocusableElements(drawer);

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Mantiene el carrito sincronizado si el cliente tiene el sitio
  // abierto en varias pestañas al mismo tiempo.
  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) {
      renderCart();
    }
  });

  const menuToggle = document.getElementById("menuToggle");
  const navigation = document.querySelector(".main-nav");

  menuToggle?.addEventListener("click", () => {
    navigation?.classList.toggle("open");
  });

  navigation?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navigation.classList.remove("open");
    });
  });

  const whatsappButton = document.createElement("a");
  whatsappButton.className = "fab-wa";
  whatsappButton.href = `https://wa.me/${WHATSAPP_NUMBER}`;
  whatsappButton.target = "_blank";
  whatsappButton.rel = "noopener";
  whatsappButton.setAttribute("aria-label", "Escríbenos por WhatsApp");
  whatsappButton.innerHTML = `
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path fill="#ffffff" d="M16.02 3.2A12.8 12.8 0 0 0 5.1 22.67L3.2 28.8l6.3-1.84A12.8 12.8 0 1 0 16.02 3.2Zm0 23.25a10.42 10.42 0 0 1-5.3-1.45l-.38-.23-3.74 1.09 1.1-3.65-.25-.38a10.42 10.42 0 1 1 8.57 4.62Zm5.7-7.82c-.31-.16-1.82-.9-2.1-1-.28-.1-.48-.16-.69.16-.2.3-.79 1-.96 1.2-.18.21-.35.24-.66.08-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.8-1.68-2.1-.17-.31-.02-.48.13-.63.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.16-.69-1.66-.95-2.28-.25-.6-.5-.51-.69-.52h-.59c-.2 0-.52.08-.8.38-.27.3-1.05 1.03-1.05 2.52 0 1.48 1.08 2.92 1.23 3.12.15.2 2.12 3.23 5.13 4.53.72.3 1.28.49 1.72.62.72.23 1.37.2 1.89-.12.58-.36 1.82-1.08 2.08-2.12.26-1.04.26-1.93.18-2.12-.07-.2-.27-.3-.58-.45Z"/>
  </svg>
`;

  document.body.appendChild(whatsappButton);
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.PRODUCTS_READY;
  injectCart();
});
