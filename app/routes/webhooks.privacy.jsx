import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received privacy compliance webhook: ${topic} for ${shop}`);

  try {
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST": {
        const customerId = payload?.customer?.id;
        if (customerId) {
          const customerGid = `gid://shopify/Customer/${customerId}`;
          const wishlist = await db.wishlist.findUnique({
            where: { shop_customerGid: { shop, customerGid } },
            include: { items: true },
          });
          console.log(`[GDPR] Customer data request for ${customerGid}: found ${wishlist?.items?.length || 0} items.`);
        }
        break;
      }

      case "CUSTOMERS_REDACT": {
        const customerId = payload?.customer?.id;
        if (customerId) {
          const customerGid = `gid://shopify/Customer/${customerId}`;
          await db.wishlist.deleteMany({
            where: { shop, customerGid },
          });
          console.log(`[GDPR] Redacted customer wishlist for ${customerGid}`);
        }
        break;
      }

      case "SHOP_REDACT": {
        await db.wishlist.deleteMany({ where: { shop } });
        await db.shopSettings.deleteMany({ where: { shop } });
        await db.session.deleteMany({ where: { shop } });
        console.log(`[GDPR] Redacted all data for shop: ${shop}`);
        break;
      }

      default:
        console.log(`Unhandled privacy topic: ${topic}`);
    }
  } catch (error) {
    console.error(`Error processing privacy webhook ${topic}:`, error);
  }

  return new Response("OK", { status: 200 });
};
