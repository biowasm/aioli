import pkg from "../package.json";
import * as Comlink from "comlink";


const aioli = {
    //
    tools: [],
    config: {
        a: 42,
        dirData: "",
    },

    //
    async init()
    {
        console.log(aioli.tools);
        console.log(aioli.config)
        console.log(`aioli v${pkg.version}`)
        return 345;
    },

    //
    mount(files) {
        console.log("mount")
        console.log(files[0].name)
        console.log(files[0].size)
        return 123
    },
    set(tools) {

    },
};

Comlink.expose(aioli);
