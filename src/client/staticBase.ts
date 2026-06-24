// Multiplayer is served from `/`; Pages builds derive their project subpath from the document URL.
export const STATIC_ROOT = new URL("static", document.baseURI).pathname.replace(/\/$/, "");
