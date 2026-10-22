/* Wishlist storefront script
   - Injects heart buttons into product cards
   - Fetches saved state once per page
   - Uses event delegation so dynamically loaded cards work
*/

(function () {
    "use strict";

    const cfg = window.__wishlistConfig || {};
    let API_BASE = cfg.apiBase || (window.location.hostname.includes("decorenllc") ? "/apps/wishlist-1/api" : "/apps/wishlist/api");
    const IS_LOGGED_IN = !!cfg.customerId;

    // Helper for resilient API calls with automatic subpath fallback (wishlist <-> wishlist-1)
    async function apiFetch(path, options = {}) {
        let res;
        try {
            res = await fetch(`${API_BASE}${path}`, { credentials: "same-origin", ...options });
        } catch (e) {}

        if (!res || res.status === 404) {
            const alternateBase = API_BASE.includes("wishlist-1")
                ? API_BASE.replace("wishlist-1", "wishlist")
                : API_BASE.replace("wishlist", "wishlist-1");
            if (alternateBase !== API_BASE) {
                try {
                    const retryRes = await fetch(`${alternateBase}${path}`, { credentials: "same-origin", ...options });
                    if (retryRes && retryRes.ok) {
                        API_BASE = alternateBase;
                        res = retryRes;
                    }
                } catch (e) {}
            }
        }

        if (!res) throw new Error("Network request failed");
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error("Invalid JSON: " + text.slice(0, 100));
        }
    }

    // Selectors for cards and heart-injection points.
    // We target the theme's existing card class(es) and read GIDs from data attributes.
    const CARD_SELECTOR = ".fabric_design, .card-wrapper";
    const EXCLUDE_SELECTOR = "[data-your-picks], .your-picks, .selected-designs, #your-picks";

    let savedGids = new Set();
    let stateLoaded = false;

    /* ---------------- localStorage for guests ---------------- */
    const LS_KEY = "wishlist_v1";

    function readGuestList() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }

    function writeGuestList(items) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch { }
    }

    function guestAdd(productGid, variantGid) {
        const items = readGuestList();
        if (!items.some((i) => i.variantGid === variantGid)) {
            items.push({ productGid, variantGid, addedAt: new Date().toISOString() });
            writeGuestList(items);
        }
        return items.length;
    }

    function guestRemove(variantGid) {
        const items = readGuestList().filter((i) => i.variantGid !== variantGid);
        writeGuestList(items);
        return items.length;
    }

    /* ---------------- API calls ---------------- */
    async function fetchState() {
        if (!IS_LOGGED_IN) {
            savedGids = new Set(readGuestList().map((i) => i.variantGid));
            stateLoaded = true;
            return;
        }
        try {
            const json = await apiFetch("/state");
            if (json && json.success && Array.isArray(json.variantGids)) {
                savedGids = new Set(json.variantGids);
            }
        } catch (e) { console.warn("[wishlist] state fetch failed", e); }
        stateLoaded = true;
    }

    async function fetchConfig() {
        try {
            const json = await apiFetch("/config");
            if (!json || !json.success || !json.settings) return;
            const s = json.settings;
            const root = document.documentElement;
            if (s.iconColor) root.style.setProperty("--wl-icon-color", s.iconColor);
            if (s.iconActiveColor) root.style.setProperty("--wl-icon-active-color", s.iconActiveColor);
            if (s.iconSize) root.style.setProperty("--wl-icon-size", `${s.iconSize}px`);
            window.__wishlistSettings = s;
        } catch { }
    }

    async function apiAdd(productGid, variantGid) {
        if (!IS_LOGGED_IN) {
            return { success: true, count: guestAdd(productGid, variantGid), variantGid };
        }
        return await apiFetch("/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productGid, variantGid }),
        });
    }

    async function apiRemove(variantGid) {
        if (!IS_LOGGED_IN) {
            return { success: true, count: guestRemove(variantGid), variantGid };
        }
        return await apiFetch(`/items/${encodeURIComponent(variantGid)}`, {
            method: "DELETE",
        });
    }

    /* ---------------- Counter ---------------- */
    function updateCounters() {
        const n = savedGids.size;
        document.querySelectorAll("[data-wishlist-count]").forEach((el) => {
            el.textContent = String(n);
            el.setAttribute("data-count", String(n));
            el.setAttribute("aria-label", `${n} item${n === 1 ? "" : "s"} in wishlist`);
        });
    }

    /* ---------------- Heart rendering ---------------- */
    const HEART_HTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21s-7-4.4-9.3-9C1.2 8.8 3 5 6.6 5c2 0 3.4 1.1 5.4 3 2-1.9 3.4-3 5.4-3 3.6 0 5.4 3.8 3.9 7-2.3 4.6-9.3 9-9.3 9z"/>
    </svg>`;

    function buildHeart(productGid, variantGid) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wl-heart";
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-label", "Add to wishlist");
        btn.dataset.productId = productGid;
        btn.dataset.variantId = variantGid;
        btn.innerHTML = HEART_HTML;
        return btn;
    }

    // Convert a numeric ID + a type prefix into a full Shopify GID
    // so the heart's data-attributes always match what the API expects.
    function toGid(type, id) {
        if (typeof id === "string" && id.startsWith("gid://")) return id;
        return `gid://shopify/${type}/${id}`;
    }

    // Inject heart button into every card that doesn't have one yet.
    function injectHearts() {
        document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
            // Skip anything inside the "Your Picks" sidebar — that's handled by the
            // existing SE Wishlist widget and is out of our scope (SRS FR-24, FR-25).
            if (card.closest(EXCLUDE_SELECTOR)) return;

            // Hard guard: skip if this card has already been processed or already has a heart.
            if (card.dataset.wlInjected === "1") return;
            if (card.querySelector(".wl-heart")) {
                card.dataset.wlInjected = "1";
                return;
            }
            const pid = card.dataset.pid;
            const vid = card.dataset.vid;
            if (!pid || !vid) return;

            // Anchor: top-right corner of the image wrapper if present,
            // otherwise the card itself.
            const imageWrapper =
                card.querySelector(".fabric-card-image") ||
                card.querySelector(".card__media") ||
                card.querySelector(".media") ||
                card;

            // The CSS positions .wl-heart absolutely, so the parent needs position:relative.
            // We only add our helper class, not arbitrary inline styles.
            if (!imageWrapper.classList.contains("wl-has-heart")) {
                imageWrapper.classList.add("wl-has-heart");
            }

            const productGid = toGid("Product", pid);
            const variantGid = toGid("ProductVariant", vid);

            const heart = buildHeart(productGid, variantGid);
            heart.setAttribute("aria-pressed", savedGids.has(variantGid) ? "true" : "false");
            heart.setAttribute(
                "aria-label",
                savedGids.has(variantGid) ? "Remove from wishlist" : "Add to wishlist"
            );

            imageWrapper.appendChild(heart);
            card.dataset.wlInjected = "1";
        });
    }

    function paintHeart(button, saved) {
        button.setAttribute("aria-pressed", saved ? "true" : "false");
        button.setAttribute(
            "aria-label",
            saved ? "Remove from wishlist" : "Add to wishlist"
        );
    }

    /* ---------------- Swatch & Variant detection ---------------- */
    function getCardCurrentVariantId(card) {
        if (!card) return null;
        // 1. Active swatch in fabric card
        const activeSwatch = card.querySelector(".fabric-swatch.active, [data-swatch].active, .swatch.active, [data-vid].active");
        if (activeSwatch) {
            const vid = activeSwatch.dataset.vid || activeSwatch.getAttribute("data-vid");
            if (vid) return vid;
        }
        // 2. Main image current VID
        const mainImg = card.querySelector(".fabric-main-image, [data-current-vid]");
        if (mainImg) {
            const vid = mainImg.dataset.currentVid || mainImg.getAttribute("data-current-vid");
            if (vid) return vid;
        }
        // 3. Card data-vid attribute
        const cardVid = card.dataset.vid || card.getAttribute("data-vid");
        if (cardVid) return cardVid;

        return null;
    }

    function syncCardVariant(card) {
        if (!card) return;
        const vid = getCardCurrentVariantId(card);
        if (!vid) return;
        const heart = card.querySelector(".wl-heart");
        if (!heart) return;
        const newVariantGid = toGid("ProductVariant", vid);
        heart.dataset.variantId = newVariantGid;
        paintHeart(heart, savedGids.has(newVariantGid));
    }

    function getProductPageVariantId() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const urlVid = urlParams.get("variant");
            if (urlVid) return urlVid;
        } catch (e) {}

        const form = document.querySelector('form[action*="/cart/add"], product-form form, .shopify-product-form, form[id*="product_form"]');
        if (form) {
            const idInput = form.querySelector('select[name="id"], input[name="id"][type="hidden"], input[name="id"]:checked, input[name="id"]');
            if (idInput && idInput.value) return idInput.value;
        }

        const anyIdInput = document.querySelector('select[name="id"], input[name="id"]:checked, input[name="id"]');
        if (anyIdInput && anyIdInput.value) return anyIdInput.value;

        return null;
    }

    function syncProductPageHearts() {
        const vid = getProductPageVariantId();
        if (!vid) return;
        const newVariantGid = toGid("ProductVariant", vid);

        document.querySelectorAll(".wl-heart").forEach((heart) => {
            if (heart.closest(CARD_SELECTOR) || heart.closest(EXCLUDE_SELECTOR)) return;
            heart.dataset.variantId = newVariantGid;
            paintHeart(heart, savedGids.has(newVariantGid));
        });
    }

    function refreshAllHearts() {
        // Sync card hearts
        document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
            if (card.closest(EXCLUDE_SELECTOR)) return;
            syncCardVariant(card);
        });

        // Sync product page hearts
        syncProductPageHearts();

        // Ensure every heart is painted
        document.querySelectorAll(".wl-heart").forEach((heart) => {
            const variantGid = heart.dataset.variantId;
            if (!variantGid) return;
            paintHeart(heart, savedGids.has(variantGid));
        });
    }

    /* ---------------- Global Swatch & Option Click Listener ---------------- */
    document.addEventListener("click", function (event) {
        // 1. Swatch clicked inside a card
        const swatch = event.target.closest(".fabric-swatch, [data-vid]");
        if (swatch && !swatch.closest(EXCLUDE_SELECTOR)) {
            const card = swatch.closest(CARD_SELECTOR) || swatch.closest("[data-pid]");
            if (card) {
                const vid = swatch.dataset.vid || swatch.getAttribute("data-vid");
                if (vid) {
                    card.dataset.vid = vid;
                    card.setAttribute("data-vid", vid);
                }
                syncCardVariant(card);
                setTimeout(() => syncCardVariant(card), 50);
                setTimeout(() => syncCardVariant(card), 150);
            }
        }

        // 2. Variant option / pill clicked on product page
        const optBtn = event.target.closest(".product-form__input, [data-variant-id], [data-option-value], .variant-picker");
        if (optBtn) {
            setTimeout(syncProductPageHearts, 50);
            setTimeout(syncProductPageHearts, 150);
        }
    }, true);

    // Watch for variant inputs changing on product pages
    document.addEventListener("change", function (event) {
        if (event.target.matches('select[name="id"], input[name="id"], input[type="radio"], select, .product-form select')) {
            setTimeout(syncProductPageHearts, 50);
            setTimeout(syncProductPageHearts, 150);
        }
    });

    // Hook URL changes (e.g. ?variant=12345 pushed by Shopify themes)
    (function hookHistory() {
        if (window.__wlHistoryHooked) return;
        window.__wlHistoryHooked = true;
        const origPush = history.pushState;
        history.pushState = function () {
            const ret = origPush.apply(this, arguments);
            setTimeout(syncProductPageHearts, 50);
            return ret;
        };
        const origReplace = history.replaceState;
        history.replaceState = function () {
            const ret = origReplace.apply(this, arguments);
            setTimeout(syncProductPageHearts, 50);
            return ret;
        };
        window.addEventListener("popstate", () => setTimeout(syncProductPageHearts, 50));
    })();

    /* ---------------- Heart Click handling ---------------- */
    document.addEventListener("click", async function (event) {
        const heart = event.target.closest(".wl-heart");
        if (!heart) return;

        event.preventDefault();
        event.stopPropagation();

        if (heart.dataset.loading === "true") return;

        // Fresh synchronization of the variant before handling the click
        const card = heart.closest(CARD_SELECTOR);
        if (card) {
            syncCardVariant(card);
        } else {
            syncProductPageHearts();
        }

        const variantGid = heart.dataset.variantId;
        const productGid = heart.dataset.productId;
        if (!variantGid || !productGid) return;

        const wasSaved = savedGids.has(variantGid);
        const willBeSaved = !wasSaved;

        heart.dataset.loading = "true";
        if (willBeSaved) savedGids.add(variantGid);
        else savedGids.delete(variantGid);
        paintHeart(heart, willBeSaved);
        updateCounters();

        try {
            const result = willBeSaved
                ? await apiAdd(productGid, variantGid)
                : await apiRemove(variantGid);
            if (!result || !result.success) throw new Error((result && result.error) || "FAILED");
        } catch (err) {
            console.warn("[wishlist] request failed, rolling back", err);
            if (willBeSaved) savedGids.delete(variantGid);
            else savedGids.add(variantGid);
            paintHeart(heart, wasSaved);
            updateCounters();
            heart.dataset.error = "true";
            setTimeout(() => { delete heart.dataset.error; }, 1200);
        } finally {
            delete heart.dataset.loading;
        }
    }, true);

    /* ---------------- Swatch / variant change observers ---------------- */
    function observeVariantChanges() {
        document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
            if (card.__wlObserved) return;
            card.__wlObserved = true;

            syncCardVariant(card);

            const observer = new MutationObserver(() => {
                syncCardVariant(card);
            });

            // Observe data-vid, active class on swatches, and current-vid on image
            observer.observe(card, {
                attributes: true,
                subtree: true,
                attributeFilter: ["data-vid", "class", "data-current-vid", "src"]
            });
        });

        // Also observe product form if present on PDP
        const productForms = document.querySelectorAll('form[action*="/cart/add"], product-form, .shopify-product-form');
        productForms.forEach((form) => {
            if (form.__wlObserved) return;
            form.__wlObserved = true;
            syncProductPageHearts();
            const observer = new MutationObserver(() => {
                syncProductPageHearts();
            });
            observer.observe(form, { attributes: true, subtree: true, childList: true });
        });
    }

    async function mergeGuestIfLoggedIn() {
        if (!IS_LOGGED_IN) return;
        const guestItems = readGuestList();
        if (!guestItems.length) return;

        try {
            const json = await apiFetch("/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: guestItems }),
            });
            if (json && json.success) {
                localStorage.removeItem(LS_KEY);
                await fetchState();
            }
        } catch (e) {
            console.warn("[wishlist] guest merge failed", e);
        }
    }

    /* ---------------- Boot ---------------- */
    async function boot() {
        await Promise.all([fetchState(), fetchConfig()]);
        await mergeGuestIfLoggedIn();

        injectHearts();
        refreshAllHearts();
        updateCounters();
        observeVariantChanges();

        // Watch for new cards (pagination, filters, quick view) and inject hearts into them.
        let wlScheduled = false;
        function scheduleRefresh() {
            if (wlScheduled) return;
            wlScheduled = true;
            requestAnimationFrame(() => {
                wlScheduled = false;
                injectHearts();
                refreshAllHearts();
                observeVariantChanges();
                updateCounters();
            });
        }

        const domObserver = new MutationObserver(scheduleRefresh);
        domObserver.observe(document.body, { childList: true, subtree: true });

        window.__wishlist = {
            isSaved: (variantGid) => savedGids.has(variantGid),
            savedGids: () => Array.from(savedGids),
            refresh: async () => {
                await fetchState();
                injectHearts();
                refreshAllHearts();
                updateCounters();
            },
        };
    }

    function safeBoot() {
        try {
            boot();
        } catch (e) {
            console.warn("[wishlist] boot failed", e);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", safeBoot);
    } else {
        // Defer slightly so we run after the theme's own scripts settle.
        setTimeout(safeBoot, 100);
    }
})();