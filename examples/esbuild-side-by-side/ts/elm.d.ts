// Types for the compiled Elm code, which is loaded via a separate script tag
// and is available as `window.Elm`.
declare global {
  interface Window {
    Elm: {
      Main: {
        init: (options: { node: HTMLElement | null }) => {
          ports: {
            celebrate: {
              subscribe: (callback: (count: number) => void) => void;
            };
          };
        };
      };
    };
  }
}

export {};
