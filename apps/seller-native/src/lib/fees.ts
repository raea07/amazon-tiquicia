/**
 * What a seller keeps from one sale, before they publish: the same estimate
 * the seller centre shows beside its listing form
 * (apps/seller/src/components/listing-form.tsx, `FeePreview`), computed by the
 * same function in packages/core that the database's fee code is checked
 * against (`computeSellerStatement`, mirrored in `private.compute_seller_fees`).
 *
 * Nothing about money is worked out here: this only turns what the seller
 * typed into the function's input and its result into lines to show.
 */

import {
  computeSellerStatement,
  DEFAULT_FEE_SCHEDULE,
  money,
  OversizeItemError,
  type PaymentMethod,
  parseColones,
} from "@yuntera/core";
import type { Category } from "@yuntera/db";

export type PreviewMethod = Exclude<PaymentMethod, "bank_transfer">;

/** The payment methods the preview offers, in the web's order, with its words. */
export const METHOD_LABEL: Record<PreviewMethod, string> = {
  sinpe_movil: "SINPE Móvil",
  card: "Tarjeta",
  cash_on_delivery: "Efectivo contra entrega",
};

/** Size tiers of the warehouse fee, as a person would call them. */
const TIER_LABEL: Record<string, string> = {
  sobre: "tipo sobre",
  pequeno: "pequeño",
  mediano: "mediano",
  grande: "grande",
};

export interface FeePreviewInput {
  priceText: string;
  /** The top-level category (commission is set per top-level category), or null. */
  topCategory: string | null;
  byPlatform: boolean;
  weightGrams: number;
  longestSideCm: number;
  method: PreviewMethod;
}

export interface FeeRow {
  label: string;
  /** Céntimos; a charge is negative. */
  amountMinor: number;
}

export type FeePreview =
  | { state: "incomplete"; needs: string }
  | { state: "oversize" }
  | { state: "ready"; rows: FeeRow[]; payoutMinor: number };

export function previewFees(input: FeePreviewInput): FeePreview {
  const priceMinor = parseColones(input.priceText);
  const sized = input.weightGrams > 0 && input.longestSideCm > 0;
  if (!(priceMinor && input.topCategory && (!input.byPlatform || sized))) {
    return {
      state: "incomplete",
      needs: `Escriba el precio, la categoría${input.byPlatform ? ", el peso y las medidas" : ""} para ver cada cargo y lo que le queda.`,
    };
  }
  let statement: ReturnType<typeof computeSellerStatement>;
  try {
    statement = computeSellerStatement({
      lines: [
        {
          lineId: "preview",
          categorySlug: input.topCategory,
          unitGross: money(priceMinor),
          quantity: 1,
          fulfilledByPlatform: input.byPlatform,
          weightGrams: sized ? input.weightGrams : 1,
          longestSideCm: sized ? input.longestSideCm : 1,
        },
      ],
      paymentMethod: input.method,
    });
  } catch (error) {
    if (error instanceof OversizeItemError) return { state: "oversize" };
    throw error;
  }
  const line = statement.lines[0];
  const rows: FeeRow[] = [
    { label: "Precio de venta", amountMinor: statement.itemsGross.amountMinor },
    {
      label: `Comisión (${((line?.referralBps ?? 0) / 100).toLocaleString("es-CR")} %)`,
      amountMinor: -statement.referralFee.amountMinor,
    },
  ];
  if (input.byPlatform) {
    rows.push({
      label: `Bodega y despacho (paquete ${TIER_LABEL[line?.fulfillmentTierId ?? ""] ?? ""})`,
      amountMinor: -statement.fulfillmentFee.amountMinor,
    });
  }
  rows.push(
    { label: "Costo de cobro", amountMinor: -statement.paymentFee.amountMinor },
    {
      label: `IVA sobre los cargos (${DEFAULT_FEE_SCHEDULE.feeTaxBps / 100} %)`,
      amountMinor: -statement.feesTax.amountMinor,
    },
  );
  return { state: "ready", rows, payoutMinor: statement.payout.amountMinor };
}

/** A category a product can be filed under, with the top-level one it belongs to. */
export interface CategoryOption {
  slug: string;
  name: string;
  /** Name of the top-level category, for grouping. */
  group: string;
  /** Slug of the top-level category: commission is set per top-level category. */
  top: string;
}

/**
 * apps/seller `listingCategoryOptions`: only categories without children
 * (a product goes in the most specific one), each with its top-level
 * category. `alsoOffer` keeps a listing's current category in the list.
 */
export function categoryOptions(
  categories: ReadonlyArray<Pick<Category, "slug" | "parent_slug" | "name_es">>,
  alsoOffer?: string,
): CategoryOption[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const parents = new Set(categories.map((category) => category.parent_slug).filter(Boolean));
  const topOf = (slug: string) => {
    let current = bySlug.get(slug);
    while (current?.parent_slug) current = bySlug.get(current.parent_slug);
    return { slug: current?.slug ?? slug, name: current?.name_es ?? "" };
  };
  return categories
    .filter((category) => !parents.has(category.slug) || category.slug === alsoOffer)
    .map((category) => {
      const top = topOf(category.slug);
      return { slug: category.slug, name: category.name_es, group: top.name, top: top.slug };
    });
}
