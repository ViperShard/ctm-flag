/**
 * Webpack build for CTM Flag.
 *
 * What this does, in plain terms:
 *   - Takes src/content.js (which imports the Firebase SDK + src/firebase.js)
 *     and bundles EVERYTHING into a single dist/content.js file. The Firebase
 *     library gets baked right into that file, so the extension has no runtime
 *     dependency on the internet to *load* — only Firestore's own network calls
 *     happen at runtime.
 *   - Copies the static files (manifest.json, src/style.css, icons/) into dist/
 *     unchanged, because those don't need bundling.
 *
 * The dist/ folder is the finished extension. That's the folder you load into
 * Chrome/Edge via "Load unpacked".
 */
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  // The single entry point. Webpack follows every `import` from here.
  entry: {
    content: "./src/content.js",
  },
  output: {
    // Output filenames match the entry keys -> dist/content.js
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    clean: true, // wipe dist/ before each build so old files never linger
  },
  // Content scripts can't use webpack's lazy-loaded "chunks", so keep it to one file.
  optimization: {
    splitChunks: false,
  },
  performance: {
    // Firebase is chunky (~hundreds of KB). That's expected for a bundled SDK,
    // so silence the "asset too big" warning rather than have it look like an error.
    hints: false,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "src/style.css", to: "style.css" },
        { from: "icons", to: "icons" },
      ],
    }),
  ],
};
