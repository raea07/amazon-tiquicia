import { appThemeColor, light, semantic } from "@yuntera/brand";
import type { MetadataRoute } from "next";

/** The driver's bar colour (anil), as in the layout's viewport. */
const themeColor = light[appThemeColor.field];

/** Lets the app be added to a phone's home screen and opened full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yuntera Ruta y Bodega",
    short_name: "Yuntera",
    description: "Rutas de entrega y trabajo de bodega de Yuntera.",
    lang: "es-CR",
    start_url: "/",
    display: "standalone",
    background_color: semantic.bg,
    theme_color: themeColor,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
