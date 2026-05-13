/**
 * tsc لا يحوّل مسارات tsconfig "paths" (@/*) في مخرجات dist، فيبقى require("@/…") ويفشل في وقت التشغيل.
 * يُربط @ بمجلد dist (نفس مجلد main.js بعد البناء).
 */
import * as moduleAlias from "module-alias";
import { resolve } from "node:path";

moduleAlias.addAliases({
  "@": resolve(__dirname),
});
