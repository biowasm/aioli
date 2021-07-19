import * as Comlink from "comlink";

const obj = {
    counter: 0,
    inc() {
        this.counter++;
    },
    mount() {
        console.log("mount")
    }
};

Comlink.expose(obj);
