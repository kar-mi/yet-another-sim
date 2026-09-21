// Multiplayer is served from `/`; Pages builds derive their project subpath from the document URL.
export const STATIC_ROOT = new URL("static", document.baseURI).pathname.replace(/\/$/, "");
export const ARENA_IMAGE_ROOT = new URL("arena-images", document.baseURI).pathname.replace(/\/$/, "");
export const STATUS_ICON_ROOT = new URL("status-icons", document.baseURI).pathname.replace(/\/$/, "");
