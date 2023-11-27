/* Configuration for sri4node, used for our server.js, but also for mocha tests */
const sri4node = require("sri4node");
const { sri4nodeAttachmentUtilsFactory } = require("../../js/sri4node-attachments.js");
const partiesFactory = require("./parties");

/**
 *
 * @returns { Promise<import('sri4node').TSriConfig> }
 */
module.exports = async function (handleMultipleUploadsTogether = false, uploadInSequence = true, customStoreAttachment = undefined, customCheckDownload = undefined) {
  const attachmentUtilsForS3 = await sri4nodeAttachmentUtilsFactory(
    {
      endpoint: "http://localhost:4566/",
      s3key: "",
      s3secret: "",
      s3bucket: "tests3bucket",
      accessKeyId: "",
      s3region: "eu-west-1",
      handleMultipleUploadsTogether,
      uploadInSequence,
    },
    sri4node
  );

  return {
    databaseConnectionParameters: {
      host: "localhost",
      port: 15435,
      database: "postgres",
      user: "postgres",
      password: "postgres",
    },
    description: "",
    logdebug: {
      channels: [
        "sri4node-attachments",
        "trace",
        "general",
        "batch",
        "db",
        "sql",
      ],
    },
    resources: [
      partiesFactory(sri4node, attachmentUtilsForS3, "/partiesS3", customStoreAttachment, customCheckDownload),
      // Is storing files locally still supported?
      // partiesFactory(sri4node, attachmentUtilsForLocalFolder, '/partiesFolder'),
    ],
  };
};
