import { Platform, Vibration } from "react-native";

/** How a read went, as the worker is told: in words on screen, and by vibration. */
export type ScanTone = "success" | "warning" | "danger";

/**
 * A short buzz for a read that was accepted, two for one that was refused,
 * so a worker looking at the shelf knows without looking at the screen.
 * iOS has one fixed vibration length, so the pattern there only sets the gap
 * between buzzes. The web export does not vibrate: browsers block it before
 * a tap and it would prove nothing about a phone.
 */
export function vibrateFor(tone: ScanTone) {
  if (Platform.OS === "web") return;
  try {
    if (tone === "success") Vibration.vibrate(Platform.OS === "android" ? 60 : 400);
    else Vibration.vibrate(Platform.OS === "android" ? [0, 90, 110, 90] : [0, 450]);
  } catch {
    // A phone without a vibrator: the words on screen are the feedback.
  }
}
