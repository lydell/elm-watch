import * as Codec from "./Codec";

export type PortChoice =
  | { tag: "NoPort" }
  | { tag: "PersistedPort"; port: Port }
  | { tag: "PortFromConfig"; port: Port };

export type Port = {
  tag: "Port";
  thePort: number;
};

export const Port = Codec.chain(Codec.number, {
  decoder(number): Port {
    const min = 1;
    const max = 65535;
    if (Number.isInteger(number) && min <= number && number <= max) {
      return {
        tag: "Port",
        thePort: number,
      };
    }
    throw new Codec.DecoderError({
      message: `Expected an integer where ${min} <= port <= ${max}`,
      value: number,
    });
  },
  encoder: ({ thePort }) => thePort,
});
