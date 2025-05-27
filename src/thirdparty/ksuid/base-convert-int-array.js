"use strict";

const maxLength = (array, from, to) =>
  Math.ceil((array.length * Math.log2(from)) / Math.log2(to));

function baseConvertIntArray(array, { from, to, fixedLength = null }) {
  const length =
    fixedLength === null ? maxLength(array, from, to) : fixedLength;
  const result = new Array(length);

  // Each iteration prepends the resulting value, so start the offset at the end.
  let offset = length;
  let input = array;
  while (input.length > 0) {
    if (offset === 0) {
      throw new RangeError(
        `Fixed length of ${fixedLength} is too small, expected at least ${maxLength(array, from, to)}`,
      );
    }

    const quotients = [];
    let remainder = 0;

    for (const digit of input) {
      const acc = digit + remainder * from;
      const q = Math.floor(acc / to);
      remainder = acc % to;

      if (quotients.length > 0 || q > 0) {
        quotients.push(q);
      }
    }

    result[--offset] = remainder;
    input = quotients;
  }

  // Trim leading padding, unless length is fixed.
  if (fixedLength === null) {
    return offset > 0 ? result.slice(offset) : result;
  }

  // Fill in any holes in the result array.
  while (offset > 0) {
    result[--offset] = 0;
  }
  return result;
}
export default baseConvertIntArray;
