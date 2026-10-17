/**
 * Hash layout (24 bits, always a non-negative uint32):
 *   bits 15..23  f1  (anchor bin, 9 bits, 0–511)
 *   bits  6..14  f2  (target bin, 9 bits, 0–511)
 *   bits  0..5   dt  (frames between anchor and target, 6 bits, 0–63)
 */
export const F_BITS = 9;
export const DT_BITS = 6;
const F_MASK = (1 << F_BITS) - 1;
const DT_MASK = (1 << DT_BITS) - 1;

export const MAX_F = F_MASK;
export const MAX_DT = DT_MASK;

export function packHash(f1: number, f2: number, dt: number): number {
  return (((f1 & F_MASK) << (F_BITS + DT_BITS)) | ((f2 & F_MASK) << DT_BITS) | (dt & DT_MASK)) >>> 0;
}

export function unpackHash(hash: number): { f1: number; f2: number; dt: number } {
  return {
    f1: (hash >>> (F_BITS + DT_BITS)) & F_MASK,
    f2: (hash >>> DT_BITS) & F_MASK,
    dt: hash & DT_MASK,
  };
}
