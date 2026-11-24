import { cx, touchLinkClass } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";

/**
 * The link back at the top of a page ("← Pedidos"), the same in every web
 * app: a 44 px target for a finger, in the same place a plain text link was.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: Route;
  children: string;
  /** Classes for the line around it (its margins). */
  className?: string;
}) {
  return (
    <p className={cx("text-sm", className)}>
      <Link href={href} className={touchLinkClass()} data-back-link="">
        ← {children}
      </Link>
    </p>
  );
}
