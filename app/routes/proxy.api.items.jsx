import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
    if (request.method !== "POST") {
        return new Response(
            JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED" }),
            { status: 405, headers: { "Content-Type": "application/json" } }
        );
    }

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response(
            JSON.stringify({ success: false, error: "INVALID_PROXY_REQUEST" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        );
    }

    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");

    if (!loggedInCustomerId) {
        return new Response(
            JSON.stringify({ success: false, error: "LOGIN_REQUIRED" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(
            JSON.stringify({ success: false, error: "INVALID_JSON" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const { productGid, variantGid } = body || {};

    if (!productGid || !variantGid) {
        return new Response(
            JSON.stringify({ success: false, error: "MISSING_FIELDS" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Basic GID format validation — cheap, but catches obvious garbage.
    const gidPattern = /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/;
    if (!gidPattern.test(productGid) || !gidPattern.test(variantGid)) {
        return new Response(
            JSON.stringify({ success: false, error: "INVALID_GID_FORMAT" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;

    const wishlist = await prisma.wishlist.upsert({
        where: { shop_customerGid: { shop, customerGid } },
        update: {},
        create: { shop, customerGid },
    });

    // Idempotent insert: unique(wishlistId, variantGid) makes dupes safe.
    await prisma.wishlistItem.upsert({
        where: {
            wishlistId_variantGid: {
                wishlistId: wishlist.id,
                variantGid,
            },
        },
        update: {},
        create: {
            wishlistId: wishlist.id,
            productGid,
            variantGid,
        },
    });

    const count = await prisma.wishlistItem.count({
        where: { wishlistId: wishlist.id },
    });

    return new Response(
        JSON.stringify({ success: true, variantGid, count }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};