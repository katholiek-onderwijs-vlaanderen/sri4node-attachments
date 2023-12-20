/* eslint-env node, mocha */
const expressFactory = require("express");
const sri4node = require("sri4node");
const sleep = require('await-sleep');
const uuid = require("uuid");
const assert = require("assert");

const sri4nodeConfigFactory = require("./context/config");

const testPartyAttachmentsCheckStoreAttachmentMod =  require("./testPartyAttachmentsCheckStoreAttachment");

const port = 5000;
const base = `http://localhost:${port}`;

const httpClientMod = require("./httpClient.js");
const httpClient = httpClientMod.httpClientFactory(base);

const { info, error } = require("../js/common");
const { uploadFilesAndCheck, deleteAttachmentAndVerify } = require("./common");

let serverStarted = false;

/**
 * 
 * @param {string} id 
 * @param {boolean} handleMultipleUploadsTogether 
 * @param {boolean} uploadInSequence 
 * @param {*} customStoreAttachment 
 * @param {*} customCheckDownload
 * @returns 
 */
const initServer = async (id, handleMultipleUploadsTogether, uploadInSequence, customStoreAttachment, customCheckDownload) => {
  try {
    const app = expressFactory();
    if (serverStarted) {
      // It seems that Express has no method to deinitialize or to clear routes.
      // Workaround: let the 'app' variable go out of scope and wait 5 seconds, this
      // seems to deinitialize Express. If Express is just reinitiated with its new
      // configuration without some waiting before usage, Express keeps using the old
      // routes (probably somehow cached).
      await sleep(5000);
    }

    const sriConfig = await sri4nodeConfigFactory(handleMultipleUploadsTogether, uploadInSequence, customStoreAttachment, customCheckDownload);
    sriConfig.description = `config of sri4node-attachments(${id})`;
    const sri4nodeServerInstance = await sri4node.configure(app, sriConfig);
    app.set("port", port);
    const server = app.listen(port, () => {
      info(`Node app is running at localhost:${port}`);
    });
    serverStarted = true;
    return { sri4nodeServerInstance, server };
  } catch (err) {
    error("Unable to start server.");
    error(err);
    error(err.stack);
    process.exit(1);
  }
};

const closeServer = async (server, sri4nodeServerInstance) => {
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
};

const runTests = async (httpClient, checkStoreAttachmentsReceivedList) => {
  require("./testPartyAttachments")(httpClient, "/partiesS3");

  testPartyAttachmentsCheckStoreAttachmentMod.factory(httpClient, "/partiesS3", checkStoreAttachmentsReceivedList);

  // local storage is currenlty not supported anymore
  // require("./testPartyAttachments")(base, "/partiesFolder");
};


describe("Unit tests : ", () => {
  require("./unitTests");
});

// To be able to test the attachments plugin with different configuration parameters we need to start
// different server instances:
//                                    handleMultipleUploadsTogether  uploadInSequence
//   sri4node-attachments(1) :                  false                       n/a
//   sri4node-attachments(2) :                  true                        true
//   sri4node-attachments(3) :                  true                        false

// Configuration with handleMultipleUploadsTogether=false and uploadInSequence=false
describe("sri4node-attachments(1) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    const handleMultipleUploadsTogether = false;
    const uploadInSequence = false;
    const customStoreAttachment = testPartyAttachmentsCheckStoreAttachmentMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence);
    ({ sri4nodeServerInstance, server } = await initServer('1', handleMultipleUploadsTogether, uploadInSequence, customStoreAttachment));
  });

  after(async () => {
    // enable this to keep the server running for inspection
    // await new Promise(() => {});
    await closeServer(server, sri4nodeServerInstance);
  });

  runTests(httpClient);
});

// Configuration with handleMultipleUploadsTogether=false and uploadInSequence=true
describe("sri4node-attachments(2) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;
  const checkStoreAttachmentsReceivedList = [];

  before(async () => {
    const handleMultipleUploadsTogether = false;
    const uploadInSequence = true;
    const customStoreAttachment = testPartyAttachmentsCheckStoreAttachmentMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence, checkStoreAttachmentsReceivedList);
    ({ sri4nodeServerInstance, server } = await initServer('2', handleMultipleUploadsTogether, uploadInSequence, customStoreAttachment));
  });

  after(async () => {
    // enable this to keep the server running for inspection
    // await new Promise(() => {});
    await closeServer(server, sri4nodeServerInstance);
  });

  runTests(httpClient, checkStoreAttachmentsReceivedList);
});


