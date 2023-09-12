const assert = require("assert");
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const fs = require("fs");

const { doPutFiles, uploadFilesAndCheck, copyFilesAndCheck, doGetStream, checkStreamEqual, deleteAttachmentAndVerify, createUploadBody } = require("./common.js");

exports = module.exports = function (httpClient, type) {
  describe(type, function () {
    describe("PUT (customRouteForUpload)", function () {
      // checks customRouteForUpload, customRouteForDownload and customRouteForDelete
      it("should allow adding of profile picture as attachment", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;

        const responsePut = await httpClient.put({ path: resourceHref, body});
        assert.equal(responsePut.status, 201);

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Overwrite attachment
        const filesToPut2 = [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut2);

        const attachmentUrl =
          type + "/" + resourceKey + "/attachments/" + attachmentKey;
        const attachmentDownloadUrl =
          type + "/" + resourceKey + "/attachments/profile.png";

        // Next : try to delete the attachment.
        const response1 = await httpClient.delete({ path: attachmentUrl });
        assert.equal(response1.status, 204);
        // Now check that is is gone..
        const response2 = await httpClient.get({ path: attachmentDownloadUrl });
        assert.equal(response2.status, 404);
      });

      it("should be idempotent", async function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl =
          type + "/" + resourceKey + "/attachments/profile.png";

        debug("Generated UUID=" + resourceKey);
        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile image as attachment");

        const filesToPut = [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey,
            resourceHref,
          },
        ];

        const responsePutAtt = await doPutFiles(httpClient, type, filesToPut);
        assert.equal(responsePutAtt.status, 200);
        const getStream1 = await doGetStream(httpClient, attachmentUrl);

        // same put
        const responsePutAtt2 = await doPutFiles(httpClient, type, filesToPut);
        assert.equal(responsePutAtt2.status, 200);
        const getStream2 = await doGetStream(httpClient, attachmentUrl);

        // compare both streams
        checkStreamEqual(getStream1, getStream2);
      });

      it("replace by attachment key should work", async function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;

        const responsePut = await httpClient.put({ path: resourceHref, body });
        assert.equal(responsePut.status, 201);

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        debug("Adding another profile picture");
        const filesToPut2 = [
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/avatar-black.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];

        await uploadFilesAndCheck(httpClient, filesToPut2);

        debug("Replacing one of two attachments");
        const filesToPut3 = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/avatar-blue.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut3);

        // Check if (only) the two expected attachments are there
        const responseGet2 = await httpClient.get({ path: type + "/" + resourceKey });
        assert.equal(responseGet2.status, 200);
        console.log(responseGet2.body.attachments.length, 2);

        const getStream1 = await doGetStream(
          httpClient,
          `/partiesS3/${resourceKey}/attachments/profile1.png`
        );

        checkStreamEqual(
          getStream1,
          fs.createReadStream("test/images/avatar-blue.png")
        );

        const getStream2 = await doGetStream(
          httpClient,
          `/partiesS3/${resourceKey}/attachments/profile2.png`
        );

        checkStreamEqual(
          getStream2,
          fs.createReadStream("test/images/avatar-black.png")
        );

        const responseGet3 = await httpClient.get({
          path: `/partiesS3/${resourceKey}/attachments/profile.png`
        });
        assert.equal(responseGet3.status, 200);
      });

      it("replace by attachment name should fail", async function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3 ] = Array.from({ length: 4 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;

        const responsePut = await httpClient.put({ path: resourceHref, body });
        assert.equal(responsePut.status, 201);

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        debug("Adding another profile picture");
        const filesToPut2 = [
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/avatar-black.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];

        await uploadFilesAndCheck(httpClient, filesToPut2);

        debug("Replacing one of two attachments");
        const filesToPut3 = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/avatar-blue.png",
            attachmentKey: attachmentKey3,
            resourceHref,
          },
        ];

        // We expect an error because we are reputting an existing filename with another key.
        // Alas, because currently sri4node streaming input requests generate streaming output
        // the only way to signal an error to client is to reset the connection and write an
        // errormessage in the partial body.
        //  (checking for a scenario like this earlier in the flow, in the beforeStreaming handler
        //   which can set the status code returned in the header, is not possible as busboy
        //   is not yet initialised and thus the body of the request is not yet read)

        let catchedErr;
        try {
          const basePath = resourceHref.substring(0, resourceHref.lastIndexOf("/"));
          await doPutFiles(httpClient, basePath, filesToPut3);
        } catch (err) {
          catchedErr = err;
        }
        assert.equal(catchedErr !== null, true, 'expected a http error')
        assert.equal((catchedErr).err.code, 'UND_ERR_SOCKET', 'expected a connection reset error')

        const partialBody = catchedErr.partialBody.toString();
        assert.equal(partialBody.includes('"status": 409'), true, 'expected status code 409 conflict in partial body');
        assert.equal(partialBody.includes('"code": "file.already.exists"'), true, 'expected error code file.already.exists in partial body');
      });

      it("invalid combination of copy and upload properties should give an error", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;

        const responsePut = await httpClient.put({ path: resourceHref, body });
        assert.equal(responsePut.status, 201);

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        const attachmentDownloadUrl =
          type + "/" + resourceKey + "/attachments/profile.png";

        const filesToPutInvalid = [
          {
            remotefileName: "profile2.png",
            urlToCopy: attachmentDownloadUrl,
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          }
        ];

        await uploadFilesAndCheck(httpClient, filesToPut);
        const href = filesToPut[0].resourceHref;
        const basePath = href.substring(0, href.lastIndexOf("/"));
        try {
          await doPutFiles(httpClient, basePath, filesToPutInvalid);
          assert.fail('An error is expected !');
        } catch (err) {
          assert.equal(err.code, 'streaming.body.read.failed');
          const partialBodyStr = err.partialBody.toString();
          assert.equal(partialBodyStr.includes('"status": 400'), true, 'expected status code 400 missing in partial body');
          assert.equal(partialBodyStr.includes('"code": "upload.and.copy.mix"'), true, 'expected error code missing in partial body');
        }
      });

    });


    describe("PUT MULTIPLE (customRouteForUpload)", function () {
      it("should allow adding of 2 files as attachment in a single POST multipart/form-data operation" +
                  "+ combination of existing attachments with a new one + delete of attachment", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3 ] = Array.from({ length: 4 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/" + attachmentKey1;
        const attachmentDownloadUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentDownloadUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";
        const attachmentDownloadUrl3 =
          type + "/" + resourceKey + "/attachments/profile3.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];

        await uploadFilesAndCheck(httpClient, filesToPut);

        // Multiple upload with one extra attachment
        const filesToPut2 = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
          {
            remotefileName: "profile3.png",
            localFilename: "test/images/avatar-black.png",
            attachmentKey: attachmentKey3,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut2);

        // Next : try to delete one resource.
        const response1 = await httpClient.delete({ path: attachmentUrl1 });
        assert.equal(response1.status, 204);
        // Now check that one attachment is gone and the others are still available
        const response2 = await httpClient.get({ path: attachmentDownloadUrl1 });
        assert.equal(response2.status, 404);
        const response3 = await httpClient.get({ path: attachmentDownloadUrl2 });
        assert.equal(response3.status, 200);
        const response4 = await httpClient.get({ path: attachmentDownloadUrl3 });
        assert.equal(response4.status, 200);
      });

      it("should also allow copying of existing files as (together with uploading some files) single POST multipart/form-data operation", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3 ] = Array.from({ length: 4 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentDownloadUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting 1 profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
        ];

        await uploadFilesAndCheck(httpClient, filesToPut);

        // Multiple upload with one extra attachment which is a copy of an existing attachment
        const filesToPut2 = [
          {
            remotefileName: "profile2.png",
            urlToCopy: attachmentDownloadUrl1,
            attachmentKey: attachmentKey2,
            resourceHref,
          },
          {
            remotefileName: "profile3.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey3,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut2);
      });

    });

    describe("customRouteForGet", function () {
      it("/resource/:key/attachments/:attachmentKey should work", async () => {
        // this function implicitly tests functions passed to
        // customRouteForUpload, customRouteForUploadCopy, customRouteForDelete and customRouteForGet

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

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "profile.png",
            localFilename,
            attachmentKey,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        const responseGetAtt1 = await httpClient.get({ path:
          `${type}/${resourceKey}/attachments/${attachmentKey}`
        });
        assert.equal(responseGetAtt1.status, 200);
        assert.equal(
          responseGetAtt1.body.description,
          `this is MY file with key ${attachmentKey}`
        );

        // Copy resource and attachment
        const [resourceCopyKey, attachmentCopyKey ] = Array.from({ length: 2 }, () => uuid.v4());
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        const FileToCopy =
        [{
          remotefileName: "profile1.png",
          urlToCopy: attachmentDownloadUrl,
          attachmentKey: attachmentCopyKey,
          resourceHref: resourceCopyHref,
        }];
        await copyFilesAndCheck(httpClient, FileToCopy);

        const attachmentCopyUrl = `${type}/${resourceCopyKey}/attachments/${attachmentCopyKey}`;
        const attachmentCopyDownloadUrl = `${type}/${resourceCopyKey}/attachments/profile1.png`;

        const responseGetAtt2 = await httpClient.get({ path: attachmentCopyUrl });
        assert.equal(responseGetAtt2.status, 200);

        // Delete and verify the copied attachment
        await deleteAttachmentAndVerify(
          httpClient,
          attachmentCopyUrl,
          attachmentCopyDownloadUrl
        );

        // Verify if original attachment is still there
        const responseGetAtt3 = await httpClient.get({ path: attachmentUrl });
        assert.equal(responseGetAtt3.status, 200);
        assert.equal(
          responseGetAtt3.body.description,
          `this is MY file with key ${attachmentKey}`
        );

        // Delete and verify the original attachment
        await deleteAttachmentAndVerify(httpClient, attachmentUrl, attachmentDownloadUrl);
      });
    });

    describe("customRouteForUploadCopy", function () {
      it("copy attachments should work", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Copy the resource
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuid.v4());

        const copyAttBody = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
          { remotefileName: "profile2.png",
            attachmentKey: attachmentCopyKey2,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl2,
          },
        ]);
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult.status, 200);

        // verify if the copied attachments are present
        const attachmentCopyUrl1 =
          type + "/" + resourceCopyKey + "/attachments/profile1.png";
        const attachmentCopyUrl2 =
          type + "/" + resourceCopyKey + "/attachments/profile2.png";

        const responseGetCopyAtt1 = await httpClient.get({ path: attachmentCopyUrl1 });
        assert.equal(responseGetCopyAtt1.status, 200);

        const responseGetCopyAtt2 = await httpClient.get({ path: attachmentCopyUrl2 });
        assert.equal(responseGetCopyAtt2.status, 200);
      });

      it("copy attachments should work without 'file' property", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };

        const [resourceKey, attachmentKey1, attachmentKey2] = Array.from({ length: 4 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Copy the resource
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuid.v4());

        const copyAttBody = createUploadBody([
          { attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
          { attachmentKey: attachmentCopyKey2,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl2,
          },
        ]);

        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult.status, 200);

        // verify if the copied attachments are present
        const attachmentCopyUrl1 =
          type + "/" + resourceCopyKey + "/attachments/profile1.png";
        const attachmentCopyUrl2 =
          type + "/" + resourceCopyKey + "/attachments/profile2.png";

        const responseGetCopyAtt1 = await httpClient.get({ path: attachmentCopyUrl1 });
        assert.equal(responseGetCopyAtt1.status, 200);

        const responseGetCopyAtt2 = await httpClient.get({ path: attachmentCopyUrl2 });
        assert.equal(responseGetCopyAtt2.status, 200);
      });

      it("copy attachments without fileHref should result in proper error", async () => {
        const [ resourceCopyKey, attachmentCopyKey1] = Array.from({ length: 2 }, () => uuid.v4());
        const resourceCopyHref = type + "/" + resourceCopyKey;

        const copyAttBody = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            // urlToCopy NOT DEFINED -> no fileHref
          },
        ]);
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        console.log(copyAttResult.status);
        console.log(copyAttResult.body);

        assert.equal(copyAttResult.status, 400);
        assert.equal(
          copyAttResult.body.errors[0].code,
          "missing.json.fileHref"
        );
      });

      it("missing body should result in proper error", async () => {
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: undefined,
        });

        console.log(copyAttResult.status);
        console.log(copyAttResult.body);

        assert.equal(copyAttResult.status, 400);
        assert.equal(
          copyAttResult.body.errors[0].code,
          "missing.json.body.attachment"
        );
      });

      it("should be idempotent", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Copy the resource
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuid.v4());

        const copyAttBody = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
          { remotefileName: "profile2.png",
            attachmentKey: attachmentCopyKey2,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl2,
          },
        ]);
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult.status, 200);

        // Copy the attachments again
        const copyAttResult2 = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult2.status, 200);
      });


      it("replace by attachment key", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Copy the resource
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuid.v4());

        const copyAttBody = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
          { remotefileName: "profile2.png",
            attachmentKey: attachmentCopyKey2,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl2,
          },
        ]);
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult.status, 200);

        // same key, different name
        const copyAttBody2 = createUploadBody([
          { remotefileName: "profile3.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
        ]);

        const copyAttResult2 = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody2,
        });
        assert.equal(copyAttResult2.status, 200);

        // Check if (only) the two expected attachments are there
        const responseGet2 = await httpClient.get({ path: resourceCopyHref });
        assert.equal(responseGet2.status, 200);
        assert.equal(responseGet2.body.attachments.length, 2);

        // Verify if the attachment name is updated
        const newAttachmentJson = responseGet2.body.attachments.find(a => a.key === attachmentCopyKey1);
        assert.notEqual(newAttachmentJson, undefined);
        assert.equal(newAttachmentJson.name.filename, 'profile3.png');
      });

      it("replace by name should fail", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuid.v4());
        const resourceHref = type + "/" + resourceKey;
        const attachmentUrl1 =
          type + "/" + resourceKey + "/attachments/profile1.png";
        const attachmentUrl2 =
          type + "/" + resourceKey + "/attachments/profile2.png";

        const response = await httpClient.put({ path: resourceHref, body });
        assert.equal(response.status, 201);

        debug("PUTting the profile images as attachments");
        const filesToPut = [
          {
            remotefileName: "profile1.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: attachmentKey1,
            resourceHref,
          },
          {
            remotefileName: "profile2.png",
            localFilename: "test/images/little-boy-white.png",
            attachmentKey: attachmentKey2,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);

        // Copy the resource
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuid.v4());

        const copyAttBody = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey1,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
          { remotefileName: "profile2.png",
            attachmentKey: attachmentCopyKey2,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl2,
          },
        ]);
        const copyAttResult = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody,
        });
        assert.equal(copyAttResult.status, 200);

        // same name, different attachment key
        const attachmentCopyKey3 = uuid.v4();
        const copyAttBody2 = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey3,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
        ]);

        const copyAttResult2 = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody2,
        });
        assert.equal(copyAttResult2.status, 409);
        assert.equal(copyAttResult2.body.errors[0].code, "file.already.exists");
      });

    });
  });
};


// TODO: test rollback (delete of temp files) in case of error
// TODO: check if mimetype is set as expected

// No testcase for customRouteForPreSignedUpload provided yet as it is not used
// TODO : test security??

// TODO : Define resource with S3 and file storage to test both
// TODO : When BLOB database storage is implemented, also add a resource on that with tests
// TODO : Implement + check after & before function (with database access) on GET, PUT and DELETE.
// TODO : add test for filename with special characters (check originalFilename and filename).
// TODO : add testcase uploading multiple attachments with a failure during the last one -> everything should be rolled (tmp files removed)
