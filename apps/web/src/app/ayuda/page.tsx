import { brand } from "@yuntera/brand";
import { DEFAULT_RANKING } from "@yuntera/core";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ayuda",
  description: "Entregas, medios de pago, devoluciones, garantía y cómo presentar un reclamo.",
};

const percent = (value: number) => `${Math.round(value * 100)} %`;

/**
 * Help and the legal basics, in plain Spanish.
 *
 * The texts under "Términos" and "Privacidad" are working drafts so the product
 * is honest about what it does; they must be reviewed by a Costa Rican lawyer
 * before launch. The ranking explanation reads its numbers from the same
 * constants the code uses, so it cannot drift from what actually happens; the
 * offer order is described in words (packages/core/src/offers.ts).
 */
export default function HelpPage() {
  const ranking = DEFAULT_RANKING.weights;
  return (
    <div className="shell max-w-3xl py-8">
      <h1 className="text-3xl font-bold">Ayuda</h1>

      <div className="mt-8 flex flex-col gap-10 [&_h2]:scroll-mt-28 [&_h2]:text-2xl [&_h2]:font-bold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2 id="entregas">Entregas y zonas</h2>
          <p>
            Hoy entregamos con nuestros propios repartidores en el Gran Área Metropolitana, de lunes
            a sábado; al elegir su distrito le decimos si llegamos ahí. Hoy, si pide antes de las 2 p. m.
            en la zona central, lo recibe al día siguiente. La fecha exacta se muestra en cada producto y
            antes de confirmar su compra.
          </p>
          <ul>
            <li>
              Al entregar, el repartidor le pide su <strong>código de entrega</strong> de cuatro
              dígitos. Lo ve en su pedido. No se lo dé a nadie por teléfono ni por mensaje.
            </li>
            <li>Si no hay nadie, lo intentamos de nuevo el siguiente día hábil.</li>
            <li>
              Si no cumplimos la fecha prometida, usted puede cancelar y le devolvemos todo lo que
              pagó.
            </li>
          </ul>
        </section>

        <section>
          <h2 id="pagos">Medios de pago</h2>
          <ul>
            <li>
              <strong>SINPE Móvil:</strong> transfiere el monto exacto con el código de referencia
              de su pedido.
            </li>
            <li>
              <strong>Tarjeta:</strong> los datos se ingresan en la página del procesador de pagos.{" "}
              {brand.name} nunca ve ni guarda el número de su tarjeta.
            </li>
            <li>
              <strong>Efectivo contra entrega:</strong> paga el monto exacto al recibir. Disponible
              hasta cierto monto.
            </li>
          </ul>
          <p>
            Todos los precios están en colones e incluyen el IVA. El envío se muestra antes de
            confirmar.
          </p>
        </section>

        <section>
          <h2 id="devoluciones">Devoluciones y garantía</h2>
          <ul>
            <li>
              <strong>Derecho de retracto:</strong> tiene 8 días hábiles desde que recibe su compra
              para devolverla sin dar explicaciones. La ley cuenta ese plazo desde la compra;
              nosotros lo contamos desde la entrega, que nunca es menos.
            </li>
            <li>
              <strong>Reembolso:</strong> en un máximo de 8 días naturales, por el mismo medio con
              el que pagó.
            </li>
            <li>
              <strong>Garantía:</strong> todo producto tiene al menos 30 días hábiles de garantía
              por ley. Muchos vendedores ofrecen más; se indica en cada producto.
            </li>
            <li>
              No aplica el retracto a productos perecederos o de uso personal ya abiertos, ni a los
              hechos a la medida.
            </li>
          </ul>
          <p>Solicite la devolución desde la página de su pedido.</p>
        </section>

        <section>
          <h2 id="reclamos">Presentar un reclamo</h2>
          <p>
            Escríbanos a{" "}
            <a className="text-link underline" href={`mailto:${brand.support.email}`}>
              {brand.support.email}
            </a>{" "}
            con el número de su pedido. Respondemos en un máximo de 2 días hábiles. Reclamar no
            tiene costo.
          </p>
          <p>
            Si no queda conforme con nuestra respuesta, puede acudir a la Comisión Nacional del
            Consumidor del Ministerio de Economía, Industria y Comercio.
          </p>
          <p>
            Para reportar un producto ilegal, falsificado o peligroso, use el mismo correo indicando
            el enlace del producto. Lo revisamos y le informamos qué hicimos.
          </p>
        </section>

        <section>
          <h2 id="como-ordenamos">Cómo ordenamos los resultados</h2>
          <p>
            No hay nada oculto en el orden en que usted ve los productos. Primero cuenta qué tan
            bien coincide el producto con lo que buscó. Entre los que coinciden, pesan:
          </p>
          <ul>
            <li>Las calificaciones de quienes lo compraron ({percent(ranking.rating)}).</li>
            <li>
              Cuánto se vende ({percent(ranking.popularity)}) y qué tanto se compra al verlo (
              {percent(ranking.conversion)}).
            </li>
            <li>
              Qué tan rápido llega ({percent(ranking.speed)}) y qué tan buen precio tiene (
              {percent(ranking.price)}).
            </li>
            <li>Los productos agotados o con muchas devoluciones bajan.</li>
          </ul>
          <p>
            Cuando varias tiendas venden el mismo producto, mostramos primero la oferta nueva que
            tiene existencias y el precio más bajo para usted. Si dos cuestan lo mismo, va primero
            la que se publicó antes. No pesa nada más: ni el tamaño de la tienda ni lo que le paga a{" "}
            {brand.name}. Las demás ofertas siempre se muestran debajo, cada una con la tienda que
            la vende, y usted puede comprar la que prefiera. Los resultados pagados, cuando existan,
            llevarán la etiqueta “Patrocinado”.
          </p>
        </section>

        <section>
          <h2 id="terminos">Términos y condiciones</h2>
          <p className="rounded-md bg-maiz-50 p-3 text-sm">
            Borrador de trabajo, pendiente de revisión legal antes del lanzamiento.
          </p>
          <p>
            {brand.name} es un mercado en línea: cada producto lo vende el vendedor indicado en su
            página, quien emite la factura electrónica. {brand.name} cobra, almacena cuando
            corresponde, entrega y atiende los reclamos.
          </p>
        </section>

        <section>
          <h2 id="privacidad">Privacidad</h2>
          <p className="rounded-md bg-maiz-50 p-3 text-sm">
            Borrador de trabajo, pendiente de revisión legal antes del lanzamiento.
          </p>
          <ul>
            <li>
              Usamos sus datos para procesar y entregar sus pedidos, y nada más sin su permiso.
            </li>
            <li>
              El vendedor no recibe su teléfono ni su dirección. El repartidor solo ve los datos de
              la entrega mientras la ruta está activa.
            </li>
            <li>
              Puede pedir acceso, corrección o eliminación de sus datos escribiendo a{" "}
              {brand.support.email}.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
