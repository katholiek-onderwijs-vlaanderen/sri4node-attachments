/*global Buffer, process*/
const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
const assert = require("assert");
const FormData = require('form-data');
const fs = require("fs");
const S3 = require("@aws-sdk/client-s3");
const http = require("http");


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
 * Generic message sri4node (>= 2.3.50) writes into a streaming response when an error occurs
 * after the headers were sent. The actual error (code, status) is only logged server side.
 */
const STREAMING_ERROR_MSG = "Error in streaming request after headers were sent; destroying stream.";

/**
 * Captures everything written to stderr and stdout while doFn runs: sri4node logs its errors to
 * stderr, but the "error" debug channel (used for request related errors, e.g. by this plugin)
 * logs to stdout. Output is still passed through.
 * @template T
 * @param {() => Promise<T>} doFn
 * @returns {Promise<{ result?: T, error?: any, failed: boolean, logs: string[] }>}
 */
async function captureServerErrorLogs(doFn) {
  /** @type {string[]} */
  const logs = [];
  const outputs = [process.stderr, process.stdout];
  const originalWrites = outputs.map((output) => output.write);
  outputs.forEach((output, index) => {
    output.write = function (chunk, ...rest) {
      try {
        logs.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      } catch {
        // ignore
      }
      return originalWrites[index].call(output, chunk, ...rest);
    };
  });
  try {
    return { result: await doFn(), failed: false, logs };
  } catch (error) {
    return { error, failed: true, logs };
  } finally {
    outputs.forEach((output, index) => {
      output.write = originalWrites[index];
    });
  }
}

/**
 * Checks that the server logged an error with the expected code and status (for the given reqId
 * if known).
 * @param {string[]} logs
 * @param {string | undefined} reqId
 * @param {number} expectedStatus
 * @param {string} expectedCode
 */
function assertErrorInServerLogs(logs, reqId, expectedStatus, expectedCode) {
  // plain log mode: util.inspect output (code: 'x'), json log mode: "code":"x"
  const codeRe = new RegExp(`["']?code["']?\\s*:\\s*["']${escapeRegExp(expectedCode)}["']`);
  const statusRe = new RegExp(`["']?status["']?\\s*:\\s*${expectedStatus}(?!\\d)`);
  const candidates = reqId ? logs.filter((l) => l.includes(reqId)) : logs;
  const match = candidates.find((l) => codeRe.test(l) && statusRe.test(l));
  assert.ok(
    match,
    `expected error code '${expectedCode}' with status ${expectedStatus} in server logs` +
      `${reqId ? ` for reqId ${reqId}` : ""}, got:\n${candidates.join("").slice(0, 2000)}`
  );
}

/**
 * For an error after the headers of a streaming response were sent: checks that the partial body
 * contains the generic sri4node streaming error message and that the server logged the expected
 * error code + status for that request.
 * @param {any} partialBody
 * @param {string[]} logs captured with captureServerErrorLogs
 * @param {number} expectedStatus
 * @param {string} expectedCode
 */
function assertStreamingErrorLogged(partialBody, logs, expectedStatus, expectedCode) {
  const text = partialBodyToString(partialBody);
  assert.ok(
    text.includes(STREAMING_ERROR_MSG),
    `expected generic streaming error message in partial body, got: ${text.slice(-500)}`
  );
  const reqIdMatch = /\(reqId ([^)\s]+)\)/.exec(text);
  const reqId = reqIdMatch && reqIdMatch[1] !== "undefined" ? reqIdMatch[1] : undefined;
  assertErrorInServerLogs(logs, reqId, expectedStatus, expectedCode);
}

/**
 * Expects a request to fail with the given status and error code.
 * Accepts both:
 *  - a proper error response (status + JSON body with errors[])
 *  - a connection reset after the headers were sent (streaming.body.read.failed),
 *    in which case the partial body must contain the generic sri4node streaming error message
 *    and the expected error code + status must appear in the server error logging
 *
 * @param {() => Promise<any>} doRequest function that performs the request
 * @param {number} expectedStatus
 * @param {string} expectedCode
 */
