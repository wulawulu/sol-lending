import Module from "module";

const globalAny = globalThis as { __rpcWebsocketsCompatApplied?: boolean };

if (!globalAny.__rpcWebsocketsCompatApplied) {
  globalAny.__rpcWebsocketsCompatApplied = true;

  const modulePrototype = Module.prototype as unknown as {
    require: NodeRequire;
  };
  const originalRequire = modulePrototype.require;

  modulePrototype.require = function patched(
    this: unknown,
    request: string,
    ...rest: unknown[]
  ) {
    if (request === "rpc-websockets/dist/lib/client") {
      const resolved = originalRequire.call(
        this,
        "rpc-websockets"
      ) as Record<string, unknown>;

      if (resolved && typeof resolved === "object") {
        const compat = { ...(resolved as Record<string, unknown>) };
        const defaultExport =
          (resolved as Record<string, unknown>)["CommonClient"] ??
          (resolved as Record<string, unknown>)["Client"] ??
          (resolved as Record<string, unknown>)["default"];

        if (defaultExport) {
          compat["default"] = defaultExport;
        }

        if (
          compat["CommonClient"] === undefined &&
          (resolved as Record<string, unknown>)["Client"]
        ) {
          compat["CommonClient"] = (resolved as Record<string, unknown>)["Client"];
        }

        return compat;
      }

      return resolved;
    }

    if (request === "rpc-websockets/dist/lib/client/websocket") {
      const resolved = originalRequire.call(
        this,
        "rpc-websockets"
      ) as Record<string, unknown>;
      const factory =
        (resolved as Record<string, unknown>)["WebSocket"] ??
        (resolved as Record<string, unknown>)["default"] ??
        resolved;

      if (typeof factory === "function") {
        return {
          __esModule: true,
          default: factory,
          WebSocket: factory,
        };
      }

      return factory;
    }

    return originalRequire.call(this, request, ...rest);
  };
}
