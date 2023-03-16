/* eslint-env node, mocha */
const express = require("express");
const sri4node = require("sri4node");

const app = express();

const verbose = !!process.env.LOG_DEBUG;

const sri4nodeConfigFactory = require("./context/config");

const sriConfigPromise = sri4nodeConfigFactory(verbose);
const port = 5000;
const base = `http://localhost:${port}`;

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

  // eslint-disable-next-line global-require
  require("./unitTests");
  // eslint-disable-next-line global-require
  require("./testPartyAttachments")(base, "/partiesFolder");
  // eslint-disable-next-line global-require
  require("./testPartyAttachments")(base, "/partiesS3");

  //  require('./testIsolated.js')(base, '/partiesS3');
});
