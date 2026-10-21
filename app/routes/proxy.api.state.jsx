import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    // 1. Verify the Shopify app-proxy signature.
    //    If this fails, Shopify wasn't the one calling us → reject.
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response(
            JSON.stringify({ success: false, error: "INVALID_PROXY_REQUEST" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        );
    }

    // 2. Read the shop + customer ID that Shopify put in the signed headers.
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const customerGid = url.searchParams.get("logged_in_customer_id");

    // 3. Guest? Return an empty list. The storefront handles localStorage itself.
    if (!customerGid) {
        return new Response(
            JSON.stringify({ success: true, variantGids: [], isGuest: true }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    }

    // 4. Look up the customer's wishlist and return only the variant GIDs.
    const wishlist = await prisma.wishlist.findUnique({
        where: { shop_customerGid: { shop, customerGid: `gid://shopify/Customer/${customerGid}` } },
        include: { items: { select: { variantGid: true } } },
    });

    const variantGids = wishlist?.items.map((item) => item.variantGid) ?? [];

    return new Response(
        JSON.stringify({ success: true, variantGids }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};