// Configuration with multiple uploads together (upload in sequence does noty matter in this case)
describe("sri4node-attachments(3) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  before(async () => {
    const handleMultipleUploadsTogether = true;
    const uploadInSequence = false; // uploadInSequence value does not matter in case of handleMultipleUploadsTogether=false
                                    // (not relevant and thus not used in that code path)
    const customStoreAttachment = testPartyAttachmentsCheckStoreAttachmentMod.checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence);
    ({ sri4nodeServerInstance, server } = await initServer('3', handleMultipleUploadsTogether, uploadInSequence, customStoreAttachment));
  });

  after(async () => {
    // enable this to keep the server running for inspection
    // await new Promise(() => {});
    await closeServer(server, sri4nodeServerInstance);
  });

  runTests(httpClient);
});


describe("sri4node-attachments custom checkParentDeleted(4) : ", () => {
  /** @type {import("sri4node").TSriServerInstance} */
  let sri4nodeServerInstance;
  let server;

  let receivedTx;
  let receivedFilename;
  let receivedKey;

  before(async () => {
    const handleMultipleUploadsTogether = false;
    const uploadInSequence = false;
    const checkParentDeleted = async (tx, sriRequest, key, filename) => {
      receivedTx = tx;
      receivedKey = key;
      receivedFilename = filename;
      if (sriRequest.query.simulateParentDeleted === 'true') {
        throw new sriRequest.SriError({
          status: 410,
          errors: [
            {
              code: 'file.was.deleted',
              type: 'ERROR',
              message: 'file was deleted',
            },
          ],
        });
      }
    };
    ({ sri4nodeServerInstance, server } = await initServer('4', handleMultipleUploadsTogether, uploadInSequence, undefined, checkParentDeleted ));
  });

  it("should be able to abort the request ", async () => {
    const resourceKey = uuid.v4();
    const filename = 'test.png';
    const response = await httpClient.get({ path: `/partiesS3/${resourceKey}/attachments/${filename}?simulateParentDeleted=true` });
    assert.equal(response.status, 410);
    assert.equal(response.body.errors[0].code, 'file.was.deleted');
    assert.equal(receivedKey, resourceKey);
    assert.equal(receivedFilename, filename);
    assert.equal(typeof receivedTx.oneOrNone, 'function');
  });

  it("should download the file if checkParentDeleted does not throw", async () => {
    const type = '/partiesS3';
    const body = {
      type: "person",
      name: "test user",
      status: "active",
    };
    const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuid.v4());
    const resourceHref = type + "/" + resourceKey;
    const localFilename = "test/images/orange-boy-icon.png";
    const attachmentUrl = `${type}/${resourceKey}/attachments/${attachmentKey}`;
    const attachmentDownloadUrl =
      type + "/" + resourceKey + "/attachments/profile.png";

    const responsePut = await httpClient.put({ path: resourceHref, body });
    assert.equal(responsePut.status, 201);

    const filesToPut = [
      {
        remotefileName: "profile.png",
        localFilename,
        attachmentKey,
        resourceHref,
      },
    ];
    await uploadFilesAndCheck(httpClient, filesToPut);

    const responseGet = await httpClient.get({ path: attachmentDownloadUrl});
    assert.equal(responseGet.status, 200);
    assert.equal(responseGet.headers['content-disposition'], 'inline; filename="profile.png"');

    // Delete and verify the original attachment
    await deleteAttachmentAndVerify(httpClient, attachmentUrl, attachmentDownloadUrl);
  });

  it("should return 404 if file doesn't exists and checkParentDeleted does not throw", async () => {
    const resourceKey = uuid.v4();
    const responseGet = await httpClient.get({ path: `/partiesS3/${resourceKey}/attachments/not_existing_file.png` });
    assert.equal(responseGet.status, 404);
  });

  after(async () => {
    // enable this to keep the server running for inspection
    // await new Promise(() => {});
    await closeServer(server, sri4nodeServerInstance);
  });

});
