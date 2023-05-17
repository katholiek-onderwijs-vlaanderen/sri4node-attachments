const assert = require("assert");

const FormData = require('form-data');
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const fs = require("fs");

/**
 * @typedef { {
 *  remotefileName: string,
 *  urlToCopy?: string,
 *  localFilename: string,
 *  attachmentKey: string,
 *  resourceHref: string
 * } } TFileToUpload
 * @typedef { {
 *  remotefileName: string,
 *  urlToCopy: string,
 *  attachmentKey: string,
 *  resourceHref: string
 * } } TFileToCopy
 * 
 * @typedef { import("./httpClient.js").THttpClient } THttpClient
 * @typedef { import("./httpClient.js").THttpResponse } THttpResponse
 * @typedef { import("../js/sri4node-attachments.js").TReadableStream } TReadableStream
 */

/**
 * This function does a GET requests as a streaming request and when succesfull, returns
 * a stream of the body.
 * @param {THttpClient} httpClient
 * @param {string} url 
 * @returns {Promise<TReadableStream>}
 */
const doGetStream = async (httpClient, url) => {
    const { status, body } = await httpClient.get({ path: url, streaming: true });
    assert.equal(status, 200, 'getStream received unexpected status code');
    return body;
};

/**
 * This function requests deletion of an attachments and then verifies if the attachments
 * is really gone.
 * @param {THttpClient} httpClient 
 * @param {string} attachmentUrl 
 * @param {string} attachmentDownloadUrl 
 */
const deleteAttachmentAndVerify = async (
  httpClient,
  attachmentUrl,
  attachmentDownloadUrl
) => {
  // Delete the attachment
  const responseDelete = await httpClient.delete({ path: attachmentUrl });
  assert.equal(responseDelete.status, 204);

  // verify if attachment is gone
  const responseGetAtt2 = await httpClient.get({ path: attachmentUrl });
  assert.equal(responseGetAtt2.status, 404);
  const responseGetAtt3 = await httpClient.get({ path: attachmentDownloadUrl });
  assert.equal(responseGetAtt3.status, 404);
};


/**
 * Creates the JSON body describing the attachment files, which can be passed at multipart
 * upload or at /attachments/copy ?
 * @param {Array<TFileToUpload | TFileToCopy>} fileDetails 
 * @returns 
 */
const createUploadBody = (fileDetails) => {
  return fileDetails.map(
    ({ remotefileName, attachmentKey, resourceHref, urlToCopy }) => ({
      file: remotefileName,
      fileHref: urlToCopy, // can be undefined, but if it's there, this is the url that should be copied
      // instead of uploading a local file
      attachment: {
        key: attachmentKey,
        description: `this is MY file with key ${attachmentKey}`,
        aCustomTestProperty: 1000,
      },
      resource: {
        href: resourceHref,
      },
    })
  )
}

