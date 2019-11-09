const fs = require("fs");
const YAML = require("yaml");
const { execSync } = require("child_process");
const core = require("@actions/core");
const github = require("@actions/github");
const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const [zone_id, account_id, api_key, email] = core
  .getInput("cloudflare")
  .split("::");

const cloudflare = require("./cloudflare");

execSync("rm -rf ./.workers");

fs.mkdirSync("./.workers");
try {
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

      const func = require(`${cwd
        .toString()
        .trim()}/.workers/${name}/define.js`);
      let wpackageJson = JSON.parse(
        fs.readFileSync(`./.workers/${name}/package.json`)
      );
      wpackageJson.dependencies = func.dependencies || {};

      fs.writeFileSync(
        `./.workers/${name}/package.json`,
        JSON.stringify(wpackageJson)
      );
      let npm0 = execSync(`npm install`, {
        cwd: `./.workers/${name}`
      });
      fs.writeFileSync(
        `./.workers/${name}/deps.js`,
        `module.exports = {
  ${Object.keys(func.dependencies)
    .map(k => `"${k}": require(${k})`)
    .join(",\n")}
}`
      );
      console.log(npm0.toString());
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
        await api.zone(zone_id).create(`${name}.${func.domain}`);
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
} catch (e) {
  console.log(e.toString());
  process.exit(1);
}
