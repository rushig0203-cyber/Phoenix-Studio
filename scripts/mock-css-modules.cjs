// Node's component harness has no CSS compiler; the production build checks the actual stylesheet.
require.extensions['.css'] = module => {
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) };
};
