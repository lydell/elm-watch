import * as Decode from "tiny-decoders";

export type Port = {
  tag: "Port";
  thePort: number;
};

export const Port = Decode.chain(Decode.number, (number): Port => {
  const min = 1;
  const max = 65535;
  if (Number.isInteger(number) && min <= number && number <= max) {
    return {
      tag: "Port",
      thePort: number,
    };
  }
  throw new Decode.DecoderError({
    message: `Expected an integer where ${min} <= port <= ${max}`,
    value: number,
  });
});
