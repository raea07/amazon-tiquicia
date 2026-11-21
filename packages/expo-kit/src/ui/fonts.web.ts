import { useFonts } from "expo-font";
import { fontFamily } from "../theme/tokens";

/**
 * The web export cannot use the config plugin, so it registers the same
 * static files under the same family names as the phones, one face per weight
 * (SDK 58's multi-face form of useFonts), so `fontFamily: "Inter"` with
 * `fontWeight: "600"` picks the same face everywhere.
 *
 * If loading fails the system font is used: text never waits on a font.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts([
    {
      fontFamily: fontFamily.body,
      fontDefinitions: [
        {
          path: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
          weight: 400,
          style: "normal",
        },
        {
          path: require("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"),
          weight: 500,
          style: "normal",
        },
        {
          path: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
          weight: 600,
          style: "normal",
        },
        {
          path: require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
          weight: 700,
          style: "normal",
        },
      ],
    },
    {
      fontFamily: fontFamily.display,
      fontDefinitions: [
        {
          path: require("@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf"),
          weight: 600,
          style: "normal",
        },
        {
          path: require("@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf"),
          weight: 700,
          style: "normal",
        },
        {
          path: require("@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf"),
          weight: 800,
          style: "normal",
        },
      ],
    },
  ]);
  return loaded || Boolean(error);
}
