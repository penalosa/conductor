const fetch = require("node-fetch");
const apiBase = "https://api.cloudflare.com/client/v4/";

module.exports = (api_key, auth_email) => {
  const req = ({ headers, ...rest }, path) =>
    fetch(`${apiBase}${path}`, {
      headers: {
        "X-Auth-Key": api_key,
        "X-Auth-Email": auth_email,
        "Content-Type": "application/json",
        ...(headers || {})
      },
      ...rest
    }).then(r => r.json());
  const request = {
    get: path => req({}, path),
    post: (path, body) =>
      req({ body: JSON.stringify(body), method: "POST" }, path)
  };
  return {
    user: () => request.get(`user`),

    accounts: account_id => ({
      create_namespace: async name => {
        await request.post(`accounts/${account_id}/storage/kv/namespaces`, {
          title: name
        });
        let ret = await request.get(
          `accounts/${account_id}/storage/kv/namespaces`
        );
        console.log(ret);
        return ret.result.find(ns => ns.title == name);
      }
    }),
    zone: zone_id => ({
      dns_records: async () =>
        await request.get(`zones/${zone_id}/dns_records`),
      has: async domain =>
        await request.get(`zones/${zone_id}/dns_records?name=${domain}&type=A`),
      create: async domain =>
        await request.post(`zones/${zone_id}/dns_records`, {
          type: "A",
          name: domain,
          content: "93.184.216.34",
          proxied: true
        })
    })
  };
};
