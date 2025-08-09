// metro.config.js
const { getDefaultConfig } = require('@expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = {
  ...defaultConfig,
  server: {
    ...defaultConfig.server,
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        // Set custom timeout (in milliseconds) - extend for long-running model responses
        req.setTimeout(600000); // 10 minutes
        res.setTimeout(600000); // 10 minutes

        return middleware(req, res, next);
      };
    }
  },
  watcher: {
    ...defaultConfig.watcher,
    unstable_lazySha1: true, // Enable lazy SHA1 computation for better performance
  }
};