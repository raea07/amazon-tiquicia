/**
 * The list finance takes to the bank when paying sellers, as a CSV file.
 *
 * This is a plain list for a person to work from (or to paste into the bank's
 * own template): one row per transfer with the account, the holder, the
 * amount and the text for the description. It is not any bank's upload format.
 */

export interface BankTransfer {
  /** Destination account, CR and twenty digits. */
  iban: string;
  holderName: string;
  /** Identification of the shop's legal owner, as registered. */
  idNumber: string;
  /** Céntimos. */
  amountMinor: number;
  /** The text for the transfer's description, so the seller can match it. */
  reference: string;
  shop: string;
}

export const TRANSFER_LIST_HEADER = [
  "Cuenta IBAN",
  "Titular",
  "Identificación",
  "Monto (CRC)",
  "Detalle",
  "Tienda",
] as const;

/** Céntimos as a plain decimal a bank form accepts: 8635977 → "86359.77". */
export function plainAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`Invalid amount: ${amountMinor}`);
  const abs = Math.abs(amountMinor);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return amountMinor < 0 ? `-${text}` : text;
}

/**
 * One CSV cell, always quoted. A cell that a spreadsheet would run as a
 * formula (it starts with =, +, - or @, or with a tab or line break) gets a
 * leading apostrophe: names are typed by sellers, and a list of bank transfers
 * is the last place a formula should run.
 */
export function csvCell(value: string): string {
  const text = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

/** The whole file: a header row and one row per transfer, CRLF line ends. */
export function transferListCsv(transfers: readonly BankTransfer[]): string {
  const rows = [
    TRANSFER_LIST_HEADER.map(csvCell),
    ...transfers.map((transfer) =>
      [
        transfer.iban,
        transfer.holderName,
        transfer.idNumber,
        plainAmount(transfer.amountMinor),
        transfer.reference,
        transfer.shop,
      ].map(csvCell),
    ),
  ];
  return `${rows.map((cells) => cells.join(",")).join("\r\n")}\r\n`;
}
