/*global Buffer*/
const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
const assert = require("assert");
const FormData = require('form-data');
const fs = require("fs");
const S3 = require("@aws-sdk/client-s3");


/* rewire adds a special setter and getter to modules so you can modify their behaviour for better unit testing. 
   this is used to access the private function 'getSafeFilename' of js/sri4node-attachments.js */
var rewire = require('rewire');
var sri4nodeAttachments = rewire('../js/sri4node-attachments.js');

const getSafeFilename = sri4nodeAttachments.__get__('getSafeFilename');

/**
 * @typedef { {
 *  remotefileName: string,
 *  urlToCopy?: string,
 *  localFilename: string,
 *  attachmentKey: string,
 *  resourceHref: string,
 *  attachment?: {description?: string; href?: string;}
 * } } TFileToUpload
 * @typedef { {
 *  remotefileName?: string,
 *  urlToCopy?: string,
 *  attachmentKey: string,
 *  resourceHref: string,
 *  attachment?: {description?: string; href?: string;}
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
    try {
      const { status, body } = await httpClient.get({ path: url, streaming: true });
      assert.equal(status, 200, 'getStream received unexpected status code');
      return body;
    } catch (err) {
      throw {
        code: 'attachment.download.failed',
        err,
        url,
      };
    }
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
    ({
      remotefileName,
      attachmentKey,
      resourceHref,
      urlToCopy,
      attachment,
    }) => ({
      file: remotefileName, // can be undefined in that case of copy (in this case the name of the original file is taken)
      fileHref: urlToCopy, // can be undefined, but if it's there, this is the url that should be copied
      // instead of uploading a local file
      attachment: {
        key: attachmentKey,
        description: `this is MY file with key ${attachmentKey}`,
        aCustomTestProperty: 1000,
        ...attachment,
      },
      resource: {
        href: resourceHref,
      },
    })
  );
};

// ...(someCondition && {b: 5})

// { attachmentKey: attachmentCopyKey1,
//   resourceHref: resourceCopyHref
//   urlToCopy: attachmentUrl1 
// }

// {
//   fileHref: attachmentUrl1,
//   attachment: {
//     key: attachmentCopyKey1,
//     description: `this is MY file with key ${attachmentKey1}`,
//   },
//   resource: {
//     href: resourceCopyHref,
//   },
// },


/**
 * This will use the /resource/attachments endpoint to upload one or multiple files.
 * This is a multipart post, where the 'body' part is a stringified and properly escaped
 * (escaping is handled by http client) JSON array of objects, each object having the following
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
 * @param {string} resourcePath is the path of the resource for which you want to put an attachment
 *                              for example /partiesS3/<some-guid>
 * @param {Array<TFileToUpload | TFileToCopy>} fileDetails
 * @returns {Promise<THttpResponse>} a http response
 */
