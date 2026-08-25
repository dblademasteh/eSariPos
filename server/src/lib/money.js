export const cents = (x) => Math.round(Number(x) * 100);
export const fromCents = (c) => Math.round(c) / 100;

// Cash-rounding steps in cents: nickel, dime, or whole unit.
const ROUNDING_STEPS = { step5: 5, step10: 10, step100: 100 };

export function applyCashRounding(totalC, mode) {
  const step = ROUNDING_STEPS[mode];
  if (!step) return { totalC, adjustmentC: 0 };
  const roundedC = Math.round(totalC / step) * step;
  return { totalC: roundedC, adjustmentC: roundedC - totalC };
}
