const fs = require("fs");
const YAML = require("yaml");
const { execSync } = require("child_process");
const core = require("@actions/core");
const github = require("@actions/github");

const home = execSync(`echo ~`)
  .toString()
  .trim();
const conductor_manifest = YAML.parse(
  fs.readFileSync(home + "/.conductor_manifest.yaml", "utf8")
);
const cloudflare = require("./cloudflare");
if (process.argv[2] == "init") {
  let s = execSync("git init");
  console.log(s.toString());
  try {
    fs.mkdirSync("./workers");
  } catch (e) {}
  fs.writeFileSync(
    "./package.json",
    `{
        "name": "${process.argv[3] || "conductor-workers"}",
        "version": "1.0.0",
        "description": "",
        "scripts": {
          "test": "echo 'Error: no test specified' && exit 1"
        },
        "author": "",
        "license": "MIT"
      }`
  );
  fs.writeFileSync(
    "./workers/example.js",
    `module.exports = {
    get: {
        '/foo/:bar': async (req, { bar }, { status }) => {
            return status(200).json({ hello: bar })
        },
        '(.*)': async (req, { bar }, { status }) => {
            return status(404).json({ error: 'Not found' })
        },
    },
}
`
  );
  process.exit(0);
}
execSync("rm -rf ./compiled_workers");
fs.mkdirSync("./compiled_workers");
Promise.all(
  fs.readdirSync("./workers").map(async file => {
    const name = file.slice(0, -3);
    let std = execSync(
      `wrangler generate ${name} https://github.com/penalosa/worker-template-simple-serve`,
      { cwd: "./compiled_workers" }
    );
    console.log(std.toString());
    fs.writeFileSync(
      `./compiled_workers/${name}/define.js`,
      fs.readFileSync(`workers/${file}`)
    );
    const cwd = execSync("pwd");
    const func = require(`${cwd.toString().trim()}/workers/${file}`);
    let account = Object.keys(conductor_manifest.accounts).find(
      ai =>
        !!Object.keys(conductor_manifest.accounts[ai].domains).find(
          d => d == func.domain
        )
    );
    let account_id;
    if (account) {
      account_id = account;
      account = conductor_manifest.accounts[account];
    } else {
      console.error("Account not found for domain", domain);
      process.exit(1);
    }
    const api = cloudflare(account.api_key, account.email);
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
      `./compiled_workers/${name}/wrangler.toml`,
      `account_id = "${account_id}"
name = "${name}"
type = "webpack"

[env.prod]
route = "https://${name}.${func.domain}/*"
zone_id = "${account.domains[func.domain].zone_id}"
kv-namespaces = [
${namespaces
  .map(ns => `{ binding = "bound_${ns.title}", id = "${ns.id}" }`)
  .join(",\n")}
]`
    );
    fs.writeFileSync(
      `./compiled_workers/${name}/bindings.js`,
      `module.exports = {
  ${namespaces.map(ns => `${ns.title}: bound_${ns.title},`).join("\n")}
}`
    );
    let hasRecord = await api
      .zone(account.domains[func.domain].zone_id)
      .has(`${name}.${func.domain}`);
    if (!hasRecord.result.length) {
      console.error(`DNS record does not exist for ${name}.${func.domain}`);
      console.error(`Creating...`);
      await api
        .zone(account.domains[func.domain].zone_id)
        .create(`${name}.${func.domain}`);
      console.log(`Created`);
    }

    let stdComm = execSync(
      `CF_API_KEY=${account.api_key} CF_EMAIL=${account.email} wrangler ${
        process.argv.slice(2).length
          ? process.argv.slice(2).join(" ")
          : "publish"
      }`,
      {
        cwd: `./compiled_workers/${name}`
      }
    );
    console.log(stdComm.toString());
  })
);
