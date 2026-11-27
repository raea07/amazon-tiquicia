// Error reports from the browser: off unless the website was built with the
// tracker's public address, and loaded only after the page is ready
// (packages/next-kit/src/error-reports/client.ts).
import { startBrowserErrorReports } from "@yuntera/next-kit/error-reports/client";

startBrowserErrorReports();
