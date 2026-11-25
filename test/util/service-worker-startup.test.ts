import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStartupPrecachePlugin,
  prioritizeFrontendStartup,
} from "../../src/util/service-worker-startup";

const requestLock =
  vi.fn<
    (
      name: string,
      options: LockOptions,
      callback: () => unknown
    ) => Promise<unknown>
  >();
const request = new Request("https://ha.example/frontend_latest/lazy.js");

const beforeFetch = (
  plugin: ReturnType<typeof createStartupPrecachePlugin>,
  type: string
) =>
  plugin.requestWillFetch!({
    request,
    event: new Event(type) as ExtendableEvent,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("navigator", {
    serviceWorker: {},
    locks: { request: requestLock },
  });
  requestLock
    .mockReset()
    .mockImplementation(async (_name, _options, callback) => callback());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("foreground startup", () => {
  it("releases even when the panel was ready before the lock was granted", async () => {
    let grant!: () => void;
    const pending = new Promise<void>((resolve) => {
      grant = resolve;
    });
    requestLock.mockImplementation(async (_name, _options, callback) => {
      await pending;
      return callback();
    });
    const completed = prioritizeFrontendStartup();
    expect(requestLock).toHaveBeenCalledWith(
      "ha-frontend-startup",
      { mode: "shared" },
      expect.any(Function)
    );
    window.releaseFrontendStartup!();
    grant();
    await completed;
    expect(window.releaseFrontendStartup).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pagehide", "hidden", "timeout"])(
    "releases the foreground lock on %s",
    async (reason) => {
      const completed = prioritizeFrontendStartup();
      if (reason === "hidden") {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (reason === "pagehide") {
        window.dispatchEvent(new Event("pagehide"));
      } else {
        await vi.runAllTimersAsync();
      }
      await completed;
      expect(window.releaseFrontendStartup).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("skips HTTP origins where Home Assistant does not register a worker", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:8123"));
    await prioritizeFrontendStartup();
    expect(requestLock).not.toHaveBeenCalled();
  });

  it("does not hold up installation for an initially hidden document", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await prioritizeFrontendStartup();
    expect(requestLock).not.toHaveBeenCalled();
  });
});

describe("the precache install barrier", () => {
  it("lets runtime fetches through while an install fetch waits", async () => {
    let grant!: () => void;
    requestLock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        })
    );
    const plugin = createStartupPrecachePlugin();
    const install = beforeFetch(plugin, "install");
    let resumed = false;
    void install.then(() => {
      resumed = true;
    });
    expect(await beforeFetch(plugin, "fetch")).toBe(request);
    expect(resumed).toBe(false);
    expect(requestLock).toHaveBeenCalledTimes(1);
    grant();
    expect(await install).toBe(request);
  });

  it("bounds the total wait over multiple transfers and drops expired requests", async () => {
    requestLock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 90_000);
        })
    );
    requestLock.mockImplementationOnce(
      (_name, options) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const plugin = createStartupPrecachePlugin();
    const first = beforeFetch(plugin, "install");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await first).toBe(request);
    const second = beforeFetch(plugin, "install");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await second).toBe(request);
    expect(await beforeFetch(plugin, "install")).toBe(request);
    expect(requestLock).toHaveBeenCalledTimes(2);
  });
});

it.each(["unsupported", "denied"])(
  "continues startup and installation when locks are %s",
  async (problem) => {
    if (problem === "unsupported") {
      vi.stubGlobal("navigator", {});
    } else {
      requestLock.mockRejectedValue(
        new DOMException("Denied", "SecurityError")
      );
    }
    await prioritizeFrontendStartup();
    expect(window.releaseFrontendStartup).toBeUndefined();
    expect(await beforeFetch(createStartupPrecachePlugin(), "install")).toBe(
      request
    );
    expect(vi.getTimerCount()).toBe(0);
  }
);
