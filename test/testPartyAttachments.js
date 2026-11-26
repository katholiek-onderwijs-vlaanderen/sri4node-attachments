/*global Buffer, process*/
const assert = require("assert");
const { randomUUID: uuidv4 } = require("crypto");
const { debug } = require("../js/common.js");
const fs = require("fs");

const { doPutFiles, uploadFilesAndCheck, copyFilesAndCheck, doGetStream, checkStreamEqual, deleteAttachmentAndVerify, createUploadBody, expectRequestError, listTmpObjects, interceptS3, commandKey, listObjectsWithPrefix, sendPartialMultipartAndAbort, captureServerErrorLogs, assertErrorInServerLogs, getStreamAsBuffer } = require("./common.js");
const http = require("http");
const { Readable } = require("stream");
const { beforeEach } = require("mocha");

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
        const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuidv4());
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
        const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuidv4());
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
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3] =
          Array.from({ length: 4 }, () => uuidv4());
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
        const basePath = resourceHref.substring(
          0,
          resourceHref.lastIndexOf("/")
        );
        const tmpBefore = new Set(await listTmpObjects());
        await expectRequestError(
          () => doPutFiles(httpClient, basePath, filesToPut3),
          409,
          "file.already.exists"
        );
        const leftovers = (await listTmpObjects()).filter((k) => !tmpBefore.has(k));
        assert.deepEqual(leftovers, [], `tmp files not cleaned up: ${leftovers.join(", ")}`);
      });

      it("invalid combination of copy and upload properties should give an error", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const tmpBefore = new Set(await listTmpObjects());
        await expectRequestError(
          () => doPutFiles(httpClient, basePath, filesToPutInvalid),
          400,
          "upload.and.copy.mix"
        );
        const leftovers = (await listTmpObjects()).filter((k) => !tmpBefore.has(k));
        assert.deepEqual(leftovers, [], `tmp files not cleaned up: ${leftovers.join(", ")}`);
      });

      it("should allow adding an attachment with special characters (eg ¨) in the filename", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey] = Array.from({ length: 2 }, () => uuidv4());
        const resourceHref = type + "/" + resourceKey;

        const responsePut = await httpClient.put({ path: resourceHref, body });
        assert.equal(responsePut.status, 201);

        // Add attachment
        debug("PUTting the profile image as attachment");
        const filesToPut = [
          {
            remotefileName: "pröfile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey,
            resourceHref,
          },
        ];
        await uploadFilesAndCheck(httpClient, filesToPut);
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
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3 ] = Array.from({ length: 4 }, () => uuidv4());
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
        const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3 ] = Array.from({ length: 4 }, () => uuidv4());
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
        const [resourceKey, attachmentKey ] = Array.from({ length: 2 }, () => uuidv4());
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
        const [resourceCopyKey, attachmentCopyKey ] = Array.from({ length: 2 }, () => uuidv4());
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

    describe("download contract (backward compatibility)", function () {
      it("returns 404 for a non-existing attachment", async () => {
        const resourceKey = uuidv4();
        await httpClient.put({
          path: `${type}/${resourceKey}`,
          body: { type: "person", name: "test user", status: "active" },
        });
        const res = await httpClient.get({
          path: `${type}/${resourceKey}/attachments/does-not-exist.png`,
        });
        assert.equal(res.status, 404);
      });

      it("returns 200 with correct content-type and content-disposition", async () => {
        const resourceKey = uuidv4();
        const resourceHref = `${type}/${resourceKey}`;
        await httpClient.put({
          path: resourceHref,
          body: { type: "person", name: "test user", status: "active" },
        });
        await uploadFilesAndCheck(httpClient, [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: uuidv4(),
            resourceHref,
          },
        ]);
        const res = await httpClient.get({
          path: `${resourceHref}/attachments/profile.png`,
          streaming: true,
        });
        assert.equal(res.status, 200);
        assert.match(String(res.headers["content-type"]), /image\/png/);
        assert.match(String(res.headers["content-disposition"] ?? ""), /profile\.png/);
      });

      it("downloads an attachment without extension", async () => {
        const resourceKey = uuidv4();
        const resourceHref = `${type}/${resourceKey}`;
        await httpClient.put({
          path: resourceHref,
          body: { type: "person", name: "test user", status: "active" },
        });
        await uploadFilesAndCheck(httpClient, [
          {
            remotefileName: "README",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey: uuidv4(),
            resourceHref,
          },
        ]);
        const res = await httpClient.get({
          path: `${resourceHref}/attachments/README`,
          streaming: true,
        });
        assert.equal(res.status, 200);
        assert.match(String(res.headers["content-disposition"] ?? ""), /README/);
      });

      it("still routes a uuid to customRouteForGet (json, not a file)", async () => {
        const resourceKey = uuidv4();
        const attachmentKey = uuidv4();
        const resourceHref = `${type}/${resourceKey}`;
        await httpClient.put({
          path: resourceHref,
          body: { type: "person", name: "test user", status: "active" },
        });
        await uploadFilesAndCheck(httpClient, [
          {
            remotefileName: "profile.png",
            localFilename: "test/images/orange-boy-icon.png",
            attachmentKey,
            resourceHref,
          },
        ]);
        const res = await httpClient.get({
          path: `${resourceHref}/attachments/${attachmentKey}`,
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.key, attachmentKey);
      });

      it("routes an uppercase uuid path to customRouteForGet (express routing is case-insensitive)", async () => {
        const resourceHref = `${type}/${uuidv4()}`;
        await httpClient.put({
          path: resourceHref,
          body: { type: "person", name: "test user", status: "active" },
        });
        const attachmentKey = uuidv4();
        await uploadFilesAndCheck(httpClient, [
          { remotefileName: "profile.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey, resourceHref },
        ]);
        const res = await httpClient.get({
          path: `${resourceHref}/attachments/${attachmentKey.toUpperCase()}`,
        });
        // must be handled by customRouteForGet: JSON metadata of the attachment, not the file
        assert.equal(res.status, 200);
        assert.match(String(res.headers["content-type"]), /application\/json/);
        assert.equal(res.body.key, attachmentKey);
        assert.equal(res.body.description, `this is MY file with key ${attachmentKey}`);
      });

      it("an attachment uploaded with an uppercase key is reachable via its returned href", async () => {
        const resourceHref = `${type}/${uuidv4()}`;
        await httpClient.put({
          path: resourceHref,
          body: { type: "person", name: "test user", status: "active" },
        });
        const attachmentKey = uuidv4().toUpperCase();
        const putRes = await doPutFiles(httpClient, type, [
          { remotefileName: "profile.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey, resourceHref },
        ]);
        assert.equal(putRes.status, 200);
        // streaming route: body may come back as a string or buffer, and may be nested ([[{...}]])
        const putBody =
          typeof putRes.body === "string" || Buffer.isBuffer(putRes.body)
            ? JSON.parse(putRes.body.toString())
            : putRes.body;
        const href = [putBody].flat(Infinity)[0]?.href;
        assert.ok(href, `no href in upload response: ${JSON.stringify(putBody)}`);
        assert.ok(href.endsWith(attachmentKey), `unexpected href ${href}`);

        const res = await httpClient.get({ path: href });
        assert.equal(res.status, 200);
        assert.equal(res.body.key, attachmentKey);

        // delete via the returned href must remove metadata and file
        const delRes = await httpClient.delete({ path: href });
        assert.equal(delRes.status, 204);
        assert.equal((await httpClient.get({ path: href })).status, 404);
        assert.equal(
          (await httpClient.get({ path: `${resourceHref}/attachments/profile.png` })).status,
          404
        );
      });

    });

    describe("customRouteForUploadCopy", function () {
      it("copy attachments should work", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const resourceCopyKey = uuidv4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuidv4());

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

        const [resourceKey, attachmentKey1, attachmentKey2] = Array.from({ length: 4 }, () => uuidv4());
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
        const resourceCopyKey = uuidv4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuidv4());

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
        const [ resourceCopyKey, attachmentCopyKey1] = Array.from({ length: 2 }, () => uuidv4());
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
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const resourceCopyKey = uuidv4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuidv4());

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
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const resourceCopyKey = uuidv4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuidv4());

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
        const [resourceKey, attachmentKey1, attachmentKey2 ] = Array.from({ length: 3 }, () => uuidv4());
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
        const resourceCopyKey = uuidv4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        // Copy the attachments
        const [attachmentCopyKey1, attachmentCopyKey2 ] = Array.from({ length: 2 }, () => uuidv4());

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
        const attachmentCopyKey3 = uuidv4();
        const copyAttBody2 = createUploadBody([
          { remotefileName: "profile1.png",
            attachmentKey: attachmentCopyKey3,
            resourceHref: resourceCopyHref,
            urlToCopy: attachmentUrl1,
          },
        ]);

        const tmpBefore = new Set(await listTmpObjects());
        const copyAttResult2 = await httpClient.post({
          path: `${type}/attachments/copy`,
          body: copyAttBody2,
        });
        assert.equal(copyAttResult2.status, 409);
        assert.equal(copyAttResult2.body.errors[0].code, "file.already.exists");
        const leftovers = (await listTmpObjects()).filter((k) => !tmpBefore.has(k));
        assert.deepEqual(leftovers, [], `tmp files not cleaned up: ${leftovers.join(", ")}`);
      });

    });

    describe("file-less attachment", function () {
      let putAttachmentsResponse;
      let partyPutResponse;
      let attachment;
      let resourceHref;

      beforeEach(async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const [resourceKey, attachmentKey1] = Array.from({ length: 4 }, () =>
          uuidv4()
        );
        resourceHref = type + "/" + resourceKey;

        partyPutResponse = await httpClient.put({ path: resourceHref, body });

        debug("PUTting a text as attachment");
        attachment = {
          description:
            "In publishing and graphic design, Lorem ipsum is a placeholder text commonly used to demonstrate the visual form of a document or a typeface without relying on meaningful content.",
          title: "Lorem Ipsum",
          myProperty: "myValue",
        };

        const filesToPut = [
          {
            attachmentKey: attachmentKey1,
            attachment: attachment,
            resourceHref,
          },
        ];

        putAttachmentsResponse = await doPutFiles(httpClient, type, filesToPut);
      });

      it("should allow text-based attachments (without files) to be PUT and simply pass them through", async () => {
        
        assert.equal(partyPutResponse.status, 201);
        assert.equal(putAttachmentsResponse.status, 200);

        const responseGet = await httpClient.get({ path: resourceHref });
        assert.equal(responseGet.status, 200);
        assert.equal(responseGet.body.attachments.length, 1);

        // check if all the properties are there with the correct values
        Object.entries(attachment).forEach(([key, value]) => {
          assert.equal(responseGet.body.attachments[0][key], value, `Mismatch in property ${key}`);
        });
      });

      it("should allow text-based attachments (without files) to be DELETEd", async () => {
        
        assert.equal(partyPutResponse.status, 201);
        assert.equal(putAttachmentsResponse.status, 200);

        const responseGet = await httpClient.get({ path: resourceHref });

        const response1 = await httpClient.delete({ path: responseGet.body.attachments[0].href });
        assert.equal(response1.status, 204);

        const responseGet2 = await httpClient.get({ path: resourceHref });
        assert.equal(responseGet2.status, 200);
        assert.equal(responseGet2.body.attachments.length, 0);
      });
    });
  });

  describe("rollback of tmp files", function () {
    this.timeout(15000);
    /** @type {undefined | (() => void)} */
    let restoreS3;
    afterEach(() => {
      restoreS3?.();
      restoreS3 = undefined;
    });

    async function createParty() {
      const resourceHref = `${type}/${uuidv4()}`;
      const res = await httpClient.put({
        path: resourceHref,
        body: { type: "person", name: "test user", status: "active" },
      });
      assert.equal(res.status, 201);
      return resourceHref;
    }

    async function assertNoNewTmpFiles(tmpBefore) {
      const leftovers = (await listTmpObjects()).filter((k) => !tmpBefore.has(k));
      assert.deepEqual(leftovers, [], `tmp files not cleaned up: ${leftovers.join(", ")}`);
    }

    // scenario 1: one tmp upload fails, the others succeed
    it("a failing tmp upload removes the tmp files of the successful uploads", async () => {
      const resourceHref = await createParty();
      const tmpBefore = new Set(await listTmpObjects());

      let failed = false;
      restoreS3 = interceptS3((command) => {
        const key = commandKey(command);
        const isTmpWrite =
          key?.endsWith(".tmp") &&
          /PutObject|CreateMultipartUpload/.test(command.constructor.name);
        // let the first tmp upload succeed, fail the second one
        if (isTmpWrite && key.includes("b.png") && !failed) {
          failed = true;
          throw new Error("injected tmp upload failure");
        }
      });

      await assert.rejects(async () => {
        const res = await doPutFiles(httpClient, type, [
          { remotefileName: "a.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref },
          { remotefileName: "b.png", localFilename: "test/images/avatar-black.png", attachmentKey: uuidv4(), resourceHref },
        ]);
        if (res.status >= 400) throw new Error(`status ${res.status}`);
      });
      assert.ok(failed, "injected failure was never triggered");

      restoreS3();
      restoreS3 = undefined;
      await assertNoNewTmpFiles(tmpBefore);
    });

    // scenario 2: fail-fast while another upload is still in flight
    it("cleans up tmp uploads that finish after another upload already failed", async () => {
      const resourceHref = await createParty();
      const tmpBefore = new Set(await listTmpObjects());

      let failed = false;
      restoreS3 = interceptS3(async (command) => {
        const key = commandKey(command) ?? "";
        if (!key.endsWith(".tmp")) return;
        if (key.includes("slow.png")) {
          // still running when the other upload fails
          await new Promise((r) => setTimeout(r, 1000));
        } else if (key.includes("fast.png") && !failed) {
          failed = true;
          throw new Error("injected fast failure");
        }
      });

      await assert.rejects(async () => {
        const res = await doPutFiles(httpClient, type, [
          { remotefileName: "slow.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref },
          { remotefileName: "fast.png", localFilename: "test/images/avatar-black.png", attachmentKey: uuidv4(), resourceHref },
        ]);
        if (res.status >= 400) throw new Error(`status ${res.status}`);
      });
      assert.ok(failed, "injected failure was never triggered");

      restoreS3();
      restoreS3 = undefined;
      // the slow upload has finished by now; with Promise.all it would be left behind
      await new Promise((r) => setTimeout(r, 1500));
      await assertNoNewTmpFiles(tmpBefore);
    });

    // rename failure after all uploads succeeded
    it("a failing rename removes the remaining tmp files", async () => {
      const resourceHref = await createParty();
      const tmpBefore = new Set(await listTmpObjects());

      let failed = false;
      restoreS3 = interceptS3((command) => {
        const isRename =
          command.constructor.name === "CopyObjectCommand" &&
          String(command.input?.CopySource ?? "").endsWith(".tmp") &&
          !String(commandKey(command)).endsWith(".tmp");
        if (isRename && !failed) {
          failed = true;
          throw new Error("injected rename failure");
        }
      });

      await assert.rejects(async () => {
        const res = await doPutFiles(httpClient, type, [
          { remotefileName: "r1.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref },
          { remotefileName: "r2.png", localFilename: "test/images/avatar-black.png", attachmentKey: uuidv4(), resourceHref },
        ]);
        if (res.status >= 400) throw new Error(`status ${res.status}`);
      });
      assert.ok(failed, "injected failure was never triggered");

      restoreS3();
      restoreS3 = undefined;
      await assertNoNewTmpFiles(tmpBefore);
    });

    /**
     * Returns an S3 interceptor that fails the rename (tmp -> real name) of the file whose real
     * S3 name ends with the given suffix, after a delay so the other renames finish first.
     * @param {string} targetSuffix
     * @param {{ failed: boolean }} state
     */
    function failRenameOf(targetSuffix, state) {
      return async (command) => {
        const isRename =
          command.constructor.name === "CopyObjectCommand" &&
          String(command.input?.CopySource ?? "").endsWith(".tmp") &&
          !String(commandKey(command)).endsWith(".tmp");
        if (isRename && String(commandKey(command)).endsWith(targetSuffix) && !state.failed) {
          await new Promise((r) => setTimeout(r, 300));
          state.failed = true;
          throw new Error("injected rename failure");
        }
      };
    }

    it("a failing rename does not leave already renamed files behind", async () => {
      const resourceHref = await createParty();
      const resourceKey = resourceHref.split("/").pop();
      const tmpBefore = new Set(await listTmpObjects());

      const state = { failed: false };
      restoreS3 = interceptS3(failRenameOf("-n2.png", state));

      await assert.rejects(async () => {
        const res = await doPutFiles(httpClient, type, [
          { remotefileName: "n1.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref },
          { remotefileName: "n2.png", localFilename: "test/images/avatar-black.png", attachmentKey: uuidv4(), resourceHref },
        ]);
        if (res.status >= 400) throw new Error(`status ${res.status}`);
      });
      assert.ok(state.failed, "injected failure was never triggered");

      restoreS3();
      restoreS3 = undefined;
      assert.deepEqual(await listObjectsWithPrefix(resourceKey), [], "renamed files left behind");
      await assertNoNewTmpFiles(tmpBefore);
    });

    it("a failing rename restores an overwritten attachment", async () => {
      const resourceHref = await createParty();
      const resourceKey = resourceHref.split("/").pop();
      const existingKey = uuidv4();
      await uploadFilesAndCheck(httpClient, [
        { remotefileName: "keep.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: existingKey, resourceHref },
      ]);
      const tmpBefore = new Set(await listTmpObjects());

      const state = { failed: false };
      restoreS3 = interceptS3(failRenameOf("-other.png", state));

      await assert.rejects(async () => {
        const res = await doPutFiles(httpClient, type, [
          // overwrite of the existing attachment (same key) with other content
          { remotefileName: "keep.png", localFilename: "test/images/avatar-black.png", attachmentKey: existingKey, resourceHref },
          { remotefileName: "other.png", localFilename: "test/images/avatar-blue.png", attachmentKey: uuidv4(), resourceHref },
        ]);
        if (res.status >= 400) throw new Error(`status ${res.status}`);
      });
      assert.ok(state.failed, "injected failure was never triggered");

      restoreS3();
      restoreS3 = undefined;
      const downloaded = await doGetStream(httpClient, `${resourceHref}/attachments/keep.png`);
      await checkStreamEqual(downloaded, fs.createReadStream("test/images/orange-boy-icon.png"));
      assert.deepEqual(await listObjectsWithPrefix(resourceKey), [`${resourceKey}-keep.png`]);
      await assertNoNewTmpFiles(tmpBefore);
    });

    it("a failing copy removes the tmp copies that succeeded", async () => {
      const sourceHref = await createParty();
      await uploadFilesAndCheck(httpClient, [
        { remotefileName: "src1.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref: sourceHref },
        { remotefileName: "src2.png", localFilename: "test/images/avatar-black.png", attachmentKey: uuidv4(), resourceHref: sourceHref },
      ]);
      const targetHref = await createParty();
      const tmpBefore = new Set(await listTmpObjects());

      let failed = false;
      restoreS3 = interceptS3(async (command) => {
        const key = String(commandKey(command));
        if (command.constructor.name === "CopyObjectCommand" && key.endsWith("-src2.png.tmp") && !failed) {
          // let the copy of src1 finish first
          await new Promise((r) => setTimeout(r, 300));
          failed = true;
          throw new Error("injected copy failure");
        }
      });

      const res = await httpClient.post({
        path: `${type}/attachments/copy`,
        body: createUploadBody([
          { attachmentKey: uuidv4(), resourceHref: targetHref, urlToCopy: `${sourceHref}/attachments/src1.png` },
          { attachmentKey: uuidv4(), resourceHref: targetHref, urlToCopy: `${sourceHref}/attachments/src2.png` },
        ]),
      });
      assert.ok(failed, "injected failure was never triggered");
      assert.equal(res.status, 500);

      restoreS3();
      restoreS3 = undefined;
      await assertNoNewTmpFiles(tmpBefore);
      assert.deepEqual(await listObjectsWithPrefix(targetHref.split("/").pop()), []);
    });

    it("upload + copy in one request where the last one fails leaves no tmp files", async () => {
      const body = { type: "person", name: "test user", status: "active" };
      const [resourceKey, key1, key2, key3, key4] = Array.from({ length: 5 }, () => uuidv4());
      const resourceHref = `${type}/${resourceKey}`;
      assert.equal((await httpClient.put({ path: resourceHref, body })).status, 201);

      await uploadFilesAndCheck(httpClient, [
        { remotefileName: "existing.png", localFilename: "test/images/orange-boy-icon.png", attachmentKey: key1, resourceHref },
      ]);

      const tmpBefore = new Set(await listTmpObjects());
      await expectRequestError(
        () =>
          doPutFiles(httpClient, type, [
            // copy -> creates a tmp file
            { remotefileName: "copy.png", urlToCopy: `${resourceHref}/attachments/existing.png`, attachmentKey: key2, resourceHref },
            // upload -> creates a tmp file
            { remotefileName: "new.png", localFilename: "test/images/avatar-black.png", attachmentKey: key3, resourceHref },
            // same name as existing, different key -> fails
            { remotefileName: "existing.png", localFilename: "test/images/avatar-blue.png", attachmentKey: key4, resourceHref },
          ]),
        409,
        "file.already.exists"
      );
      const leftovers = (await listTmpObjects()).filter((k) => !tmpBefore.has(k));
      assert.deepEqual(leftovers, [], `tmp files not cleaned up: ${leftovers.join(", ")}`);

      // nothing of the failed request may be visible
      assert.equal((await httpClient.get({ path: `${resourceHref}/attachments/copy.png` })).status, 404);
      assert.equal((await httpClient.get({ path: `${resourceHref}/attachments/new.png` })).status, 404);
    });

    it("a stream error after a failed tmp upload does not crash the process", async () => {
      const resourceHref = await createParty();
      const tmpBefore = new Set(await listTmpObjects());
      /** @type {Error[]} */
      const uncaught = [];
      const onUncaught = (err) => uncaught.push(err);
      process.on("uncaughtException", onUncaught);

      let failed = false;
      restoreS3 = interceptS3((command) => {
        if (String(commandKey(command)).endsWith(".tmp")) {
          failed = true;
          throw new Error("injected tmp upload failure");
        }
      });

      try {
        await sendPartialMultipartAndAbort({
          baseUrl: "http://localhost:5000", // must match the port of the test server / httpClient
          uploadPath: `/${type.replace(/^\//, "")}/attachments`,
          resourceHref: `/${resourceHref.replace(/^\//, "")}`,
        });
        await new Promise((r) => setTimeout(r, 1000));
        assert.ok(failed, "injected failure was never triggered");
        assert.deepEqual(uncaught.map((e) => e.message), [], "uncaught stream error");
        restoreS3();
        restoreS3 = undefined;
        await assertNoNewTmpFiles(tmpBefore);
      } finally {
        process.off("uncaughtException", onUncaught);
      }
    });

  });

  describe("download errors", function () {
    this.timeout(15000);
    /** @type {undefined | (() => void)} */
    let restoreS3;
    afterEach(() => {
      restoreS3?.();
      restoreS3 = undefined;
    });

    async function createPartyWithAttachment(filename) {
      const resourceHref = `${type}/${uuidv4()}`;
      const res = await httpClient.put({
        path: resourceHref,
        body: { type: "person", name: "test user", status: "active" },
      });
      assert.equal(res.status, 201);
      await uploadFilesAndCheck(httpClient, [
        { remotefileName: filename, localFilename: "test/images/orange-boy-icon.png", attachmentKey: uuidv4(), resourceHref },
      ]);
      return resourceHref;
    }

    /**
     * Replaces the body of the next S3 GetObject response by a stream that sends one chunk and
     * then never ends by itself: afterFirstChunk decides what happens next.
     * @param {(body: Readable) => void} afterFirstChunk
     * @returns {{ body?: Readable }}
     */
    function replaceDownloadBody(afterFirstChunk) {
      /** @type {{ body?: Readable }} */
      const state = {};
      restoreS3 = interceptS3(
        () => {},
        (command, response) => {
          if (command.constructor.name !== "GetObjectCommand" || state.body) return response;
          response.Body?.destroy?.(); // the real body is not used
          const body = new Readable({ read() {} });
          body.push(Buffer.alloc(64 * 1024, 0x42));
          state.body = body;
          afterFirstChunk(body);
          return { ...response, Body: body };
        }
      );
      return state;
    }

    it("an S3 read error during a download is logged as a server error", async () => {
      const resourceHref = await createPartyWithAttachment("broken.png");
      const state = replaceDownloadBody((body) =>
        setTimeout(() => body.destroy(new Error("injected S3 read failure")), 200)
      );

      let reqId;
      const { error, failed, logs } = await captureServerErrorLogs(async () => {
        const res = await httpClient.get({ path: `${resourceHref}/attachments/broken.png`, streaming: true });
        assert.equal(res.status, 200);
        reqId = res.headers["vsko-req-id"];
        try {
          await getStreamAsBuffer(res.body);
        } finally {
          // the server destroys the connection before it logs the error
          await new Promise((r) => setTimeout(r, 300));
        }
      });
      assert.ok(state.body, "S3 response body was never replaced");
      assert.ok(failed, "download should not succeed");
      assert.equal(error?.code, "streaming.body.read.failed", `unexpected error: ${error?.message ?? error}`);
      assert.ok(reqId, "missing vsko-req-id header");
      assertErrorInServerLogs(logs, reqId, 500, "download.failed");
    });

    it("a client abort during a download is not logged as a server error", async () => {
      const resourceHref = await createPartyWithAttachment("aborted.png");
      // the S3 body stays open: the download is still running when the client aborts
      const state = replaceDownloadBody(() => {});

      let reqId;
      const { logs } = await captureServerErrorLogs(async () => {
        await new Promise((resolve, reject) => {
          const req = http.get(
            new URL(`${resourceHref}/attachments/aborted.png`, "http://localhost:5000"),
            (res) => {
              reqId = res.headers["vsko-req-id"];
              res.once("data", () => {
                req.destroy(); // client abort
                resolve();
              });
            }
          );
          req.on("error", (err) => (reqId ? resolve() : reject(err)));
        });
        // give the server time to notice the abort and finish the request
        await new Promise((r) => setTimeout(r, 500));
      });

      assert.ok(state.body, "S3 response body was never replaced");
      assert.ok(state.body.destroyed, "server did not stop reading from S3 after the client abort");
      assert.ok(reqId, "missing vsko-req-id header");
      const errorLogs = logs.filter(
        (l) => l.includes(reqId) && /Error in streaming request|download\.failed|status: 500/.test(l)
      );
      assert.deepEqual(errorLogs, [], "client abort logged as server error");
    });
  });
};


// TODO: check if mimetype is set as expected

// TODO : test security??

// TODO : Define resource with S3 and file storage to test both
// TODO : When BLOB database storage is implemented, also add a resource on that with tests
// TODO : Implement + check after & before function (with database access) on GET, PUT and DELETE.
// TODO : add test for filename with special characters (check originalFilename and filename).
