/**
 * Real-shaped error events, as the tracker's SDK builds them before
 * `beforeSend`, for the pages where personal data is closest to an error:
 * the checkout (an address and a phone), an order page (the delivery code), a
 * sign-in (an e-mail and a password) and a staff page that shows a customer.
 * Every value here is made up. `FORBIDDEN` lists the strings that must never
 * appear anywhere in what is sent.
 */
import type { TrackerEvent } from "./scrub";

export const PERSON = {
  name: "Ana Prueba Solís",
  email: "ana.prueba@example.com",
  phone: "8888-1234",
  phoneIntl: "+506 8765 4321",
  cedula: "1-0234-0567",
  cedulaPlain: "102340567",
  juridica: "3-101-123456",
  address: "Del Palí 200 metros al norte, casa celeste con portón negro",
  district: "San Pedro",
  deliveryCode: "4821",
  deliveryCode6: "739204",
  password: "Contraseña-De-Prueba-77",
  userId: "7f0c1e2a-9b3d-4c5e-8f6a-1b2c3d4e5f60",
  ip: "201.192.44.17",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZjBjMWUyYSJ9.c2lnbmF0dXJhLWRlLXBydWViYQ",
  refreshToken: "v1.MRjVVi7nYlDqzaLTs8Tqfw2mBhx9pZbE4kuWgQdR5yFsHnJcXoAe",
  iban: "CR05015202001026284066",
};

/** Strings that must not survive in any report. */
export const FORBIDDEN: string[] = [
  PERSON.name,
  "Ana",
  "Solís",
  PERSON.email,
  PERSON.phone,
  "88881234",
  PERSON.phoneIntl,
  "87654321",
  PERSON.cedula,
  PERSON.cedulaPlain,
  PERSON.juridica,
  "Palí",
  "portón",
  PERSON.district,
  PERSON.deliveryCode,
  PERSON.deliveryCode6,
  PERSON.password,
  PERSON.userId,
  PERSON.ip,
  PERSON.jwt,
  "eyJhbGci",
  PERSON.refreshToken,
  PERSON.iban,
  "sb-access-token",
  "sb_publishable_",
  "cookie",
  "Cookie",
  "user-agent",
  "Mozilla",
  "correo=",
];

const headers = {
  cookie: `sb-access-token=${PERSON.jwt}; sb-refresh-token=${PERSON.refreshToken}; yt_cart=abc`,
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  "x-forwarded-for": PERSON.ip,
  referer: `https://yuntera.example/ingresar?correo=${PERSON.email}`,
  authorization: `Bearer ${PERSON.jwt}`,
  apikey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
};

const breadcrumbs = [
  { category: "console", level: "log", message: `Dirección: ${PERSON.address}` },
  { category: "ui.input", message: `input[name="phone"] ${PERSON.phone}` },
  { category: "ui.click", message: `button "Confirmar pedido de ${PERSON.name}"` },
  { category: "navigation", data: { from: "/carrito", to: `/pagar?tel=${PERSON.phone}` } },
  {
    category: "fetch",
    data: { url: `http://127.0.0.1:54321/rest/v1/rpc/place_order?x=${PERSON.email}` },
  },
];

const base = (overrides: TrackerEvent): TrackerEvent => ({
  event_id: "0123456789abcdef0123456789abcdef",
  timestamp: 1764240000.123,
  platform: "javascript",
  level: "error",
  environment: "production",
  release: "web@1.0",
  server_name: "ip-10-0-0-1.ec2.internal",
  sdk: {
    name: "sentry.javascript.nextjs",
    version: "11.12.0",
    integrations: ["Breadcrumbs", "HttpContext"],
  },
  user: { id: PERSON.userId, email: PERSON.email, ip_address: PERSON.ip, username: PERSON.name },
  breadcrumbs,
  extra: { address: PERSON.address, formData: { phone: PERSON.phone } },
  tags: { app: "web", user_email: PERSON.email, role: "shopper" },
  contexts: {
    runtime: { name: "node", version: "v22.20.0" },
    culture: { locale: "es-CR", timezone: "America/Costa_Rica" },
    react: { componentStack: `at Checkout (${PERSON.address})` },
    nextjs: {
      request_path: `/pagar?telefono=${PERSON.phone}`,
      router_kind: "App Router",
      router_path: "/pagar",
      route_type: "action",
    },
    state: { state: { type: "redux", value: { name: PERSON.name } } },
  },
  ...overrides,
});

