import type { Tone } from "@yuntera/ui";

/** How the console words each state. One place, so screens agree. */

export const STAFF_ROLE: Record<string, string> = {
  admin: "Administración",
  ops: "Operaciones",
  support: "Atención al cliente",
  finance: "Finanzas",
  catalog: "Catálogo",
};

export const PAYMENT_METHOD: Record<string, string> = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Contra entrega",
  bank_transfer: "Transferencia",
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pago pendiente", tone: "warning" },
  authorized: { label: "Autorizado", tone: "info" },
  captured: { label: "Pagado", tone: "success" },
  failed: { label: "Pago fallido", tone: "danger" },
  cancelled: { label: "Pago anulado", tone: "neutral" },
  refunded: { label: "Reembolsado", tone: "neutral" },
  partially_refunded: { label: "Reembolso parcial", tone: "neutral" },
};

export const SELLER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Por verificar", tone: "warning" },
  active: { label: "Activo", tone: "success" },
  suspended: { label: "Suspendido", tone: "danger" },
  closed: { label: "Cerrado", tone: "neutral" },
};

export const DRIVER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Por aprobar", tone: "warning" },
  active: { label: "Activo", tone: "success" },
  suspended: { label: "Suspendido", tone: "danger" },
  offboarded: { label: "Dado de baja", tone: "neutral" },
};

export const ROUTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Sin repartidor", tone: "warning" },
  assigned: { label: "Asignada", tone: "info" },
  in_progress: { label: "En ruta", tone: "info" },
  completed: { label: "Terminada", tone: "success" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const STOP_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "neutral" },
  arrived: { label: "En la puerta", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  failed: { label: "No entregado", tone: "danger" },
  skipped: { label: "Omitida", tone: "neutral" },
};

export const VEHICLE: Record<string, string> = {
  motorcycle: "Moto",
  car: "Carro",
  van: "Microbús de carga",
  bicycle: "Bicicleta",
};

export const RETURN_KIND: Record<string, string> = {
  withdrawal: "Retracto (sin motivo)",
  warranty: "Garantía",
  damaged: "Llegó dañado",
  wrong_item: "Producto equivocado",
};

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Por decidir", tone: "warning" },
  approved: { label: "Aprobada: falta recibir el producto", tone: "info" },
  received: { label: "Producto recibido: falta reembolsar", tone: "info" },
};

export const COMPLAINT_CATEGORY: Record<string, string> = {
  delivery: "Entrega",
  product: "Producto",
  payment: "Pago",
  seller: "Vendedor",
  privacy: "Datos personales",
  other: "Otro",
};

export const REPORT_REASON: Record<string, string> = {
  illegal_product: "Producto ilegal",
  counterfeit: "Falsificación",
  unsafe: "Inseguro",
  misleading: "Engañoso",
  intellectual_property: "Propiedad intelectual",
  abuse: "Abuso",
  other: "Otro",
};

export const FAILURE_REASON: Record<string, string> = {
  nobody_home: "No había nadie",
  wrong_address: "Dirección incorrecta",
  refused: "Lo rechazaron",
  cannot_pay: "No tenían el efectivo",
  unsafe: "Zona insegura",
  damaged: "Paquete dañado",
  other: "Otro",
};
