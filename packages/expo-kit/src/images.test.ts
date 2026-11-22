import { PHOTO_BUCKETS } from "@yuntera/core";
import { describe, expect, it } from "vitest";
import { imageUrlFor } from "./images";

const SELLER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = `${SELLER}/${PRODUCT}/${PHOTO}/{w}.jpg`;

describe("imageUrlFor", () => {
  const imageUrl = imageUrlFor({ apiUrl: "https://abc.supabase.co", shopUrl: "https://shop.cr/" });

  it("reads an approved photo from the public bucket, at least twice the width shown", () => {
    const base = `https://abc.supabase.co/storage/v1/object/public/${PHOTO_BUCKETS.public}/${SELLER}/${PRODUCT}/${PHOTO}`;
    expect(imageUrl(TEMPLATE, 56)).toBe(`${base}/400.jpg`);
    expect(imageUrl(TEMPLATE, 400)).toBe(`${base}/800.jpg`);
    expect(imageUrl(TEMPLATE, 600)).toBe(`${base}/1600.jpg`);
  });

  it("reads the demo drawings from the shop, and keeps full addresses", () => {
    expect(imageUrl("/demo/products/x.svg")).toBe("https://shop.cr/demo/products/x.svg");
    expect(imageUrl("demo/products/x.svg")).toBe("https://shop.cr/demo/products/x.svg");
    expect(imageUrl("https://cdn.example/x.png")).toBe("https://cdn.example/x.png");
    expect(imageUrlFor({ apiUrl: "", shopUrl: "" })("/demo/x.svg")).toBe("/demo/x.svg");
  });

  it("has nothing to show for no picture", () => {
    expect(imageUrl(null)).toBeNull();
    expect(imageUrl("")).toBeNull();
  });
});
