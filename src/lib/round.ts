/**
 * Decimal rounding that matches Python's `round()`.
 *
 * The scale protocol and the body-composition algorithm were both reverse
 * engineered in Python, and their published behaviour is Python's rounding:
 * correct rounding of the exact double, ties to even. Salutt reproduces it so
 * its numbers match the vendor app's bit for bit — which matters more than it
 * sounds, because body fat is *floored* off a BMI derived from the weight, so
 * a difference in the last decimal can shift every downstream metric.
 *
 * Two things that look equivalent and are not:
 *
 *   Math.round(v * 10**dp) / 10**dp
 *     The multiply carries its own error, which can shove a value sitting just
 *     below a midpoint onto or past it. 44.535 is stored as 44.53499999…, and
 *     Python rounds it down; this expression rounds it up.
 *
 *   Number(v.toFixed(dp))
 *     Correct on the exact double, but rounds ties *away from zero* where
 *     Python rounds them to even. Only bites on genuinely representable
 *     midpoints such as 3.625 or 151.625 — which real gram readings hit often.
 */

/**
 * Number of halvings needed to reach an integer: a double is exactly
 * `odd / 2^k` for this k. Doubling is always exact, so this is reliable.
 */
function dyadicExponent(v: number): number {
  let x = Math.abs(v)
  let k = 0
  while (!Number.isInteger(x) && k < 1100) {
    x *= 2
    k++
  }
  return k
}

export function pyRound(v: number, dp: number): number {
  if (!Number.isFinite(v)) return v

  // A value is an exact midpoint at `dp` decimals only if it is odd/2^(dp+1).
  // Testing `v * 10**dp % 1 === 0.5` would misfire, flagging values that were
  // never really midpoints as ties.
  if (dyadicExponent(v) === dp + 1) {
    const f = Math.pow(10, dp)
    const down = Math.floor(Math.abs(v) * f)
    const even = down % 2 === 0 ? down : down + 1
    return (Math.sign(v) * even) / f
  }
  return Number(v.toFixed(dp))
}
