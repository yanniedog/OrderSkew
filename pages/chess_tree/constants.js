export const APP_VERSION = "1.0.0";

export const STORAGE_KEYS = {
  MODE: "chess_tree.mode",
  REMOTE_API_BASE: "chess_tree.remoteApiBase",
  SETTINGS: "chess_tree.settings"
};

export const ENGINE_MODES = {
  BROWSER: "browser",
  REMOTE: "remote"
};

export const DEFAULT_SETTINGS = {
  seedFen: "start",
  depth: 3,
  branchCap: 12,
  nodeCap: 1500
};

export const LIMITS = {
  MIN_DEPTH: 1,
  MAX_DEPTH: 6,
  MIN_BRANCH_CAP: 1,
  MAX_BRANCH_CAP: 40,
  MIN_NODE_CAP: 100,
  MAX_NODE_CAP: 15000
};

export const SNAPSHOT_SCHEMA_VERSION = 1;
