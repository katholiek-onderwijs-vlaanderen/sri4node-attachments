/* eslint-env node, mocha */
const express = require("express");
const sri4node = require("sri4node");

const app = express();

const sri4nodeConfigFactory = require("./context/config");

const sriConfigPromise = sri4nodeConfigFactory();
const port = 5000;
const base = `http://localhost:${port}`;


const httpClientMod = require("./httpClient.js");
const httpClient = httpClientMod.httpClientFactory(base);


const common = require("../js/common");

const { info } = common;
const { error } = common;

describe("sri4node-attachments : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    try {
      const sriConfig = await sriConfigPromise;
      sri4nodeServerInstance = await sri4node.configure(app, sriConfig);
      app.set("port", port);
      server = app.listen(port, () => {
        info(`Node app is running at localhost:${port}`);
      });
    } catch (err) {
      error("Unable to start server.");
      error(err);
      error(err.stack);
    }
  });

  after(async () => {
    // enable this to keep the server running for inspection
    // await new Promise(() => {});
    try {
      server.close();
    } catch (err) {
      console.log("Closing express server failed");
    }
    try {
      sri4nodeServerInstance.pgp.end();
    } catch (err) {
      console.log("Closing sri4nodeServerInstance failed");
    }
  });

  // require("./unitTests");
  require("./testPartyAttachments")(httpClient, "/partiesS3");

  // local storage is currenlty not supported anymore
  // require("./testPartyAttachments")(base, "/partiesFolder");
});
