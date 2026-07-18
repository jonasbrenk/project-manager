import { readFile } from "node:fs/promises";
import { minify } from "csso";

const files = [
  "app/static/app-shell.css",
  "app/static/landing-page.css",
  "app/static/project-view.css",
];

let sourceBytes = 0;
let optimizedBytes = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  // Do not restructure rules: the audit must never obscure cascade order.
  const optimized = minify(source, { restructure: false }).css;
  sourceBytes += Buffer.byteLength(source);
  optimizedBytes += Buffer.byteLength(optimized);
  console.log(`${file}: ${Buffer.byteLength(source)} B source, ${Buffer.byteLength(optimized)} B non-restructuring minified`);
}

console.log(`Total: ${sourceBytes} B source, ${optimizedBytes} B non-restructuring minified`);