async function doPutFiles(httpClient, resourcePath, fileDetails) {
  const body = createUploadBody(fileDetails);
  const formData = new FormData();
  formData.append('body', JSON.stringify(body));

  fileDetails
    .forEach((f) => {
      if ('localFilename' in f) {
        const { remotefileName, localFilename } = f;
        formData.append('data', fs.createReadStream(localFilename), remotefileName );
      }
    });

  // Currently in sri4node a streaming request automatically results in a streaming response.
  // -> process the response streaming to be able to catch errors (see getStreamAsBuffer function
  //    for more information).
  const response = await httpClient.post({
    path: resourcePath + "/attachments",
    headers: formData.getHeaders(), // needed to make it a multipart request !
    body: formData,
    streaming: true, // ask for streaming response
  });

  if (response.status !== 200) {
    return response;
  }
  const responseBody = (await getStreamAsBuffer(response.body)).toString();
  return {
    ...response,
    body: responseBody,
  };
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
    const { value: v2 } = it2.next();
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
 * It also supports copied files from another url.
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
      // console.log(`Comparing get result with local file ${localFilename}`);
      await checkStreamEqual(getStream, fs.createReadStream(localFilename));
    } else if (urlToCopy) {
      // console.log(`Comparing get result with source url ${urlToCopy}`);
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
  if (filesToPut === undefined || filesToPut.length === 0) {
    assert.fail("[uploadFilesAndCheck]: filesToPut is empty or not defined.");
  }
  const resourceHref = filesToPut[0].resourceHref;
  const basePath = resourceHref.substring(0, resourceHref.lastIndexOf("/"));
  const putResponse = await doPutFiles(httpClient, basePath, filesToPut);

  assert.equal(putResponse.status, 200);

  await checkUploadedFiles(httpClient, filesToPut);

  // also check if hrefs in attachments section of the resource JSON
  // are downloadable
  const responseGet = await httpClient.get({ path: resourceHref });
  assert.equal(responseGet.status, 200);
  for (const href of responseGet.body.attachments.map((a) => a.href)) {
    try {
      const responseGetA = await httpClient.get({ path: href });
      assert.equal(responseGetA.status, 200);
    } catch (err) {
      throw {
        code: 'attachment.download.failed',
        err,
        href,
      };
    }
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
    };

    assert.equal(response.status, 200);

    await checkUploadedFiles(httpClient, filesToPut);
  } else {
    assert.fail("[copyFilesAndCheck]: filesToPut is empty or not defined.");
  }
}

/**
 * Converts the partialBody of a streaming error to a string
 * (it can be a Buffer, an array of bytes, or a string).
 * @param {any} partialBody
 * @returns {string}
 */
function partialBodyToString(partialBody) {
  if (partialBody === undefined || partialBody === null) return "";
  if (typeof partialBody === "string") return partialBody;
  if (Buffer.isBuffer(partialBody)) return partialBody.toString("utf8");
  if (Array.isArray(partialBody)) {
    // could be an array of bytes or an array of Buffers
    return partialBody.every((b) => typeof b === "number")
      ? Buffer.from(partialBody).toString("utf8")
      : Buffer.concat(partialBody.map((b) => Buffer.from(b))).toString("utf8");
  }
  return String(partialBody);
}

/**
 * Escapes a string for literal use inside a RegExp.
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tries to extract the JSON error object that sri4node writes into the stream
 * (possibly preceded by padding like "\n\n\n____").
 * @param {string} text
 * @returns {any | undefined}
 */
