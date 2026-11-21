import { describe, expect, it } from "vitest";
import * as web from "../../../../packages/ui/src/commerce";
import { SHIPMENT_STATUS_LABEL } from "./labels";

describe("status words", () => {
  it("are the website's words for every shipment status", () => {
    expect(SHIPMENT_STATUS_LABEL).toEqual(web.SHIPMENT_STATUS_LABEL);
  });
});