/**
 * This will use the /resource/attachments endpoint to upload one or multiple files.
 * This is a multipart post, where the 'body' part is a stringified and properly escaped
 * (escaping is handled by needle) JSON array of objects, each object having the following
 * properties:
 * ```javascript
 * {
 *    file: 'remotefileName', // string
 *    attachment: {
 *      key: attachmentKey, // guid
 *      description: `this is MY file`, // string
 *    },
 *    resource: {
 *      href: resourceHref, // href to the resource to which this attachment is attached
 *    },
 * }
 * ```
 * The 'data' part is a file, which is the local file to be uploaded.
 *
 * This translates to something like this:
 * ```
 * POST /partiesS3/attachments HTTP/1.1
 * content-type: multipart/form-data; boundary=--------------------NODENEEDLEHTTPCLIENT
 * content-length: 10977
 * host: localhost:5000
 * Connection: close
 *
 * ----------------------NODENEEDLEHTTPCLIENT
 * Content-Disposition: form-data; name="body"
 *
 * [{"file":"profile.png","attachment":{"key":"18f6f8ea-3926-4fe7-80a0-49cec88a66fd","description":"this is MY file with key 18f6f8ea-3926-4fe7-80a0-49cec88a66fd"},"resource":{"href":"/partiesS3/2691d53a-6f24-416e-9621-3cd14c05c5a6"}}]
 * ----------------------NODENEEDLEHTTPCLIENT
 * Content-Disposition: form-data; name="data"; filename="profile.png"
 * Content-Transfer-Encoding: binary
 * Content-Type: image/png
 *
 * <binary data>
 * ----------------------NODENEEDLEHTTPCLIENT--
 * ```
 *
 * An alternative form could be using additional headers to indicate file properties instead of the JSON 'body':
 *
 * ```js
 *   const form = new FormData();
 *   form.append(`1_${localFilename}`, fs.createReadStream(localFilename), { header: { hello: 'goodbye' } });
 *   form.append(`2_${localFilename}`, fs.createReadStream(localFilename));
 *   form.append(`3_${localFilename}`, fs.createReadStream(localFilename));
 * ```
 *
 * Which translates to something like this:
 * ```
 * POST /partiesS3 HTTP/1.1
 * content-type: multipart/form-data; boundary=--------------------------732677279853170760492713
 * Host: localhost:5000
 * Content-Length: 31895
 * Connection: close
 *
 * ----------------------------732677279853170760492713
 * Content-Disposition: form-data; name="1_test/orange-boy-icon.png"; filename="orange-boy-icon.png"
 * Content-Type: image/png
 * hello: goodbye
 *
 * <binary data>
 * ----------------------------732677279853170760492713
 * Content-Disposition: form-data; name="2_test/orange-boy-icon.png"; filename="orange-boy-icon.png"
 * Content-Type: image/png
 *
 * <binary data>
 * ----------------------------732677279853170760492713
 * Content-Disposition: form-data; name="3_test/orange-boy-icon.png"; filename="orange-boy-icon.png"
 * Content-Type: image/png
 *
 * <binary data>
 * ----------------------------732677279853170760492713--
 * ```
 *
 * @param {THttpClient} httpClient
 * @param {string} resourceUrl is the url of the resource for which you want to put an attachment
 *                              for example https://localhost:5000/partiesS3/<some-guid>
 * @param {Array<TFileToUpload | TFileToCopy>} fileDetails
 * @returns {Promise<THttpResponse>} a http response
 */
async function doPutFiles(httpClient, resourceUrl, fileDetails) {
  const body = createUploadBody(fileDetails);
  const formData = new FormData();
  formData.append('body', JSON.stringify(body));

  fileDetails
    .forEach((f) => {
      if ('localFilename' in f) {
        const { remotefileName, localFilename, attachmentKey } = f;
        formData.append(attachmentKey, fs.createReadStream(localFilename), {
          filename: remotefileName,
          contentType: 'image/png',
        })
      }
    });

  // Currently in sri4node a streaming request automatically results in a streaming response.
  // -> process the response streaming to be able to catch errors (see getStreamAsBuffer function
  //    for more information).
  const response = await httpClient.post({
    path: resourceUrl + "/attachments",
    headers: formData.getHeaders(), // needed to make it a multipart request !
    body: formData,
    streaming: true, // ask for streaming response
  });

  const responseBody = (await getStreamAsBuffer(response.body)).toString();
  return {
    ...response,
    body: responseBody,
  }
}

/**
 * Reads a stream into a buffer.
 * 
 * In case of errors during a streaming response (at this point the client already received a http 200 with headers),
 * the only way a server can indicate this is to drop the connection (and eventually dump an error message as text 
 * into the stream). To be able to check error messages in failure test cases, the partial body which has been read
 * before the error and which might contain an error message is thrown to the client in a wrapped error object.
 *
 * @param {TReadableStream} stream
 * @returns {Promise<Buffer>}
 */
