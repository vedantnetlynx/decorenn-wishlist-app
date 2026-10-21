import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const DEFAULT_SETTINGS = {
  iconColor: "#000000",
  iconActiveColor: "#e63946",
  iconSize: 24,
  pageTitle: "My Wishlist",
  emptyStateText: "You haven't saved anything yet.",
  hideAddToCartCollections: "",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const row = await db.shopSettings.findUnique({
    where: { shop: session.shop },
  });

  const settings =
    row?.settings && typeof row.settings === "object"
      ? { ...DEFAULT_SETTINGS, ...row.settings }
      : DEFAULT_SETTINGS;

  const totalSaved = await db.wishlistItem.count({
    where: { wishlist: { shop: session.shop } },
  });

  return {
    shop: session.shop,
    settings,
    totalSaved,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const iconColor = String(formData.get("iconColor") || "#000000").trim();
  const iconActiveColor = String(formData.get("iconActiveColor") || "#e63946").trim();
  const iconSizeRaw = parseInt(String(formData.get("iconSize") || "24"), 10);
  const iconSize = isNaN(iconSizeRaw) ? 24 : Math.min(Math.max(iconSizeRaw, 16), 48);

  const pageTitle = String(formData.get("pageTitle") || "My Wishlist").trim().slice(0, 100);
  const emptyStateText = String(formData.get("emptyStateText") || "You haven't saved anything yet.").trim().slice(0, 300);
  const hideAddToCartCollections = String(formData.get("hideAddToCartCollections") || "").trim().slice(0, 500);

  const newSettings = {
    iconColor,
    iconActiveColor,
    iconSize,
    pageTitle,
    emptyStateText,
    hideAddToCartCollections,
  };

  await db.shopSettings.upsert({
    where: { shop: session.shop },
    update: { settings: newSettings },
    create: { shop: session.shop, settings: newSettings },
  });

  return { success: true, settings: newSettings };
};

export default function WishlistAdminPage() {
  const { shop, settings: initialSettings, totalSaved } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const currentSettings = fetcher.data?.settings || initialSettings;
  const isSaving = fetcher.state === "submitting" || fetcher.state === "loading";

  const [iconColor, setIconColor] = useState(currentSettings.iconColor);
  const [iconActiveColor, setIconActiveColor] = useState(currentSettings.iconActiveColor);
  const [iconSize, setIconSize] = useState(currentSettings.iconSize);
  const [pageTitle, setPageTitle] = useState(currentSettings.pageTitle);
  const [emptyStateText, setEmptyStateText] = useState(currentSettings.emptyStateText);
  const [hideAddToCartCollections, setHideAddToCartCollections] = useState(currentSettings.hideAddToCartCollections || "");
  const [showSavedToast, setShowSavedToast] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast?.show?.("Settings saved successfully!");
      setShowSavedToast(true);
      const timer = setTimeout(() => setShowSavedToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.data, shopify]);

  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps`;

  return (
    <s-page heading="Wishlist Settings">
      <s-stack direction="block" gap="large">
        {/* Status & Quick Links Banner */}
        <s-section heading="Theme Integration Status">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              To display wishlist hearts on product cards and activate the customer wishlist, ensure the <strong>Wishlist App Embed</strong> is turned ON in your current theme.
            </s-paragraph>
            <s-stack direction="inline" gap="base" align="center">
              <s-button
                href={themeEditorUrl}
                target="_blank"
                variant="primary"
              >
                Open Theme App Embeds
              </s-button>
              <s-paragraph>
                Total Customer Items Saved: <strong>{totalSaved}</strong>
              </s-paragraph>
            </s-stack>
          </s-stack>
        </s-section>

        {/* Configuration Form */}
        <s-section heading="Design & Text Configuration">
          <fetcher.Form method="post">
            <s-stack direction="block" gap="base">
              {showSavedToast && (
                <s-banner tone="success" heading="Settings saved!">
                  Your storefront wishlist settings have been updated.
                </s-banner>
              )}

              <s-stack direction="block" gap="base">
                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Default Heart Icon Color
                  <div style={{ display: "flex", gap: "10px", marginTop: "4px", alignItems: "center" }}>
                    <input
                      type="color"
                      value={iconColor}
                      onChange={(e) => setIconColor(e.target.value)}
                      style={{ width: "40px", height: "36px", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      name="iconColor"
                      value={iconColor}
                      onChange={(e) => setIconColor(e.target.value)}
                      style={{ padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "120px" }}
                    />
                  </div>
                </label>

                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Active (Saved) Heart Icon Color
                  <div style={{ display: "flex", gap: "10px", marginTop: "4px", alignItems: "center" }}>
                    <input
                      type="color"
                      value={iconActiveColor}
                      onChange={(e) => setIconActiveColor(e.target.value)}
                      style={{ width: "40px", height: "36px", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      name="iconActiveColor"
                      value={iconActiveColor}
                      onChange={(e) => setIconActiveColor(e.target.value)}
                      style={{ padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "120px" }}
                    />
                  </div>
                </label>

                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Heart Icon Size (16px to 48px)
                  <input
                    type="number"
                    name="iconSize"
                    min="16"
                    max="48"
                    value={iconSize}
                    onChange={(e) => setIconSize(e.target.value)}
                    style={{ display: "block", marginTop: "4px", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "120px" }}
                  />
                </label>

                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Wishlist Page Title
                  <input
                    type="text"
                    name="pageTitle"
                    value={pageTitle}
                    onChange={(e) => setPageTitle(e.target.value)}
                    style={{ display: "block", marginTop: "4px", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "100%", maxWidth: "400px" }}
                  />
                </label>

                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Empty State Text
                  <textarea
                    name="emptyStateText"
                    rows={3}
                    value={emptyStateText}
                    onChange={(e) => setEmptyStateText(e.target.value)}
                    style={{ display: "block", marginTop: "4px", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "100%", maxWidth: "500px" }}
                  />
                </label>

                <label style={{ display: "block", fontWeight: 600, fontSize: "14px" }}>
                  Hide "Add to Cart" for Specific Collections
                  <span style={{ display: "block", fontSize: "12px", color: "#666", fontWeight: "normal", marginTop: "2px", marginBottom: "4px" }}>
                    Enter comma-separated collection handles or titles (e.g. <code>custom-rugs, bespoke, swatches</code>). Products in these collections will only show the <strong>Remove</strong> button on the wishlist page.
                  </span>
                  <input
                    type="text"
                    name="hideAddToCartCollections"
                    value={hideAddToCartCollections}
                    onChange={(e) => setHideAddToCartCollections(e.target.value)}
                    placeholder="e.g. custom-rugs, bespoke, swatches"
                    style={{ display: "block", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", width: "100%", maxWidth: "500px" }}
                  />
                </label>
              </s-stack>

              <div style={{ marginTop: "16px" }}>
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isSaving ? { loading: true } : {})}
                >
                  {isSaving ? "Saving..." : "Save Settings"}
                </s-button>
              </div>
            </s-stack>
          </fetcher.Form>
        </s-section>
      </s-stack>
    </s-page>
  );
}
