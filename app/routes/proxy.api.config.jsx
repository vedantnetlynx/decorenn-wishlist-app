import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
    iconColor: "#000000",
    iconActiveColor: "#934B32",
    iconSize: 24,
    pageTitle: "My Wishlist",
    emptyStateText: "You haven't saved anything yet.",
};

export const loader = async ({ request }) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response(
            JSON.stringify({ success: false, error: "INVALID_PROXY_REQUEST" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        );
    }

    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    const row = await prisma.shopSettings.findUnique({
        where: { shop },
    });

    const settings = row?.settings && typeof row.settings === "object"
        ? { ...DEFAULT_SETTINGS, ...row.settings }
        : DEFAULT_SETTINGS;

    return new Response(
        JSON.stringify({ success: true, settings }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};