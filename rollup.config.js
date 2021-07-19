import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "rollup-plugin-terser";
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
		plugins: [ resolve(), commonjs(), terser.terser() ]
	},
	// WebWorker
	{
		input: "src/worker.js",
		output: {
			file: pkg.worker,
		},
		plugins: [ resolve(), commonjs(), terser.terser() ]
	}
];
