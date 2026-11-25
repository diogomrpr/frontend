import type { Connection } from "home-assistant-js-websocket";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDashboardResources,
  preloadDashboardResources,
} from "../../src/data/preloads";
import type { WindowWithPreloads } from "../../src/data/preloads";
import type { Panels } from "../../src/types";

const panels: Panels = {
  "my-dashboard": {
    url_path: "my-dashboard",
    component_name: "lovelace",
    config: { mode: "storage" },
    title: null,
    icon: null,
  },
};
const send = vi.fn();
const conn = { sendMessagePromise: send } as unknown as Connection;
const preloads = window as WindowWithPreloads;

const start = (path: string) => {
  history.replaceState(null, "", path);
  return preloadDashboardResources(conn);
};

afterEach(() => {
  vi.resetAllMocks();
  delete preloads.dashboardResourcePreload;
  delete preloads.llResProm;
  history.replaceState(null, "", "/");
});

describe("dashboard resource list preload", () => {
  it("requests just the resource list for the initial registered dashboard", async () => {
    const resources = [{ id: "test", url: "/example.js", type: "module" }];
    send.mockResolvedValue(resources);
    const publish = start("/my-dashboard/room");
    expect(send).not.toHaveBeenCalled();
    publish(panels);
    publish(panels);
    expect(await fetchDashboardResources(conn, "my-dashboard")).toBe(resources);
    publish(panels);
    expect(preloads.dashboardResourcePreload).toBeUndefined();
    expect(send.mock.calls).toEqual([[{ type: "lovelace/resources" }]]);
  });

  it.each(["/", "/lovelace/0"])(
    "preserves the existing preload on %s",
    async (path) => {
      const resources = [
        { id: "test", url: "/example.js", type: "module" as const },
      ];
      preloads.llResProm = Promise.resolve(resources);
      start(path)(panels);
      expect(await fetchDashboardResources(conn, "my-dashboard")).toBe(
        resources
      );
      expect(send).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { "my-dashboard": { ...panels["my-dashboard"], config: null } },
    { "my-dashboard": { ...panels["my-dashboard"], component_name: "custom" } },
  ] as Panels[])(
    "requires a visible Lovelace panel with a configured mode",
    (registered) => {
      const publish = start("/my-dashboard");
      publish(registered);
      publish(panels);
      expect(send).not.toHaveBeenCalled();
    }
  );

  it("does not start the request after leaving the dashboard", () => {
    const publish = start("/my-dashboard");
    history.replaceState(null, "", "/config");
    publish(panels);
    history.replaceState(null, "", "/my-dashboard");
    publish(panels);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a late panel notification after the normal request", async () => {
    send.mockResolvedValue([]);
    const publish = start("/my-dashboard");
    await fetchDashboardResources(conn, "my-dashboard");
    publish(panels);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a rejected preload when the resource list is used", async () => {
    send
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValueOnce([]);
    start("/my-dashboard")(panels);
    expect(await fetchDashboardResources(conn, "my-dashboard")).toEqual([]);
    expect(send.mock.calls).toEqual([
      [{ type: "lovelace/resources" }],
      [{ type: "lovelace/resources" }],
    ]);
  });

  it("discards a list from a previous connection", async () => {
    send.mockResolvedValue([]);
    start("/my-dashboard")(panels);
    const other = { sendMessagePromise: vi.fn().mockResolvedValue(["fresh"]) };
    expect(
      await fetchDashboardResources(
        other as unknown as Connection,
        "my-dashboard"
      )
    ).toEqual(["fresh"]);
    expect(other.sendMessagePromise).toHaveBeenCalledWith({
      type: "lovelace/resources",
    });
  });
});
