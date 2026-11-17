const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The Rails and client adapters share this small, public routing contract.
// Watch only its config directory, rather than the API's gems and runtime files.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../api/config')];
module.exports = config;
