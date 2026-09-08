/* ============================================================
   AVISO DE COOKIES · Sweet Girl
   Muestra una barra inferior la primera vez que alguien visita
   el sitio y recuerda su elección (aceptar / rechazar) en
   localStorage para no volver a preguntar.
   ============================================================ */

(function () {
  const STORAGE_KEY = "sg_cookie_consent"; // "accepted" | "rejected"

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Si el navegador bloquea localStorage, simplemente no recordamos
      // la elección; el aviso podría volver a aparecer en la próxima visita.
    }
  }

  function hideBanner(banner) {
    banner.classList.remove("sg-cookie-show");
    setTimeout(() => banner.remove(), 260);
  }

  function buildBanner() {
    const banner = document.createElement("div");
    banner.id = "sgCookieBanner";
    banner.className = "sg-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Aviso de cookies");

    banner.innerHTML = `
      <div class="sg-cookie-inner">
        <p>
          Usamos cookies propias y de terceros para que el sitio funcione
          correctamente (por ejemplo, recordar tu carrito) y para entender
          cómo se usa la tienda.
          <a href="#" id="sgCookieInfoLink">Más información</a>
        </p>
        <p class="sg-cookie-detail" id="sgCookieDetail" hidden>
          Las cookies esenciales son necesarias para que el carrito y la
          navegación funcionen y no se pueden desactivar. Si eliges
          "Rechazar", solo usaremos esas cookies esenciales.
        </p>
        <div class="sg-cookie-actions">
          <button type="button" class="btn btn-outline" id="sgCookieReject">
            Rechazar
          </button>
          <button type="button" class="btn btn-primary" id="sgCookieAccept">
            Aceptar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("sg-cookie-show"));

    banner
      .querySelector("#sgCookieAccept")
      .addEventListener("click", () => {
        setConsent("accepted");
        hideBanner(banner);
        if (typeof showSgToast === "function") {
          showSgToast("Preferencias de cookies guardadas ✅");
        }
      });

    banner
      .querySelector("#sgCookieReject")
      .addEventListener("click", () => {
        setConsent("rejected");
        hideBanner(banner);
        if (typeof showSgToast === "function") {
          showSgToast("Listo, solo usaremos cookies esenciales");
        }
      });

    banner
      .querySelector("#sgCookieInfoLink")
      .addEventListener("click", (event) => {
        event.preventDefault();
        const detail = banner.querySelector("#sgCookieDetail");
        detail.hidden = !detail.hidden;
      });
  }

  function openPreferences() {
    // Si ya había un aviso en pantalla (raro, pero por si acaso), lo quitamos
    // sin animación para reemplazarlo por uno nuevo.
    const existing = document.getElementById("sgCookieBanner");
    if (existing) existing.remove();

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // no-op
    }

    buildBanner();
  }

  function attachFooterLink() {
    const link = document.getElementById("sgCookiePrefsLink");
    if (!link) return;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openPreferences();
    });
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        attachFooterLink();
        if (!getConsent()) buildBanner();
      });
    } else {
      attachFooterLink();
      if (!getConsent()) buildBanner();
    }
  }

  // Disponible por si en algún momento se quiere disparar desde otro botón.
  window.sgOpenCookiePreferences = openPreferences;

  init();
})();
