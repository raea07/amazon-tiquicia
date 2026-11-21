"use client";

import { ProductImage } from "@yuntera/next-kit/product-image";
import { useCallback, useEffect, useRef, useState } from "react";

export interface GalleryImage {
  path: string;
  alt: string;
}

/**
 * The product page's pictures. Swipe on a phone (the strip snaps to each
 * picture), arrow keys once it has focus, the buttons, or a thumbnail. Every
 * picture sits in the same square frame, so nothing on the page moves while
 * they load; the first is fetched first and the rest only when needed.
 */
export function ProductGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const strip = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const count = images.length;

  const show = useCallback(
    (index: number) => {
      const element = strip.current;
      if (!element || count === 0) return;
      const next = (index + count) % count;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollTo({ left: next * element.clientWidth, behavior: reduce ? "auto" : "smooth" });
      setCurrent(next);
    },
    [count],
  );

  // Swiping moves the strip without our buttons: follow it.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (element.clientWidth > 0) {
          setCurrent(Math.round(element.scrollLeft / element.clientWidth));
        }
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (count === 0) {
    return <div className="aspect-square rounded-lg border border-border bg-arena-100" />;
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    show(target);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section
        aria-roledescription="carrusel"
        aria-label={`Fotos de ${title}`}
        className="relative overflow-hidden rounded-lg border border-border bg-surface"
      >
        <ul
          ref={strip}
          // Focusable so the arrow keys work; the outline shows where focus is.
          tabIndex={count > 1 ? 0 : undefined}
          onKeyDown={count > 1 ? onKeyDown : undefined}
          aria-label={count > 1 ? "Use las flechas para cambiar de foto" : undefined}
          className="flex aspect-square snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          {images.map((image, index) => (
            <li
              key={image.path}
              aria-roledescription="foto"
              aria-label={`${index + 1} de ${count}`}
              className="flex aspect-square w-full shrink-0 snap-center items-center justify-center"
            >
              <ProductImage
                path={image.path}
                alt={image.alt || title}
                sizes="(min-width: 1024px) 34vw, (min-width: 768px) 60vw, 100vw"
                priority={index === 0}
                className="size-full object-contain"
              />
            </li>
          ))}
        </ul>
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => show(current - 1)}
              className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-surface/90 text-xl shadow-sm hover:bg-surface"
            >
              <span aria-hidden="true">‹</span>
              <span className="sr-only">Foto anterior</span>
            </button>
            <button
              type="button"
              onClick={() => show(current + 1)}
              className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-surface/90 text-xl shadow-sm hover:bg-surface"
            >
              <span aria-hidden="true">›</span>
              <span className="sr-only">Foto siguiente</span>
            </button>
            <p
              aria-live="polite"
              className="absolute right-2 bottom-2 rounded-md bg-surface/90 px-2 py-1 text-xs font-semibold tabular-nums"
            >
              Foto {current + 1} de {count}
            </p>
          </>
        ) : null}
      </section>

      {count > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Miniaturas">
          {images.map((image, index) => (
            <li key={image.path} className="shrink-0">
              <button
                type="button"
                onClick={() => show(index)}
                aria-current={index === current ? "true" : undefined}
                aria-label={`Ver foto ${index + 1}: ${image.alt || title}`}
                className={`block size-16 overflow-hidden rounded-md border-2 bg-surface ${
                  index === current ? "border-brand" : "border-border hover:border-border-strong"
                }`}
              >
                <ProductImage
                  path={image.path}
                  alt=""
                  sizes="64px"
                  className="size-full object-contain"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
