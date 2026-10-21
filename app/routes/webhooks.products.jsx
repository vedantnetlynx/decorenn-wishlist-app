import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    if (topic === "PRODUCTS_DELETE") {
      const productId = payload?.id;
      if (productId) {
        const productGid = `gid://shopify/Product/${productId}`;
        const deleted = await db.wishlistItem.deleteMany({
          where: { productGid },
        });
        console.log(`[webhooks.products] Removed ${deleted.count} wishlist item(s) for deleted product ${productGid}`);
      }
    }
  } catch (error) {
    console.error(`Error processing product webhook ${topic}:`, error);
  }

  return new Response("OK", { status: 200 });
};
