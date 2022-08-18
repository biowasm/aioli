const { defineConfig } = require("cypress");

module.exports = defineConfig({
	fixturesFolder: false,
	video: false,
	screenshotOnRunFailure: false,
	defaultCommandTimeout: 40000,
	port: 11111,
	e2e: {
		specPattern: "tests/*.cy.js",
		supportFile: false,
	},
});
