"use client";

/**
 * The browser half of the drill (/prueba-de-errores?en=navegador): renders
 * nothing on the server, then fails while rendering in the browser, so the
 * website's error page catches an error that did not come from the server
 * (it has no digest) and reports it from the browser.
 */
import { useEffect, useState } from "react";
import { DRILL_MESSAGE } from "./drill-message";

export function FailsInBrowser(): null {
  const [fail, setFail] = useState(false);
  useEffect(() => setFail(true), []);
  if (fail) {
    // A different ending each time, so the SDK's duplicate filter lets it through.
    throw new Error(DRILL_MESSAGE.concat(" (navegador, vez ", Date.now().toString(36), ")"));
  }
  return null;
}
