(function () {
    "use strict";

    const cfg = window.__wishlistPageConfig || {};
    let API_BASE = cfg.apiBase || (window.location.hostname.includes("decorenllc") ? "/apps/wishlist-1/api" : "/apps/wishlist/api");
    const grid = document.querySelector("[data-wl-grid]");
    const errorEl = document.querySelector("[data-wl-error]");
    const emptyEl = document.querySelector("[data-wl-empty]");
    const retryBtn = document.querySelector("[data-wl-retry]");

    const loadMoreBtn = document.querySelector("[data-wl-load-more]");
    const loadMoreWrap = document.querySelector(".wl-page__more");

    if (!grid) return;

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

    const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));

    const numericId = (gid) => String(gid).split("/").pop();

    const formatPrice = (amount, currency) => {
        if (amount == null || amount === "") return "";
        try {
            return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: currency || "USD",
            }).format(Number(amount));
        } catch (e) {
            return amount;
        }
    };

    const readGuest = () => {
        try {
            const raw = JSON.parse(localStorage.getItem("wishlist_v1") || "[]");
            return raw.map((i) => (typeof i === "string" ? i : i.variantGid)).filter(Boolean);
        } catch (e) {
            return [];
        }
    };

    const writeGuest = (gids) => {
        try {
            const raw = JSON.parse(localStorage.getItem("wishlist_v1") || "[]");
            const next = raw.filter((i) => gids.includes(typeof i === "string" ? i : i.variantGid));
            localStorage.setItem("wishlist_v1", JSON.stringify(next));
        } catch (e) { }
    };

    function showEmpty() {
        errorEl.hidden = true;
        grid.hidden = true;
        if (loadMoreWrap) loadMoreWrap.hidden = true;
        emptyEl.hidden = false;
    }

    function cardHtml(item) {
        const gid = esc(item.variantGid);

        if (item.unavailable) {
            return `
                <div class="wl-card wl-card--unavailable" data-gid="${gid}">
                    <div class="wl-card__img wl-card__img--empty">No longer available</div>
                    <div class="wl-card__body">
                        <div class="wl-card__title">This product is no longer available</div>
                        <div class="wl-card__actions">
                            <button type="button" class="wl-btn-remove" data-gid="${gid}">Remove</button>
                        </div>
                    </div>
                </div>`;
        }

        const url = item.productHandle
            ? `${(cfg.rootUrl || "/").replace(/\/$/, "")}/products/${encodeURIComponent(item.productHandle)}?variant=${numericId(item.variantGid)}`
            : "#";

        const img = item.image
            ? `<img class="wl-card__img" src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">`
            : `<div class="wl-card__img wl-card__img--empty">No image</div>`;

        const variant =
            item.variantTitle && item.variantTitle !== "Default Title"
                ? `<div class="wl-card__variant">${esc(item.variantTitle)}</div>`
                : "";

        const soldOut = item.availableForSale === false
            ? `<div class="wl-card__soldout">Sold out</div>`
            : "";

        const atcBtn = item.availableForSale === false
            ? `<button type="button" class="wl-btn-atc" disabled>Sold out</button>`
            : `<button type="button" class="wl-btn-atc wl-primary" data-variant-id="${numericId(item.variantGid)}">Add to cart</button>`;

        const actionsHtml = item.hideAddToCart
            ? `<button type="button" class="wl-btn-remove wl-btn-remove--only" data-gid="${gid}" title="Remove from wishlist">Remove</button>`
            : `${atcBtn}<button type="button" class="wl-btn-remove" data-gid="${gid}" title="Remove from wishlist">Remove</button>`;

        const hidePrice = !!(item.hideAddToCart || item.hidePrice);
        const priceHtml = hidePrice
            ? ""
            : `<div class="wl-card__price">${esc(formatPrice(item.price, item.currencyCode))}</div>`;

        return `
            <div class="wl-card" data-gid="${gid}">
                <a href="${esc(url)}" class="wl-card__link">${img}</a>
                <div class="wl-card__body">
                    <a href="${esc(url)}" class="wl-card__title">${esc(item.title)}</a>
                    ${variant}
                    ${priceHtml}
                    ${soldOut}
                    <div class="wl-card__actions">
                        ${actionsHtml}
                    </div>
                </div>
            </div>`;
    }

    async function removeItem(gid, btn) {
        btn.disabled = true;
        btn.textContent = "Removing...";

        if (cfg.loggedIn) {
            try {
                await apiFetch(`/items/${encodeURIComponent(gid)}`, { method: "DELETE" });
            } catch (e) {
                console.error(e);
                btn.disabled = false;
                btn.textContent = "Remove";
                return;
            }
        } else {
            writeGuest(readGuest().filter((g) => g !== gid));
        }

        btn.closest(".wl-card")?.remove();

        if (window.__wishlist && typeof window.__wishlist.refresh === "function") {
            window.__wishlist.refresh();
        }

        if (!grid.children.length) showEmpty();
    }

    async function addToCart(variantId, btn) {
        if (!variantId || btn.disabled) return;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Adding...";

        try {
            const root = (cfg.rootUrl || "/").replace(/\/$/, "");
            const res = await fetch(`${root}/cart/add.js`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify({
                    id: variantId,
                    quantity: 1,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.description || errData.message || "Failed to add to cart");
            }

            btn.textContent = "Added!";

            // Get the fresh cart count from the server
            let itemCount = null;
            try {
                const cartRes = await fetch(`${root}/cart.js`, { credentials: "same-origin" });
                if (cartRes.ok) {
                    const cartData = await cartRes.json();
                    itemCount = cartData.item_count;
                }
            } catch (e) {}

            if (itemCount !== null) {
                const existingBubble = document.querySelector(".cart-count-bubble");
                const cartIconLink = document.querySelector("#cart-icon-bubble");

                if (existingBubble) {
                    // --- Cart already had items: bubble exists, just update the count ---
                    existingBubble.querySelectorAll("span").forEach((s) => {
                        if (s.hasAttribute("aria-hidden")) {
                            // The visible number span
                            s.textContent = itemCount;
                        } else {
                            // The visually-hidden accessible text span
                            s.textContent = itemCount + " items in cart";
                        }
                    });
                } else {
                    // --- Cart WAS empty: Liquid never rendered .cart-count-bubble ---
                    // The icon SVG is also wrong (icon-cart-empty vs icon-cart).
                    // Use the Section Rendering API to get the correct server-rendered
                    // cart icon (with filled icon + bubble) and swap it in.
                    let sectionUpdated = false;
                    try {
                        const sectionRes = await fetch(
                            `${root}/?sections=header`,
                            { credentials: "same-origin", headers: { "Accept": "application/json" } }
                        );
                        if (sectionRes.ok) {
                            const sections = await sectionRes.json();
                            const headerHtml = sections["header"];
                            if (headerHtml) {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(headerHtml, "text/html");
                                const newCartLink = doc.querySelector("#cart-icon-bubble");
                                if (newCartLink && cartIconLink) {
                                    // Replace the entire icon link contents
                                    // (swaps empty→filled icon AND injects the count bubble)
                                    cartIconLink.innerHTML = newCartLink.innerHTML;
                                    sectionUpdated = true;
                                }
                            }
                        }
                    } catch (e) {}

                    if (!sectionUpdated && cartIconLink) {
                        // Fallback: manually inject the bubble if section render failed
                        const bubble = document.createElement("div");
                        bubble.className = "cart-count-bubble";
                        bubble.innerHTML =
                            `<span aria-hidden="true">${itemCount}</span>` +
                            `<span class="visually-hidden">${itemCount} items in cart</span>`;
                        cartIconLink.appendChild(bubble);
                    }
                }
            }

            // Notify theme cart systems
            const cartEventDetail = itemCount !== null ? { detail: { itemCount } } : {};
            document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true, ...cartEventDetail }));
            document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true, ...cartEventDetail }));

            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = originalText;
            }, 1500);
        } catch (err) {
            console.error("[wishlist] Add to cart error:", err);
            btn.textContent = "Error";
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = originalText;
            }, 2000);
        }
    }

    let allItems = [];
    const PAGE_SIZE = 20;
    let visibleCount = PAGE_SIZE;

    function renderBatch() {
        const slice = allItems.slice(0, visibleCount);
        grid.innerHTML = slice.map(cardHtml).join("");
        errorEl.hidden = true;
        emptyEl.hidden = true;
        grid.hidden = false;

        if (loadMoreWrap) {
            loadMoreWrap.hidden = visibleCount >= allItems.length;
        }
    }

    grid.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".wl-btn-remove");
        if (removeBtn) {
            removeItem(removeBtn.dataset.gid, removeBtn);
            return;
        }

        const atcBtn = e.target.closest(".wl-btn-atc");
        if (atcBtn && atcBtn.dataset.variantId) {
            addToCart(atcBtn.dataset.variantId, atcBtn);
        }
    });

    loadMoreBtn?.addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        renderBatch();
    });

    async function load() {
        errorEl.hidden = true;
        if (loadMoreWrap) loadMoreWrap.hidden = true;

        const guestVariants = cfg.loggedIn ? [] : readGuest();

        if (!cfg.loggedIn && guestVariants.length === 0) return showEmpty();

        try {
            const json = await apiFetch("/wishlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ guestVariants }),
            });
            if (!json.success) throw new Error(json.error || "Request failed");
            if (!json.items || json.items.length === 0) return showEmpty();

            allItems = json.items;
            visibleCount = PAGE_SIZE;
            renderBatch();
        } catch (err) {
            console.error("Wishlist load failed:", err);
            errorEl.hidden = false;
        }
    }

    retryBtn?.addEventListener("click", load);
    load();
})();