import { errorDrill } from "@yuntera/next-kit/error-reports/drill";

// Fails on purpose for the error-reports journey; 404 on any deployment.
export function GET() {
  return errorDrill();
}
