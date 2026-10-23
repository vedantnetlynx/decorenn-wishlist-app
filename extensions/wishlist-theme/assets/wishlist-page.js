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
        } catch (e) { }

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
                } catch (e) { }
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

    async function updateCartCount() {
        try {
            const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root)
                || (cfg.rootUrl || "/");
            const res = await fetch(`${root}cart.js?_=${Date.now()}`, {
                method: "GET",
                headers: { "Accept": "application/json" },
                cache: "no-store",
                credentials: "same-origin",
            });
            if (!res.ok) throw new Error("Failed to fetch cart: " + res.status);

            const cart = await res.json();
            const itemCount = cart.item_count;

            document.querySelectorAll("#cart-icon-bubble").forEach((cartIcon) => {
                let bubble = cartIcon.querySelector(".cart-count-bubble");

                if (itemCount > 0) {
                    if (!bubble) {
                        bubble = document.createElement("div");
                        bubble.className = "cart-count-bubble";

                        const visible = document.createElement("span");
                        visible.setAttribute("aria-hidden", "true");

                        const hidden = document.createElement("span");
                        hidden.className = "visually-hidden";

                        bubble.appendChild(visible);
                        bubble.appendChild(hidden);
                        cartIcon.appendChild(bubble);
                    }

                    const visible = bubble.querySelector('[aria-hidden="true"]');
                    if (visible) visible.textContent = itemCount;

                    const hidden = bubble.querySelector(".visually-hidden");
                    if (hidden) hidden.textContent = `${itemCount} items`;

                    bubble.style.display = "";
                } else if (bubble) {
                    bubble.remove();
                }
            });

            document.querySelectorAll("[data-cart-count], .cart-count, .cart-item-count")
                .forEach((el) => { el.textContent = itemCount; });

            document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
        } catch (err) {
            console.error("[wishlist] updateCartCount error:", err);
        }
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

            await updateCartCount();

            // Update the header cart icon — same proven pattern as yarn-color-booklets.js
            try {
                const cartRes = await fetch(`${root}/cart.js`, { credentials: "same-origin" });
                if (cartRes.ok) {
                    const cartData = await cartRes.json();
                    const itemCount = cartData.item_count;

                    // Target every #cart-icon-bubble on the page (same as yarn-color-booklets)
                    document.querySelectorAll("#cart-icon-bubble").forEach((cartIcon) => {
                        let cartBubble = cartIcon.querySelector(".cart-count-bubble");

                        if (itemCount > 0) {
                            if (!cartBubble) {
                                // Cart WAS empty — .cart-count-bubble was never rendered by Liquid.
                                // Build it from scratch with the correct span structure.
                                cartBubble = document.createElement("div");
                                cartBubble.className = "cart-count-bubble";

                                const visibleSpan = document.createElement("span");
                                visibleSpan.setAttribute("aria-hidden", "true");

                                const hiddenSpan = document.createElement("span");
                                hiddenSpan.className = "visually-hidden";

                                cartBubble.appendChild(visibleSpan);
                                cartBubble.appendChild(hiddenSpan);
                                cartIcon.appendChild(cartBubble);
                            }

                            // Update both spans
                            const visibleSpan = cartBubble.querySelector("[aria-hidden=\"true\"]");
                            if (visibleSpan) visibleSpan.textContent = itemCount;

                            const hiddenSpan = cartBubble.querySelector(".visually-hidden");
                            if (hiddenSpan) hiddenSpan.textContent = `${itemCount} items`;

                            cartBubble.style.display = "";
                        } else if (cartBubble) {
                            cartBubble.remove();
                        }
                    });

                    // Also update any other generic cart count elements in the theme
                    document.querySelectorAll("[data-cart-count], .cart-count, .cart-item-count").forEach((el) => {
                        el.textContent = itemCount;
                    });
                }
            } catch (e) { }

            // Notify theme cart systems
            document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
            document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true }));

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