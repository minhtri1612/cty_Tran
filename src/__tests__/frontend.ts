import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "../..");
const scripts = ["utils", "state", "dashboard", "materials", "count", "docs", "orders", "contacts", "settings"];

// Loads the real browser scripts into a VM with a minimal DOM stub, so the
// state mutations they make can be checked against the server's validation.
// Rendering, saving and modals are replaced; only data logic runs.
export function loadFrontend() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: "", innerHTML: "", textContent: "", hidden: false, style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, focus() {}, addEventListener() {}, querySelectorAll: () => [],
      });
    }
    return elements.get(id);
  };
  const toasts: string[] = [];
  const context = vm.createContext({
    console, structuredClone, setTimeout, clearTimeout, URL,
    window: { scrollTo() {} },
    confirm: () => true,
    document: { addEventListener() {}, getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    __toasts: toasts,
  });
  for (const name of scripts) {
    vm.runInContext(readFileSync(resolve(root, `static/js/${name}.js`), "utf8"), context, { filename: `${name}.js` });
  }
  vm.runInContext(`
    toast = (message) => __toasts.push(message);
    render = () => {}; renderNav = () => {}; go = () => {}; closeModal = () => {};
    persist = async () => true;
    openModal = (title, body, onSave) => { globalThis.__save = onSave; };
    globalThis.__getData = () => data;
    globalThis.__setData = (next) => { data = next; currentRole = "admin"; currentUser = "owner"; };
  `, context);
  return {
    toasts,
    element,
    get data() { return structuredClone(context.__getData()); },
    set data(next) { context.__setData(structuredClone(next)); },
    run: (code: string) => vm.runInContext(code, context),
    save: () => context.__save(),
  };
}
