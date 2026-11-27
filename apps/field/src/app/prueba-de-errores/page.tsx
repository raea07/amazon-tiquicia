import { DrillPage, drillMetadata } from "@yuntera/next-kit/error-reports/drill-page";

// Fails on purpose for the error-reports journey; 404 on any deployment.
export const generateMetadata = drillMetadata;
export default DrillPage;
