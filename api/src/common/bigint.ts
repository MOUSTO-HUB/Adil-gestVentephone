/**
 * Les montants sont en BigInt dans la base (Prisma) ; JSON ne connaît pas BigInt.
 * Ils sont envoyés comme des nombres, exacts jusqu'à Number.MAX_SAFE_INTEGER (9 × 10^15).
 */
export function convertirBigIntEnJson(): void {
  (BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
    if (this > BigInt(Number.MAX_SAFE_INTEGER) || this < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`Montant trop grand pour JSON : ${this}`);
    }
    return Number(this);
  };
}
