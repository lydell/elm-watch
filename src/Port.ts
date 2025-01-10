import * as Codec from "tiny-decoders";

export type PortChoice =
  | { tag: "NoPort" }
  | { tag: "PersistedPort"; port: Port }
  | { tag: "PortFromConfig"; port: Port };

export type Port = number & {
  readonly Port: never;
};

export function markAsPort(number: number): Port {
  return number as Port;
}

export const Port: Codec.Codec<Port, number> = Codec.flatMap(Codec.number, {
  decoder: (number) => {
    const min = 1;
    const max = 65535;
    return Number.isInteger(number) && min <= number && number <= max
      ? {
          tag: "Valid",
          value: markAsPort(number),
        }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: `Expected an integer where ${min} <= port <= ${max}`,
            got: number,
            path: [],
          },
        };
  },
  encoder: (port) => port,
});