/** The checkout: a Server Action fails while placing an order with an address and a phone. */
export const checkoutEvent = (): TrackerEvent =>
  base({
    platform: "node",
    transaction: "POST /pagar",
    request: {
      url: `https://yuntera.example/pagar?telefono=${encodeURIComponent(PERSON.phone)}`,
      method: "POST",
      headers,
      cookies: { "sb-access-token": PERSON.jwt },
      data: {
        "1_address": PERSON.address,
        "1_phone": PERSON.phone,
        "1_name": PERSON.name,
        "1_cedula": PERSON.cedula,
      },
      query_string: `telefono=${PERSON.phone}`,
      env: { REMOTE_ADDR: PERSON.ip },
    },
    exception: {
      values: [
        {
          type: "Error",
          value: `No se pudo validar la dirección "${PERSON.address}" para ${PERSON.email} (tel. ${PERSON.phone}, ${PERSON.phoneIntl})`,
          mechanism: { type: "auto.function.nextjs.on_request_error", handled: false },
          stacktrace: {
            frames: [
              {
                filename: "/var/task/apps/web/.next/server/chunks/ssr/app_pagar_actions.js",
                function: "placeOrder",
                lineno: 12,
                colno: 3,
                in_app: true,
                context_line: `  const phone = "${PERSON.phone}";`,
                vars: { phone: PERSON.phone, address: PERSON.address },
              },
            ],
          },
        },
      ],
    },
  });

/** An order page: the error text carries the delivery code, as a mistaken log line might. */
export const orderPageEvent = (): TrackerEvent =>
  base({
    request: {
      url: `https://yuntera.example/pedidos/YT-100123?codigo=${PERSON.deliveryCode}#entrega`,
      headers,
    },
    transaction: "/pedidos/[numero]",
    message: { message: "Su código de entrega es %s", params: [PERSON.deliveryCode] },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `Cannot render delivery panel: código de entrega ${PERSON.deliveryCode}; code: ${PERSON.deliveryCode6}; ${PERSON.deliveryCode6} es su código; pin=${PERSON.deliveryCode}`,
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
          stacktrace: {
            frames: [
              {
                filename: `https://yuntera.example/_next/static/chunks/app/pedidos/page-1a2b3c.js?dpl=${PERSON.jwt}`,
                abs_path: "https://yuntera.example/_next/static/chunks/app/pedidos/page-1a2b3c.js",
                function: "DeliveryPanel",
                lineno: 1,
                colno: 77,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  });

/** Sign-in: a failure while the e-mail and the password are in the form. */
export const signInEvent = (): TrackerEvent =>
  base({
    request: {
      url: `https://vende.yuntera.example/ingresar?volver=/pedidos&correo=${PERSON.email}`,
      method: "POST",
      headers,
      data: `email=${encodeURIComponent(PERSON.email)}&password=${encodeURIComponent(PERSON.password)}`,
    },
    exception: {
      values: [
        {
          type: "AuthApiError",
          value: `Invalid login for ${PERSON.email} with password=${PERSON.password} token=${PERSON.refreshToken}`,
          stacktrace: { frames: [{ filename: "app:///ingresar/actions.js", function: "signIn" }] },
        },
        {
          type: "Error",
          value: `fetch failed: https://abcdefghijkl.supabase.co/auth/v1/token?grant_type=password&apikey=sb_publishable_abcdefghijklmnopqrstuvwxyz (Authorization: Bearer ${PERSON.jwt})`,
        },
      ],
    },
  });

/** A staff page showing a customer: the console's order page fails with the customer's details on screen. */
export const staffCustomerEvent = (): TrackerEvent =>
  base({
    request: { url: "https://central.yuntera.example/pedidos/YT-100123", headers },
    tags: { app: "ops", role: "staff", customer: PERSON.name },
    exception: {
      values: [
        {
          type: "Error",
          value: `Cliente "${PERSON.name}" («${PERSON.district}»), cédula ${PERSON.cedula} (${PERSON.cedulaPlain}), jurídica ${PERSON.juridica}, IBAN ${PERSON.iban}, desde ${PERSON.ip}, cuenta ${PERSON.userId}`,
          stacktrace: { frames: [{ filename: "/var/task/apps/ops/.next/server/app/pedidos.js" }] },
        },
      ],
    },
  });

/** A database error as packages/db throws it: the short code, a detail that must not leave. */
export const databaseError = () => {
  const error = new Error("insufficient_stock") as Error & {
    code: string;
    detail: string;
    status: number;
  };
  error.name = "ApiError";
  error.code = "insufficient_stock";
  error.detail = `offer ${PERSON.userId} for ${PERSON.email}`;
  error.status = 400;
  return error;
};
