import * as Codec from "./Codec";

export type PortChoice =
  | { tag: "NoPort" }
  | { tag: "PersistedPort"; port: Port }
  | { tag: "PortFromConfig"; port: Port };

export type Port = {
  tag: "Port";
  thePort: number;
};

export const Port = Codec.flatMap(Codec.number, {
  decoder(number) {
    const min = 1;
    const max = 65535;
    return Number.isInteger(number) && min <= number && number <= max
      ? {
          tag: "Valid",
          value: {
            tag: "Port" as const,
            thePort: number,
          },
        }
      : {
          tag: "DecoderError",
          errors: [
            {
              tag: "custom",
              message: `Expected an integer where ${min} <= port <= ${max}`,
              got: number,
              path: [],
            },
          ],
        };
  },
  encoder: ({ thePort }) => thePort,
});
