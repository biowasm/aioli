import resolve from "@rollup/plugin-node-resolve";  // Resolve node import statements
import commonjs from "@rollup/plugin-commonjs";     // ES module conversion
import terser from "rollup-plugin-terser";          // Minify JS to save space
import json from "@rollup/plugin-json";             // Allow us to import JSON from main.js
import pkg from "./package.json";

export default [
	// Browser-friendly UMD build
	{
		input: "src/main.js",
		output: {
			name: "Aioli",
			file: pkg.browser,
			format: "umd"
		},
		plugins: [ resolve(), commonjs(), terser.terser(), json() ]
	},
	// WebWorker
	{
		input: "src/worker.js",
		output: {
			file: pkg.worker,
		},
		plugins: [ resolve(), commonjs(), terser.terser(), json() ]
	}
];
