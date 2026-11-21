import type { MetadataRoute } from "next";

/** Lets the app be added to a phone's home screen and opened full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yuntera Ruta y Bodega",
    short_name: "Yuntera",
    description: "Rutas de entrega y trabajo de bodega de Yuntera.",
    lang: "es-CR",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#0b7f8e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
