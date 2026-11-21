import "server-only";
import type { CategoryOption } from "@/components/listing-form";
import { getCategories } from "./data";

/**
 * The categories a seller can file a product under, grouped by their top-level
 * category (commission is set per top-level category).
 *
 * A product goes in the most specific category, so only categories without
 * children are offered. `alsoOffer` adds one more by slug: a listing being
 * edited keeps its current category in the list even if it has children.
 */
export async function listingCategoryOptions(alsoOffer?: string): Promise<CategoryOption[]> {
  const categories = await getCategories();
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const parents = new Set(categories.map((category) => category.parent_slug).filter(Boolean));

  const topOf = (slug: string): { slug: string; name: string } => {
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
