import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
    try {
        const { session, admin } = await authenticate.public.appProxy(request);
        if (!session) return new Response(JSON.stringify({ success: false, error: "NO_SESSION" }), { status: 401 });

        const body = await request.json().catch(() => ({}));
        const guestVariants = body.guestVariants || [];

        const url = new URL(request.url);
        const shop = url.searchParams.get("shop");
        const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");

        let variantGids = [...guestVariants];

        if (loggedInCustomerId) {
            const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;
            const wishlist = await prisma.wishlist.findUnique({
                where: { shop_customerGid: { shop, customerGid } },
                include: { items: true },
            });
            if (wishlist) {
                variantGids = [...new Set([...variantGids, ...wishlist.items.map(i => i.variantGid)])];
            }
        }

        if (variantGids.length === 0) {
            return new Response(JSON.stringify({ success: true, items: [] }), { status: 200 });
        }

        const shopSettingsRow = await prisma.shopSettings.findUnique({
            where: { shop },
        });
        const rawExcluded = shopSettingsRow?.settings?.hideAddToCartCollections || "";
        const excludedCollections = typeof rawExcluded === "string"
            ? rawExcluded
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            : [];

        const items = await Promise.all(variantGids.map(async (gid) => {
            try {
                const response = await admin.graphql(
                    `#graphql
        query GetVariant($id: ID!) {
          node(id: $id) {
            ... on ProductVariant {
              id
              title
              availableForSale
              price
              media(first: 1) {
                nodes { preview { image { url altText } } }
              }
              product {
                id
                title
                handle
                featuredMedia { preview { image { url altText } } }
                collections(first: 25) {
                  nodes {
                    id
                    handle
                    title
                  }
                }
              }
            }
          }
          shop { currencyCode }
        }`,
                    { variables: { id: gid } }
                );

                const data = await response.json();
                console.log("Admin response for", gid, JSON.stringify(data));

                if (data.errors) {
                    return { variantGid: gid, unavailable: true, title: "GraphQL error: " + JSON.stringify(data.errors) };
                }

                const node = data?.data?.node;
                if (!node) {
                    return { variantGid: gid, unavailable: true, title: "No longer available" };
                }

                const prodCollections = (node.product?.collections?.nodes || []).map((c) => ({
                    handle: (c.handle || "").toLowerCase().trim(),
                    title: (c.title || "").toLowerCase().trim(),
                }));

                const hideAddToCart =
                    excludedCollections.length > 0 &&
                    prodCollections.some(
                        (c) =>
                            excludedCollections.includes(c.handle) ||
                            excludedCollections.includes(c.title)
                    );

                return {
                    variantGid: gid,
                    productGid: node.product?.id,
                    unavailable: false,
                    title: node.product?.title || "Untitled",
                    productHandle: node.product?.handle,
                    variantTitle: node.title,
                    price: node.price,
                    currencyCode: data.data.shop?.currencyCode,
                    availableForSale: node.availableForSale,
                    hideAddToCart,
                    hidePrice: hideAddToCart,
                    image:
                        node.media?.nodes?.[0]?.preview?.image?.url ||
                        node.product?.featuredMedia?.preview?.image?.url ||
                        null,
                };
            } catch (err) {
                let detail = err?.message;
                if (err instanceof Response) {
                    detail = await err.text().catch(() => "unreadable body");
                }
                console.error("GraphQL error for GID", gid, err instanceof Response ? err.status : "", detail);
                return { variantGid: gid, unavailable: true, title: `Error: ${detail || "unknown"}` };
            }
        }));

        return new Response(JSON.stringify({ success: true, items }), {
            status: 200, headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Wishlist API Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
};

export const loader = async () => {
    return new Response(JSON.stringify({ success: true, items: [] }), { status: 200 });
};