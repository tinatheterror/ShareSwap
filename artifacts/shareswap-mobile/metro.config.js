const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Exclude other artifacts' node_modules from Metro's file watcher.
// Without this, Metro crashes when Vite creates/deletes temp dirs like
// artifacts/shareswap/node_modules/.vite/deps_temp_* during HMR.
const blockList = [
  /artifacts\/shareswap\/node_modules\/.*/,
  /artifacts\/api-server\/node_modules\/.*/,
  /artifacts\/mockup-sandbox\/node_modules\/.*/,
  /\.migration-backup\/.*/,
];

config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
  ...blockList,
];

module.exports = config;
