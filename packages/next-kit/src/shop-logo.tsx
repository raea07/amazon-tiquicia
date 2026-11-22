/**
 * A shop's logo, as the shop, the seller centre and the console show it.
 *
 * The path comes from the database as a template (`<seller>/logo/<logo>/{w}.jpg`,
 * see packages/core/src/shop-logos.ts) and is served from the public photo
 * bucket in the three sizes the seller's device made. A shop without a logo
 * gets its initial on a plain tile, so every shop has the same place on the
 * page. The image is decoration beside the shop's name, which is always
 * written out next to it, so its text alternative is empty.
 */

import { isLogoTemplate, logoUrl, PHOTO_RULES } from "@yuntera/core";

// Read with a literal key so it is inlined at build time, also in the browser.
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export interface ShopLogoProps {
  /** The logo template, or null when the shop has none. */
  logo: string | null | undefined;
  /** The shop's name, for the initial when there is no logo. */
  name: string;
  /** Drawn size in CSS pixels (square). */
  size?: number;
  className?: string;
}

export function ShopLogo({ logo, name, size = 48, className = "" }: ShopLogoProps) {
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border ${className}`;
  if (logo && isLogoTemplate(logo)) {
    return (
      <span className={`${box} bg-surface`} style={{ width: size, height: size }}>
        {/* biome-ignore lint/performance/noImgElement: sizes are made before upload; no optimiser is used */}
        <img
          src={logoUrl(API_URL, logo, 400)}
          srcSet={PHOTO_RULES.sizes.map((s) => `${logoUrl(API_URL, logo, s)} ${s}w`).join(", ")}
          sizes={`${size}px`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      </span>
    );
  }
  // The initial is drawn by the style sheet, so it is not read out or copied
  // as part of the shop's name next to it.
  return (
    <span
      aria-hidden="true"
      data-initial={name.trim().charAt(0).toUpperCase() || "?"}
      className={`${box} bg-brand-soft font-bold text-link before:content-[attr(data-initial)]`}
      style={{ width: size, height: size, fontSize: Math.round(size / 2.4) }}
    />
  );
}