async function getStreamAsBuffer(stream) {
  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    throw {
      code: 'streaming.body.read.failed',
      err,
      partialBody: Buffer.concat(chunks),
    };
  }
}

/**
 * Will throw an assertion error if the two streams are not equal.
 *
 * We'll collect all bytes first because we only expect short files!
 *
 * @param {TReadableStream} s1
 * @param {TReadableStream} s2
 * @throws {AssertionError}
 */
async function checkStreamEqual(s1, s2) {
  const b1 = await getStreamAsBuffer(s1);
  const b2 = await getStreamAsBuffer(s2);
  if (b1.byteLength !== b2.byteLength) {
    assert.fail(
      `Streams are not equal. They have different lengths: ${b1.byteLength} != ${b2.byteLength}`
    );
  }
  let index = 0;
  const it2 = b2[Symbol.iterator]();
  for (const v1 of b1) {
    const { value: v2 } = await it2.next();
    if (v1 !== v2) {
      assert.fail(
        `Streams are not equal. At position ${index} ${v1.toString()} != ${v2.toString()}`
      );
    }
    index++;
  }
}

/**
 * A function which will check if the uploaded files are uploaded correctly,
 * by downloading them again from the api, and by comparing the bytestream with the file
 * on disk.
 * It also supports copyied files from another url.
 *
 * @param {THttpClient} httpClient
 * @param {Array<{ remotefileName, localFilename?, attachmentKey, resourceHref, urlToCopy?}>} filesToPut
 */
async function checkUploadedFiles(httpClient, filesToPut) {
  for (const {
    remotefileName,
    localFilename,
    resourceHref,
    urlToCopy,
  } of filesToPut) {
    const url = resourceHref + "/attachments/" + remotefileName;

    const getStream = await doGetStream(httpClient, url);

    if (localFilename) {
      await checkStreamEqual(getStream, fs.createReadStream(localFilename));
    } else if (urlToCopy) {
      await checkStreamEqual(getStream, await doGetStream(httpClient, urlToCopy));
    }
  }
}

/**
 * This will upload all the files in the filesToPut array, and then check if the files are
 * uploaded correctly (by checking status code + comparing the downloaded stream to the file
 * on disk).
 *
 * @param {THttpClient} httpClient
 * @param {Array<TFileToUpload | TFileToCopy>} filesToPut
 */
async function uploadFilesAndCheck(httpClient, filesToPut) {
  if (filesToPut && filesToPut.length > 0) {
    const href = filesToPut[0].resourceHref;
    const basePath = href.substring(0, href.lastIndexOf("/"));
    const putResponse = await doPutFiles(httpClient, basePath, filesToPut);

    assert.equal(putResponse.status, 200);

    await checkUploadedFiles(httpClient, filesToPut);
  } else {
    assert.fail("[uploadFilesAndCheck]: filesToPut is empty or not defined.");
  }
}