function parseErrorJsonFromPartialBody(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Normalizes an error body: sri4node can return either { errors, status }
 * or a wrapped SriError { status, body: { errors, status } }.
 * @param {any} body
 * @returns {{ status?: number, errors?: any[] } | undefined}
 */
function normalizeErrorBody(body) {
  if (!body || typeof body !== "object") return undefined;
  if (Array.isArray(body.errors)) return body;
  if (body.body && typeof body.body === "object" && Array.isArray(body.body.errors)) {
    return { status: body.status ?? body.body.status, errors: body.body.errors };
  }
  return body;
}


/**
 * Checks that the (parsed) error body contains exactly the expected code and status.
 * @param {any} rawBody
 * @param {number} expectedStatus
 * @param {string} expectedCode
 * @param {string} context
 */
function assertErrorBody(rawBody, expectedStatus, expectedCode, context) {
  const body = normalizeErrorBody(rawBody);
  assert.ok(
    body && Array.isArray(body.errors),
    `${context}: expected an errors array, got ${JSON.stringify(rawBody)}`
  );
  const codes = body.errors.map((e) => e.code);
  assert.ok(
    codes.includes(expectedCode),
    `${context}: expected error code '${expectedCode}', got [${codes.join(", ")}]`
  );
  if (body.status !== undefined) {
    assert.equal(body.status, expectedStatus, `${context}: unexpected status in body`);
  }
}

/**
 * Expects a request to fail with the given status and error code.
 * Accepts both:
 *  - a proper error response (status + JSON body with errors[])
 *  - a connection reset after the headers were sent (streaming.body.read.failed),
 *    in which case the error code must appear in the partial body
 *
 * @param {() => Promise<any>} doRequest function that performs the request
 * @param {number} expectedStatus
 * @param {string} expectedCode
 */
async function expectRequestError(doRequest, expectedStatus, expectedCode) {
  let response;
  let body;
  try {
    response = await doRequest();
    // reading the body can also fail when the server closes the connection
    body =
      response.body && typeof response.body.json === "function"
        ? await response.body.json()
        : response.body;
  } catch (e) {
    if (e && e.code === "streaming.body.read.failed") {
      const text = partialBodyToString(e.partialBody);
      const parsed = parseErrorJsonFromPartialBody(text);
      if (parsed !== undefined) {
        assert.equal(
          normalizeErrorBody(parsed)?.status,
          expectedStatus,
          "partial body: unexpected or missing status"
        );
        assertErrorBody(parsed, expectedStatus, expectedCode, "partial body");
        return;
      }

      // fallback when the JSON is truncated: require an exact "code" field and status field
      const codeRe = new RegExp(`"code"\\s*:\\s*"${escapeRegExp(expectedCode)}"`);
      const statusRe = new RegExp(`"status"\\s*:\\s*${expectedStatus}(?!\\d)`);
      assert.ok(
        codeRe.test(text),
        `expected exact error code '${expectedCode}' in partial body, got: ${text.slice(0, 500)}`
      );
      assert.ok(
        statusRe.test(text),
        `expected status ${expectedStatus} in partial body, got: ${text.slice(0, 500)}`
      );
      return;
    }
    throw e;
  }

  assert.equal(
    response.status,
    expectedStatus,
    `expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`
  );
  const parsedBody = typeof body === "string" ? JSON.parse(body) : body;
  assertErrorBody(parsedBody, expectedStatus, expectedCode, "response body");
}

/**
 * Lists the keys of all .tmp objects in the test bucket.
 * @returns {Promise<string[]>}
 */
async function listTmpObjects() {
  const s3 = new S3Client({
    endpoint: "http://localhost:4566/",
    region: "eu-west-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const keys = [];
  let ContinuationToken;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: "tests3bucket", ContinuationToken })
    );
    keys.push(...(res.Contents ?? []).map((o) => o.Key).filter((k) => k.endsWith(".tmp")));
    ContinuationToken = res.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
}

/**
 * Temporarily intercepts S3Client.send. The interceptor can throw, delay or return
 * undefined (= pass through). Returns a restore function.
 * @param {(command: any, callIndex: number) => Promise<void> | void} interceptor
 */
function interceptS3(interceptor) {
  const originalSend = S3.S3Client.prototype.send;
  let callIndex = 0;
  S3.S3Client.prototype.send = async function (command, ...rest) {
    await interceptor(command, callIndex++);
    return originalSend.call(this, command, ...rest);
  };
  return () => {
    S3.S3Client.prototype.send = originalSend;
  };
}

/**
 * Returns the target key of a put/upload/copy command (if any).
 * @param {any} command
 * @returns {string | undefined}
 */
function commandKey(command) {
  return command?.input?.Key;
}

/**
 * Lists all object keys in the test bucket starting with the given prefix.
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
async function listObjectsWithPrefix(prefix) {
  const s3 = new S3.S3Client({
    endpoint: "http://localhost:4566/",
    region: "eu-west-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const keys = [];
  let ContinuationToken;
  do {
    const res = await s3.send(
      new S3.ListObjectsV2Command({ Bucket: "tests3bucket", Prefix: prefix, ContinuationToken })
    );
    keys.push(...(res.Contents ?? []).map((o) => o.Key));
    ContinuationToken = res.NextContinuationToken;
  } while (ContinuationToken);
  return keys.sort();
}

exports = module.exports = {
  doGetStream,
  checkStreamEqual,
  createUploadBody,
  doPutFiles,
  deleteAttachmentAndVerify,
  uploadFilesAndCheck,
  copyFilesAndCheck,
  expectRequestError,
  listTmpObjects,
  interceptS3,
  commandKey,
  listObjectsWithPrefix,
};