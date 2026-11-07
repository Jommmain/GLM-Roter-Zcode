import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";

const marker = process.env.GLM_ROUTER_NETWORK_MARKER;

function bomb(name) {
  return () => {
    if (marker) fs.appendFileSync(marker, `${name}\n`);
    const error = new Error(`NETWORK_BLOCKED:${name}`);
    error.code = "NETWORK_BLOCKED";
    throw error;
  };
}

net.connect = bomb("net.connect");
net.createConnection = bomb("net.createConnection");
dns.lookup = bomb("dns.lookup");
dns.resolve = bomb("dns.resolve");
http.request = bomb("http.request");
http.get = bomb("http.get");
https.request = bomb("https.request");
https.get = bomb("https.get");
globalThis.fetch = bomb("fetch");
