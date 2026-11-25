import type { Connection } from "home-assistant-js-websocket";
import type { Panels } from "../types";
import type { LovelaceRawConfig } from "./lovelace/config/types";
import type { LovelaceResource } from "./lovelace/resource";
import { fetchResources } from "./lovelace/resource";
import type { RecorderInfo } from "./recorder";

export interface WindowWithPreloads extends Window {
  llConfProm?: Promise<LovelaceRawConfig>;
  dashboardResourcePreload?: {
    connection: Connection;
    urlPath: string;
    resources?: Promise<LovelaceResource[]>;
  };
  llResProm?: Promise<LovelaceResource[]>;
  recorderInfoProm?: Promise<RecorderInfo>;
}

export const preloadDashboardResources = (conn: Connection) => {
  const preloads = window as WindowWithPreloads;
  const path = location.pathname;
  const urlPath = path.split("/")[1];
  // The root and direct Lovelace routes already preload the resource list.
  if (urlPath && !path.startsWith("/lovelace/")) {
    preloads.dashboardResourcePreload = { connection: conn, urlPath };
  }
  return (panels: Panels) => {
    const preload = preloads.dashboardResourcePreload;
    if (preload?.connection !== conn || preload.resources) {
      return;
    }
    const panel = panels[preload.urlPath];
    if (
      location.pathname.split("/")[1] !== preload.urlPath ||
      panel?.component_name !== "lovelace" ||
      !panel.config?.mode
    ) {
      preloads.dashboardResourcePreload = undefined;
      return;
    }
    preload.resources = fetchResources(conn);
    preload.resources.catch(() => {
      // Retried when the panel opens.
    });
  };
};

export const fetchDashboardResources = (conn: Connection, urlPath: string) => {
  const preloads = window as WindowWithPreloads;
  const preload = preloads.dashboardResourcePreload;
  preloads.dashboardResourcePreload = undefined;
  if (
    preload?.connection === conn &&
    preload.urlPath === urlPath &&
    preload.resources
  ) {
    return preload.resources.catch(() => fetchResources(conn));
  }
  return preloads.llResProm ?? fetchResources(conn);
};
