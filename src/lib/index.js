export * from "preact";

import { h } from "preact";
import htm from "htm";
export const html = htm.bind(h);

import * as linkifyjs from "linkifyjs";
export { linkifyjs };
