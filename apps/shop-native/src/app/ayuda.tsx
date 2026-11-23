import { brand } from "@yuntera/brand";
import { DEFAULT_RANKING } from "@yuntera/core";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Button, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import * as Linking from "expo-linking";
import type { ReactNode } from "react";
import { View } from "react-native";

const percent = (value: number) => `${Math.round(value * 100)} %`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={3}>
      <Text variant="title" level={2}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

function Item({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: space[2] }}>
      <Text aria-hidden>•</Text>
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

function Draft() {
  return (
    <View
      style={{
        backgroundColor: colors.palette.maiz[50],
        borderRadius: radius.md,
        padding: space[3],
      }}
    >
      <Text variant="small" style={{ color: colors.palette.maiz[900] }}>
        Borrador de trabajo, pendiente de revisión legal antes del lanzamiento.
      </Text>
    </View>
  );
}

/**
 * Help and the legal basics, with the website's words (apps/web/src/app/ayuda).
 * The ranking explanation reads its numbers from the constants the search
 * uses, so it cannot drift from what happens; the offer order is described
 * in words (packages/core/src/offers.ts).
 */
export default function HelpScreen() {
  const ranking = DEFAULT_RANKING.weights;
  const mail = () => void Linking.openURL(`mailto:${brand.support.email}`);
  return (
    <Screen>
      <Section title="Entregas y zonas">
        <Text>
          Hoy entregamos con nuestros propios repartidores en el Gran Área Metropolitana, de lunes
          a sábado; al elegir su distrito le decimos si llegamos ahí. Hoy, si pide antes de las 2 p. m.
          en la zona central, lo recibe al día siguiente. La fecha exacta se muestra en cada producto y
          antes de confirmar su compra.
        </Text>
        <Item>
          Al entregar, el repartidor le pide su <Text variant="bodyStrong">código de entrega</Text>{" "}
          de cuatro dígitos. Lo ve en su pedido. No se lo dé a nadie por teléfono ni por mensaje.
        </Item>
        <Item>Si no hay nadie, lo intentamos de nuevo el siguiente día hábil.</Item>
        <Item>
          Si no cumplimos la fecha prometida, usted puede cancelar y le devolvemos todo lo que pagó.
        </Item>
      </Section>

      <Section title="Medios de pago">
        <Item>
          <Text variant="bodyStrong">SINPE Móvil:</Text> transfiere el monto exacto con el código de
          referencia de su pedido.
        </Item>
        <Item>
          <Text variant="bodyStrong">Tarjeta:</Text> los datos se ingresan en la página del
          procesador de pagos. {brand.name} nunca ve ni guarda el número de su tarjeta.
        </Item>
        <Item>
          <Text variant="bodyStrong">Efectivo contra entrega:</Text> paga el monto exacto al
          recibir. Disponible hasta cierto monto.
        </Item>
        <Text>
          Todos los precios están en colones e incluyen el IVA. El envío se muestra antes de
          confirmar.
        </Text>
      </Section>

      <Section title="Devoluciones y garantía">
        <Item>
          <Text variant="bodyStrong">Derecho de retracto:</Text> tiene 8 días hábiles desde que
          recibe su compra para devolverla sin dar explicaciones. La ley cuenta ese plazo desde la
          compra; nosotros lo contamos desde la entrega, que nunca es menos.
        </Item>
        <Item>
          <Text variant="bodyStrong">Reembolso:</Text> en un máximo de 8 días naturales, por el
          mismo medio con el que pagó.
        </Item>
        <Item>
          <Text variant="bodyStrong">Garantía:</Text> todo producto tiene al menos 30 días hábiles
          de garantía por ley. Muchos vendedores ofrecen más; se indica en cada producto.
        </Item>
        <Item>
          No aplica el retracto a productos perecederos o de uso personal ya abiertos, ni a los
          hechos a la medida.
        </Item>
        <Text>Solicite la devolución desde la página de su pedido.</Text>
      </Section>

      <Section title="Presentar un reclamo">
        <Text>
          Escríbanos a {brand.support.email} con el número de su pedido. Respondemos en un máximo de
          2 días hábiles. Reclamar no tiene costo.
        </Text>
        <Button variant="secondary" onPress={mail}>
          {`Escribir a ${brand.support.email}`}
        </Button>
        <Text>
          Si no queda conforme con nuestra respuesta, puede acudir a la Comisión Nacional del
          Consumidor del Ministerio de Economía, Industria y Comercio.
        </Text>
        <Text>
          Para reportar un producto ilegal, falsificado o peligroso, use el mismo correo indicando
          el enlace del producto. Lo revisamos y le informamos qué hicimos.
        </Text>
      </Section>

      <Section title="Cómo ordenamos los resultados">
        <Text>
          No hay nada oculto en el orden en que usted ve los productos. Primero cuenta qué tan bien
          coincide el producto con lo que buscó. Entre los que coinciden, pesan:
        </Text>
        <Item>Las calificaciones de quienes lo compraron ({percent(ranking.rating)}).</Item>
        <Item>
          Cuánto se vende ({percent(ranking.popularity)}) y qué tanto se compra al verlo (
          {percent(ranking.conversion)}).
        </Item>
        <Item>
          Qué tan rápido llega ({percent(ranking.speed)}) y qué tan buen precio tiene (
          {percent(ranking.price)}).
        </Item>
        <Item>Los productos agotados o con muchas devoluciones bajan.</Item>
        <Text>
          Cuando varias tiendas venden el mismo producto, mostramos primero la oferta nueva que
          tiene existencias y el precio más bajo para usted. Si dos cuestan lo mismo, va primero la
          que se publicó antes. No pesa nada más: ni el tamaño de la tienda ni lo que le paga a{" "}
          {brand.name}. Las demás ofertas siempre se muestran debajo, cada una con la tienda que la
          vende, y usted puede comprar la que prefiera. Los resultados pagados, cuando existan,
          llevarán la etiqueta “Patrocinado”.
        </Text>
      </Section>

      <Section title="Términos y condiciones">
        <Draft />
        <Text>
          {brand.name} es un mercado en línea: cada producto lo vende el vendedor indicado en su
          página, quien emite la factura electrónica. {brand.name} cobra, almacena cuando
          corresponde, entrega y atiende los reclamos.
        </Text>
      </Section>

      <Section title="Privacidad">
        <Draft />
        <Item>
          Usamos sus datos para procesar y entregar sus pedidos, y nada más sin su permiso.
        </Item>
        <Item>
          El vendedor no recibe su teléfono ni su dirección. El repartidor solo ve los datos de la
          entrega mientras la ruta está activa.
        </Item>
        <Item>
          Puede pedir acceso, corrección o eliminación de sus datos escribiendo a{" "}
          {brand.support.email}.
        </Item>
      </Section>

      <Text variant="caption" tint="muted">
        {brand.legalName}. Cédula jurídica: pendiente de inscripción. Contacto:{" "}
        {brand.support.email}. Todos los precios están en colones e incluyen el IVA.
      </Text>
    </Screen>
  );
}