async function copyFilesAndCheck(httpClient, filesToPut) {
  if (filesToPut && filesToPut.length > 0) {
    const href = filesToPut[0].resourceHref;
    const basePath = href.substring(0, href.lastIndexOf("/"));

    const body = createUploadBody(filesToPut);

    const responseStreaming = await httpClient.post({
      path: `${basePath}/attachments/copy`,
      body,
      streaming: true, // ask for streaming response
    });

    const response = {
      ...responseStreaming,
      body: (await getStreamAsBuffer(responseStreaming.body)).toString(),
    }

    assert.equal(response.status, 200);

    await checkUploadedFiles(httpClient, filesToPut);
  } else {
    assert.fail("[copyFilesAndCheck]: filesToPut is empty or not defined.");
  }
}

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
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();

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

        // Next : try to delete the resource.
        const response6 = await httpClient.delete({ path: attachmentUrl });
        assert.equal(response6.status, 204);
        // Now check that is is gone..
        const response7 = await httpClient.get({ path: attachmentDownloadUrl });
        assert.equal(response7.status, 404);
      });

      it("should be idempotent", async function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();
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

      it.skip("add and replace should work", async function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey1 = uuid.v4();
        const attachmentKey2 = uuid.v4();

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

        // Check if we have the two expected attachments
        const responseGet1 = await httpClient.get({ path: type + "/" + resourceKey });
        assert.equal(responseGet1.status, 200);
        console.log(responseGet1.body.attachments.length, 2);
        for (const href of responseGet1.body.attachments.map((a) => a.href)) {
          const responseGetA = await httpClient.get({ path: href });
          assert.equal(responseGetA.status, 200);
        }

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
        // TODO: this does not work: attachment is not being overwritten by reusing a attachmentKey !
        assert.equal(responseGet3.status, 404);
      });
    });

    describe("PUT MULTIPLE (customRouteForUpload)", function () {
      it("should allow adding of 2 files as attachment in a single POST multipart/form-data operation", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey1 = uuid.v4();
        const attachmentKey2 = uuid.v4();
        const attachmentKey3 = uuid.v4();
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
        const response6 = await httpClient.delete({ path: attachmentUrl1 });
        assert.equal(response6.status, 204);
        // Now check that one attachment is gone and the others are still available
        const response7 = await httpClient.get({ path: attachmentDownloadUrl1 });
        assert.equal(response7.status, 404);
        const response8 = await httpClient.get({ path: attachmentDownloadUrl2 });
        assert.equal(response8.status, 200);
        const response9 = await httpClient.get({ path: attachmentDownloadUrl3 });
        assert.equal(response9.status, 200);
      });

      it("should also allow copying of existing files as (together with uploading some files) single POST multipart/form-data operation", async () => {
        // TODO: finish this test and make it work
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey1 = uuid.v4();
        const attachmentKey2 = uuid.v4();
        const attachmentKey3 = uuid.v4();
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

      it.skip("should support handleMultipleUploadsTogether", async () => {
        // TODO: implement this test (or remove the feature)
      });

      it("invalid combination of copy and upload properties should give an error", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey1 = uuid.v4();
        const attachmentKey2 = uuid.v4();

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
          assert.fail('An error is expected !')
        } catch (err) {
          assert.equal(err.code, 'streaming.body.read.failed');
          const partialBodyStr = err.partialBody.toString();
          assert.equal(partialBodyStr.includes('"status": 400'), true, 'expected status code 400 missing in partial body');
          assert.equal(partialBodyStr.includes('"code": "upload.and.copy.mix"'), true, 'expected error code missing in partial body');
        }
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
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();
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
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const copyResponse = await httpClient.put({ path: resourceCopyHref, body });
        assert.equal(copyResponse.status, 201);

        const attachmentCopyKey = uuid.v4();

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
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey1 = uuid.v4();
        const attachmentKey2 = uuid.v4();
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
        const attachmentCopyKey1 = uuid.v4();
        const attachmentCopyKey2 = uuid.v4();

        const copyAttBody = [
          {
            file: "profile1.png",
            fileHref: attachmentUrl1,
            attachment: {
              key: attachmentCopyKey1,
              description: `this is MY file with key ${attachmentKey1}`,
            },
            resource: {
              href: resourceCopyHref,
            },
          },
          {
            file: "profile2.png",
            fileHref: attachmentUrl2,
            attachment: {
              key: attachmentCopyKey2,
              description: `this is MY file with key ${attachmentKey1}`,
            },
            resource: {
              href: resourceCopyHref,
            },
          },
        ];
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
        const attachmentKey1 = uuid.v4();
        const resourceCopyKey = uuid.v4();
        const resourceCopyHref = type + "/" + resourceCopyKey;
        const attachmentCopyKey1 = uuid.v4();

        const copyAttBody = [
          {
            file: "profile1.png",
            attachment: {
              key: attachmentCopyKey1,
              description: `this is MY file with key ${attachmentKey1}`,
            },
            resource: {
              href: resourceCopyHref,
            },
          },
        ];
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
