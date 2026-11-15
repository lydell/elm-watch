import * as Codec from "tiny-decoders";

export type PortChoice =
  | { tag: "NoPort" }
  | { tag: "PersistedPort"; port: Port }
  // `persistedPort` is kept in stuff.json instead of `port`, so that a port
  // only set for one run isn't reused by later runs without a port.
  | { tag: "PortFromConfig"; port: Port; persistedPort: Port | undefined };

// The port to save in stuff.json, given the port the server got.
export function portToPersist(
  portChoice: PortChoice,
  actualPort: Port,
): Port | undefined {
  switch (portChoice.tag) {
    case "NoPort":
    case "PersistedPort":
      return actualPort;

    case "PortFromConfig":
      return portChoice.persistedPort;
  }
}

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
