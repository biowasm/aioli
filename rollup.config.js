import resolve from "@rollup/plugin-node-resolve";  // Resolve node import statements
import commonjs from "@rollup/plugin-commonjs";     // ES module conversion
import terser from "rollup-plugin-terser";          // Minify JS to save space
import json from "@rollup/plugin-json";             // Allow us to import JSON from main.js
import pkg from "./package.json";

const production = !process.env.ROLLUP_WATCH;

export default [
	// Browser-friendly UMD build
	{
		input: "src/main.js",
		output: {
			sourcemap: !production,
			name: "Aioli",
			file: pkg.browser,
			format: "umd"
		},
		plugins: [ resolve(), commonjs(), json(), production && terser.terser() ]
	},
	// WebWorker
	{
		input: "src/worker.js",
		output: {
			sourcemap: !production,
			file: pkg.worker,
		},
		plugins: [ resolve(), commonjs(), json(), production && terser.terser() ]
	}
];
