import { execFileSync } from "node:child_process";

const mainRepo = process.env.BLANWHI_MAIN_REPO || "https://github.com/khaitamphatphap-bit/web-blanwhi";
const backupRepo = process.env.BLANWHI_BACKUP_REPO || "https://github.com/nguyencaothuan01-ux/web-blanwhi";
const shouldPushBackup = process.env.BLANWHI_PUSH_BACKUP !== "0";
const message = process.argv.slice(2).join(" ").trim() || `Update BLANWHI site ${new Date().toISOString()}`;

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  }).trim();
}

function runVisible(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

const status = run("git", ["status", "--porcelain"]);

if (!status) {
  console.log("No local changes to publish.");
  process.exit(0);
}

const branch = run("git", ["branch", "--show-current"]);

if (branch !== "main") {
  throw new Error(`Current branch is '${branch}'. Switch to main before publishing.`);
}

runVisible("git", ["fetch", "origin", "main"]);
runVisible("git", ["add", "-A"]);
runVisible("git", ["commit", "-m", message]);
runVisible("git", ["pull", "--rebase", "origin", "main"]);
runVisible("git", ["push", "origin", "HEAD:main"]);

if (shouldPushBackup) {
  runVisible("git", ["push", "backup", "HEAD:main"]);
}

console.log("");
console.log("Published to GitHub.");
console.log("Vercel will deploy automatically from:");
console.log(mainRepo);
console.log("Live site: https://www.blanwhi.com");
