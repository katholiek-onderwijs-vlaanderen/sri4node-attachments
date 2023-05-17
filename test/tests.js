/* eslint-env node, mocha */
const expressFactory = require("express");
const sri4node = require("sri4node");
const sleep = require('await-sleep');

const sri4nodeConfigFactory = require("./context/config");

const testPartyAttachmentsAfterUpdateMod =  require("./testPartyAttachmentsAfterUpdate");

const port = 5000;
const base = `http://localhost:${port}`;

const httpClientMod = require("./httpClient.js");
const httpClient = httpClientMod.httpClientFactory(base);

const { info, error } = require("../js/common");

describe("sri4node-attachments : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    try {
      const app = expressFactory();
      const sriConfig = await sri4nodeConfigFactory();
      sriConfig.description = 'config of sri4node-attachments';
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
      await server.close();
    } catch (err) {
      console.log("Closing express server failed");
    }
    try {
      await sri4nodeServerInstance.pgp.end();
    } catch (err) {
      console.log("Closing sri4nodeServerInstance failed");
    }
  });

  require("./unitTests");
  require("./testPartyAttachments")(httpClient, "/partiesS3");

  // local storage is currenlty not supported anymore
  // require("./testPartyAttachments")(base, "/partiesFolder");
});


describe("sri4node-attachments(2) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    try {
      // It seems that Express has no method to deinitialize or to clear routes.
      // Workaround: let the 'app' variable go out of scope and wait 5 seconds, this
      // seems to deinitialize Express. If Express is just reinitiated with its new
      // configuration without some waiting before usage, Express keeps using the old
      // routes (probably somehow cached).
      const app = expressFactory();
      await sleep(5000);

      const handleMultipleUploadsTogether = false;
      const uploadInSequence = false;
      const sriConfig = await sri4nodeConfigFactory(handleMultipleUploadsTogether, uploadInSequence, testPartyAttachmentsAfterUpdateMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence));
      sriConfig.description = 'config of sri4node-attachments(2)';
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
      await server.close();
    } catch (err) {
      console.log("Closing express server failed");
    }
    try {
      await sri4nodeServerInstance.pgp.end();
    } catch (err) {
      console.log("Closing sri4nodeServerInstance failed");
    }
  });

  testPartyAttachmentsAfterUpdateMod.factory(httpClient, "/partiesS3");
});

describe("sri4node-attachments(3) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;
  const checkStoreAttachmentsReceivedList = [];

  before(async () => {
    try {
      // It seems that Express has no method to deinitialize or to clear routes.
      // Workaround: let the 'app' variable go out of scope and wait 5 seconds, this
      // seems to deinitialize Express. If Express is just reinitiated with its new
      // configuration without some waiting before usage, Express keeps using the old
      // routes (probably somehow cached).
      const app = expressFactory();
      await sleep(5000);

      const handleMultipleUploadsTogether = false;
      const uploadInSequence = true;
      const sriConfig = await sri4nodeConfigFactory(handleMultipleUploadsTogether, uploadInSequence, testPartyAttachmentsAfterUpdateMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence, checkStoreAttachmentsReceivedList));
      sriConfig.description = 'config of sri4node-attachments(3)';
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
      await server.close();
    } catch (err) {
      console.log("Closing express server failed");
    }
    try {
      await sri4nodeServerInstance.pgp.end();
    } catch (err) {
      console.log("Closing sri4nodeServerInstance failed");
    }
  });

  testPartyAttachmentsAfterUpdateMod.factory(httpClient, "/partiesS3", checkStoreAttachmentsReceivedList);
});


describe("sri4node-attachments(4) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    try {
      // It seems that Express has no method to deinitialize or to clear routes.
      // Workaround: let the 'app' variable go out of scope and wait 5 seconds, this
      // seems to deinitialize Express. If Express is just reinitiated with its new
      // configuration without some waiting before usage, Express keeps using the old
      // routes (probably somehow cached).
      const app = expressFactory();
      await sleep(5000);

      const handleMultipleUploadsTogether = true;
      const uploadInSequence = true;
      const sriConfig = await sri4nodeConfigFactory(handleMultipleUploadsTogether, uploadInSequence, testPartyAttachmentsAfterUpdateMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence));
      sriConfig.description = 'config of sri4node-attachments(4)';
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
      await server.close();
    } catch (err) {
      console.log("Closing express server failed");
    }
    try {
      await sri4nodeServerInstance.pgp.end();
    } catch (err) {
      console.log("Closing sri4nodeServerInstance failed");
    }
  });

  testPartyAttachmentsAfterUpdateMod.factory(httpClient, "/partiesS3");
});