async function expectRequestError(doRequest, expectedStatus, expectedCode) {
  const { result: response, error, failed, logs } = await captureServerErrorLogs(async () => {
    const resp = await doRequest();
    // reading the body can also fail when the server closes the connection
    const body =
      resp.body && typeof resp.body.json === "function" ? await resp.body.json() : resp.body;
    return { ...resp, body };
  });

  if (failed) {
    if (error && error.code === "streaming.body.read.failed") {
      assertStreamingErrorLogged(error.partialBody, logs, expectedStatus, expectedCode);
      return;
    }
    throw error;
  }

  const { body } = response;
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
 * undefined (= pass through). The optional transformResponse can replace (parts of) the
 * response. Returns a restore function.
 * @param {(command: any, callIndex: number) => Promise<void> | void} interceptor
 * @param {(command: any, response: any) => any} [transformResponse]
 */
function interceptS3(interceptor, transformResponse = (_command, response) => response) {
  const originalSend = S3.S3Client.prototype.send;
  let callIndex = 0;
  S3.S3Client.prototype.send = async function (command, ...rest) {
    await interceptor(command, callIndex++);
    return transformResponse(command, await originalSend.call(this, command, ...rest));
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

/**
 * Sends a multipart upload request with a large, incomplete file part and then aborts
 * the connection. Used to trigger busboy/file stream errors server side.
 * @param {object} opts
 * @param {string} opts.baseUrl e.g. "http://localhost:5000"
 * @param {string} opts.uploadPath e.g. "/partiesS3/attachments"
 * @param {string} opts.resourceHref e.g. "/partiesS3/<key>"
 * @param {string} [opts.method] same method as doPutFiles uses
 * @param {number} [opts.bytesBeforeAbort] > 5MB so lib-storage actually starts uploading
 * @param {number} [opts.waitBeforeAbortMs]
 * @param {Array<{ name: string, size: number }>} [opts.leadingFiles] complete file parts sent
 *    before the incomplete one
 * @param {number} [opts.waitBeforePartialMs] wait between the leading files and the incomplete part
 * @returns {Promise<void>}
 */
function sendPartialMultipartAndAbort({
  baseUrl,
  uploadPath,
  resourceHref,
  method = "POST",
  bytesBeforeAbort = 6 * 1024 * 1024,
  waitBeforeAbortMs = 500,
  leadingFiles = [],
  waitBeforePartialMs = 0,
}) {
  const boundary = `----test${Date.now()}`;
  const fileName = "abort.png";
  const bodyJson = JSON.stringify(
    [...leadingFiles.map((f) => f.name), fileName].map((file) => ({
      file,
      attachment: { key: require("crypto").randomUUID() },
      resource: { href: resourceHref },
    }))
  );

  // every part ends with the delimiter of the next one ("\r\n--boundary"), so busboy knows
  // immediately that a (leading) file part is complete
  const filePartHeader = (name) =>
    `\r\nContent-Disposition: form-data; name="data"; filename="${name}"\r\n` +
    `Content-Type: image/png\r\n\r\n`;

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="body"\r\n\r\n` +
    `${bodyJson}\r\n--${boundary}`;

  const url = new URL(uploadPath, baseUrl);

  return new Promise((resolve) => {
    const req = http.request(url, {
      method,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        // no content-length: chunked, so the server keeps waiting for more data
      },
    });
    // the abort produces client-side errors as well; those are expected
    req.on("error", () => resolve());
    req.on("response", (res) => {
      res.resume();
      res.on("end", resolve);
      res.on("error", () => resolve());
    });

    req.write(head);
    for (const { name, size } of leadingFiles) {
      req.write(filePartHeader(name));
      req.write(Buffer.alloc(size, 0x41));
      req.write(`\r\n--${boundary}`);
    }

    setTimeout(() => {
      req.write(filePartHeader(fileName));
      req.write(Buffer.alloc(bytesBeforeAbort, 0x42)); // incomplete file part, no closing boundary

      setTimeout(() => {
        req.destroy(); // client abort -> busboy emits 'error' on the file stream
        resolve();
      }, waitBeforeAbortMs);
    }, waitBeforePartialMs);
  });
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
  captureServerErrorLogs,
  assertErrorInServerLogs,
  getStreamAsBuffer,
  listTmpObjects,
  interceptS3,
  commandKey,
  listObjectsWithPrefix,
  sendPartialMultipartAndAbort,
};