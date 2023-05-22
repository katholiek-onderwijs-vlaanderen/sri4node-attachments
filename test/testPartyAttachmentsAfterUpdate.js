const assert = require("assert");

const FormData = require('form-data');
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const fs = require("fs");
const { SriError } = require("sri4node");

var rewire = require('rewire');
var sri4nodeAttachments = rewire('../js/sri4node-attachments.js');

const getSafeFilename = sri4nodeAttachments.__get__('getSafeFilename');

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
    const url = resourceHref + "/attachments/" + getSafeFilename(remotefileName);

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



const checkStoreAttachment = (file) => {
  if (file.file === null || typeof file.file !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.file.is.not.an.object",
          type: "ERROR",
          message: `expected file.file to be an object`,
        },
      ],
    });
  }
  const expectedFileProperties = [
    'mimetype',
    'filename',
    'originalFilename',
    'tmpFileName',
    'size',
    'hash',
  ]
  expectedFileProperties.forEach(prop => {
    if (file.file[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.file.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.file object is missing property ${prop}`,
          },
        ],
      });
    }
  })

  if (file.attachment === null || typeof file.attachment !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.file.is.not.an.object",
          type: "ERROR",
          message: `expected file.attachment to be an object`,
        },
      ],
    });
  }
  const expectedAttachmentProperties = [
    'key',
    'description',
    'aCustomTestProperty',
  ]
  expectedAttachmentProperties.forEach(prop => {
    if (file.attachment[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.attachment.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.attachment object is missing property ${prop}`,
          },
        ],
      });
    }
  })

  if (file.resource === null || typeof file.resource !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.resource.is.not.an.object",
          type: "ERROR",
          message: `expected resource.attachment to be an object`,
        },
      ],
    });
  }
  const expectedResourceProperties = [
    'href',
    'key',
  ]
  expectedResourceProperties.forEach(prop => {
    if (file.resource[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.resource.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.attachment object is missing property ${prop}`,
          },
        ],
      });
    }
  })
}


/**
 * 
 * @param {*} handleMultipleUploadsTogether 
 * @param {*} uploadInSequence 
 * @param {*} checkStoreAttachmentsReceivedList 
 * @returns 
 */
function checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence, checkStoreAttachmentsReceivedList = undefined) {
  if (handleMultipleUploadsTogether) {
    return (files) => files.forEach(file => checkStoreAttachment(file))
  } else {
    if (uploadInSequence) {
      return (file) => {
        checkStoreAttachmentsReceivedList.push(file.fileObj.filename.substring(0,8));
        checkStoreAttachment(file);
      }
    } else {
      return checkStoreAttachment
    }
  }
}

function clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList) {
  if (checkStoreAttachmentsReceivedList) {
    checkStoreAttachmentsReceivedList.length = 0; // clear the array
  }
}

function verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList) {
  if (checkStoreAttachmentsReceivedList && checkStoreAttachmentsReceivedList.length > 0) {
    const checkStoreAttachmentsReceivedListCopy = [...checkStoreAttachmentsReceivedList];
    checkStoreAttachmentsReceivedListCopy.sort();
    assert.deepStrictEqual(checkStoreAttachmentsReceivedList, checkStoreAttachmentsReceivedListCopy)
  }
}


exports = module.exports = {
  checkStoreAttachmentFactory,
  factory: function (httpClient, type, checkStoreAttachmentsReceivedList) {
    describe(type, function () {
      describe("checkStoreAttachment", function () {
        it("UPLOAD and COPY via upload", async () => {
          try {
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
            const attachmentKey4 = uuid.v4();
            const attachmentDownloadUrl1 = type + "/" + resourceKey + "/attachments/profile1_*__.png";
            const attachmentDownloadUrl2 = type + "/" + resourceKey + "/attachments/profile2.png";
            const attachmentDownloadUrl3 = type + "/" + resourceKey + "/attachments/profile3.png";
            const attachmentDownloadUrl4 = type + "/" + resourceKey + "/attachments/profile4.png";
            const attachmentKey1b = uuid.v4();
            const attachmentKey2b = uuid.v4();
            const attachmentKey3b = uuid.v4();
            const attachmentKey4b = uuid.v4();

            const response = await httpClient.put({ path: resourceHref, body });
            assert.equal(response.status, 201);

            debug("PUTting the profile images as attachments");
            const filesToPut = [
              {
                remotefileName: "profile1 *% .png",
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
              {
                remotefileName: "profile4.png",
                localFilename: "test/images/avatar-blue.png",
                attachmentKey: attachmentKey4,
                resourceHref,
              },
            ];

            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

            // Multiple upload with one extra attachment which is a copy of an existing attachment
            const filesToPut2 = [
              {
                remotefileName: "profile1 *% b.png",
                urlToCopy: attachmentDownloadUrl1,
                attachmentKey: attachmentKey1b,
                resourceHref,
              },
              {
                remotefileName: "profile2b.png",
                urlToCopy: attachmentDownloadUrl2,
                attachmentKey: attachmentKey2b,
                resourceHref,
              },
              {
                remotefileName: "profile3b.png",
                urlToCopy: attachmentDownloadUrl3,
                attachmentKey: attachmentKey3b,
                resourceHref,
              },
              {
                remotefileName: "profile4b.png",
                urlToCopy: attachmentDownloadUrl4,
                attachmentKey: attachmentKey4b,
                resourceHref,
              },
            ];

            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut2);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

          } catch (err) {
            // console.log(err.err)
            assert.fail(err.err);
          }
        });

        it("UPLOAD and COPY via /copy", async () => {
          try {
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
            const attachmentKey4 = uuid.v4();
            const attachmentDownloadUrl1 = type + "/" + resourceKey + "/attachments/profile1_*__.png";
            const attachmentDownloadUrl2 = type + "/" + resourceKey + "/attachments/profile2.png";
            const attachmentDownloadUrl3 = type + "/" + resourceKey + "/attachments/profile3.png";
            const attachmentDownloadUrl4 = type + "/" + resourceKey + "/attachments/profile4.png";
            const attachmentKey1b = uuid.v4();
            const attachmentKey2b = uuid.v4();
            const attachmentKey3b = uuid.v4();
            const attachmentKey4b = uuid.v4();

            const response = await httpClient.put({ path: resourceHref, body });
            assert.equal(response.status, 201);

            debug("PUTting the profile images as attachments");
            const filesToPut = [
              {
                remotefileName: "profile1 *% .png",
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
              {
                remotefileName: "profile4.png",
                localFilename: "test/images/avatar-blue.png",
                attachmentKey: attachmentKey4,
                resourceHref,
              },
            ];

            await uploadFilesAndCheck(httpClient, filesToPut);

            // Multiple upload with one extra attachment which is a copy of an existing attachment
            const filesToPut2 = [
              {
                remotefileName: "profile1 *% b.png",
                urlToCopy: attachmentDownloadUrl1,
                attachmentKey: attachmentKey1b,
                resourceHref,
              },
              {
                remotefileName: "profile2b.png",
                urlToCopy: attachmentDownloadUrl2,
                attachmentKey: attachmentKey2b,
                resourceHref,
              },
              {
                remotefileName: "profile3b.png",
                urlToCopy: attachmentDownloadUrl3,
                attachmentKey: attachmentKey3b,
                resourceHref,
              },
              {
                remotefileName: "profile4b.png",
                urlToCopy: attachmentDownloadUrl4,
                attachmentKey: attachmentKey4b,
                resourceHref,
              },
            ];
            
            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await copyFilesAndCheck(httpClient, filesToPut2);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);
          } catch (err) {
            console.log(err)
            assert.fail(err.err);
          }
        });
      });

    });
  }
};
