const fs = require("fs");
const YAML = require("yaml");
const { execSync } = require("child_process");
const core = require("@actions/core");
const github = require("@actions/github");
const zone_id = core.getInput("zone_id");
const account_id = core.getInput("account_id");
const api_key = core.getInput("api_key");
const email = core.getInput("email");
const build_command = core.getInput("build_command");

const cloudflare = require("./cloudflare");

execSync("rm -rf ./.workers");
execSync(build_command);

fs.mkdirSync("./.workers");
Promise.all(
  fs.readdirSync("./workers").map(async file => {
    const name = file.slice(0, -3);
    let std = execSync(
      `npx @cloudflare/wrangler generate ${name} https://github.com/penalosa/worker-template-simple-serve`,
      { cwd: "./.workers" }
    );
    console.log(std.toString());
    fs.writeFileSync(
      `./.workers/${name}/define.js`,
      fs.readFileSync(`workers/${file}`)
    );
    const cwd = execSync("pwd");
    const func = require(`${cwd.toString().trim()}/workers/${file}`);

    const api = cloudflare(api_key, email);
    func.namespaces = func.namespaces || [];
    if (!func.namespaces.includes("logs")) {
      func.namespaces.push("logs");
    }
    let namespaces = await Promise.all(
      func.namespaces.map(
        async n => await api.accounts(account_id).create_namespace(n)
      )
    );

    fs.writeFileSync(
      `./.workers/${name}/wrangler.toml`,
      `account_id = "${account_id}"
name = "${name}"
type = "webpack"

[env.prod]
route = "https://${name}.${func.domain}/*"
zone_id = "${zone_id}"
kv-namespaces = [
${namespaces
  .map(ns => `{ binding = "bound_${ns.title}", id = "${ns.id}" }`)
  .join(",\n")}
]`
    );
    fs.writeFileSync(
      `./.workers/${name}/bindings.js`,
      `module.exports = {
  ${namespaces.map(ns => `${ns.title}: bound_${ns.title},`).join("\n")}
}`
    );
    let hasRecord = await api.zone(zone_id).has(`${name}.${func.domain}`);
    if (!hasRecord.result.length) {
      console.error(`DNS record does not exist for ${name}.${func.domain}`);
      console.error(`Creating...`);
      await api
        .zone(account.domains[func.domain].zone_id)
        .create(`${name}.${func.domain}`);
      console.log(`Created`);
    }

    let stdComm = execSync(
      `CF_API_KEY=${api_key} CF_EMAIL=${email} npx @cloudflare/wrangler publish --env prod`,
      {
        cwd: `./.workers/${name}`
      }
    );
    console.log(stdComm.toString());
  })
);
