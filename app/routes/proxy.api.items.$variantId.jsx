import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request, params }) => {
    if (request.method !== "DELETE") {
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

    // The variantGid comes URL-encoded, so decode it.
    const variantGid = decodeURIComponent(params.variantId || "");

    if (!variantGid) {
        return new Response(
            JSON.stringify({ success: false, error: "MISSING_VARIANT_ID" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;

    const wishlist = await prisma.wishlist.findUnique({
        where: { shop_customerGid: { shop, customerGid } },
    });

    // Nothing to delete? Still a success — idempotent.
    if (!wishlist) {
        return new Response(
            JSON.stringify({ success: true, count: 0 }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    }

    await prisma.wishlistItem.deleteMany({
        where: { wishlistId: wishlist.id, variantGid },
    });

    const count = await prisma.wishlistItem.count({
        where: { wishlistId: wishlist.id },
    });

    return new Response(
        JSON.stringify({ success: true, count }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};