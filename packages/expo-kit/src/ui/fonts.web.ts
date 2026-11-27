import { useFonts } from "expo-font";
import { fontFamily } from "../theme/tokens";

/**
 * The web export cannot use the config plugin, so it registers the same
 * Carreta files (../../fonts, SISTEMA.md §2.4) under the same family names as
 * the phones, one face per weight (SDK 58's multi-face form of useFonts), so
 * `fontFamily: "Fira Sans"` with `fontWeight: "600"` picks the same face
 * everywhere. Today's names `fontFamily.body` and `fontFamily.display` are the
 * same two families. config.test.ts checks this list against the manifest.
 *
 * If loading fails the system font is used: text never waits on a font.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts([
    {
      fontFamily: fontFamily.text,
      fontDefinitions: [
        { path: require("../../fonts/FiraSans-Regular.ttf"), weight: 400, style: "normal" },
        { path: require("../../fonts/FiraSans-Medium.ttf"), weight: 500, style: "normal" },
        { path: require("../../fonts/FiraSans-SemiBold.ttf"), weight: 600, style: "normal" },
        { path: require("../../fonts/FiraSans-Bold.ttf"), weight: 700, style: "normal" },
      ],
    },
    {
      fontFamily: fontFamily.title,
      fontDefinitions: [
        { path: require("../../fonts/Epilogue-SemiBold.ttf"), weight: 600, style: "normal" },
        { path: require("../../fonts/Epilogue-Bold.ttf"), weight: 700, style: "normal" },
        { path: require("../../fonts/Epilogue-ExtraBold.ttf"), weight: 800, style: "normal" },
      ],
    },
  ]);
  return loaded || Boolean(error);
}
