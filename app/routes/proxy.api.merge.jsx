import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_ITEMS_PER_WISHLIST = 200;

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

    const rawItems = Array.isArray(body?.items) ? body.items : [];

    if (rawItems.length === 0) {
        return new Response(
            JSON.stringify({ success: true, count: 0, merged: 0 }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    }

    const gidPattern = /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/;

    const valid = rawItems
        .filter(
            (entry) =>
                entry &&
                typeof entry.productGid === "string" &&
                typeof entry.variantGid === "string" &&
                gidPattern.test(entry.productGid) &&
                gidPattern.test(entry.variantGid)
        )
        .slice(0, MAX_ITEMS_PER_WISHLIST);

    if (valid.length === 0) {
        return new Response(
            JSON.stringify({ success: false, error: "NO_VALID_ITEMS" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;

    const wishlist = await prisma.wishlist.upsert({
        where: { shop_customerGid: { shop, customerGid } },
        update: {},
        create: { shop, customerGid },
    });

    let merged = 0;

    for (const entry of valid) {
        const existing = await prisma.wishlistItem.findUnique({
            where: {
                wishlistId_variantGid: {
                    wishlistId: wishlist.id,
                    variantGid: entry.variantGid,
                },
            },
        });

        if (!existing) {
            await prisma.wishlistItem.create({
                data: {
                    wishlistId: wishlist.id,
                    productGid: entry.productGid,
                    variantGid: entry.variantGid,
                },
            });
            merged += 1;
        }
    }

    const count = await prisma.wishlistItem.count({
        where: { wishlistId: wishlist.id },
    });

    return new Response(
        JSON.stringify({ success: true, count, merged }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};