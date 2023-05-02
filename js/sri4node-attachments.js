const pEvent = require("p-event");
const S3 = require("@aws-sdk/client-s3");
// const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const S3PresignedPost = require("@aws-sdk/s3-presigned-post");
const mime = require("mime-types");
const { v4: uuidv4 } = require("uuid");

/**
 * When uploading a file via a POST multipart message, there must be a 'field' called body,
 * which describes which file(s) are being sent.
 * This field must contain a JSON.stringified JSON array that contains objects that must respect
 * a common format.
 * This format is typed here separately. On single file uplods the body does not have to be an array
 * and can also be a single object
 * @typedef { {
 *    file: string, // the  filename
 *    attachment: {
 *      key: string,
 *      description?: string,
 *      name: string,
 *      href: string,
 *    },
 *    resource: {
 *      href: string,
 *    },
 *    ignoreNotFound?: boolean,
 * } } TMultiPartSingleBodyForFileUploads
 *
 * @typedef { TMultiPartSingleBodyForFileUploads & { fileHref: string } } TBodyForFileCopy
 *
 * @typedef { TMultiPartSingleBodyForFileUploads & { fileObj: TFileObj } } TMultiPartSingleBodyForFileUploadsWithFileObj
 */

/**
 * @typedef { {
 *  filename: string,
 *  originalFilename?: string,
 *  tmpFileName?: string,
 *  mimetype: string,
 *  file?: import('stream').Readable,
 *  fields?: Record<string, any>,
 *  hash?: string,
 *  size?: number,
 * } } TFileObj
 */

/**
 * @param {string} href for example /things/123
 * @returns {string} the last part of the href, which is the key
 */
function hrefToKey(href) {
  const chunks = href.split("/");
  return chunks[chunks.length - 1];
}

/**
 * Cleans up a filename before uploading it to S3.
 * First it is decoded in case it contains any encoded characters (eg %21 -> !).
 * Then any special characters are replaced according to these guidelines: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
 * @param {String} filename
 * @returns {string}
 */
function getSafeFilename(filename) {
  try {
    const decodedFilename = decodeURIComponent(filename);
    return decodedFilename.replace(/[^a-zA-Z0-9\-!_.*'()]/g, "_");
  } catch (error) {
    if (error instanceof URIError) {
      // Decoding probably failed because of the percent character, try again
      return getSafeFilename(filename.replace("%", "_"));
    }
    throw error;
  }
}

/**
 * @typedef {import('sri4node')} TSri4Node
 * @typedef {import('sri4node').TSriConfig} TSriConfig
 * @typedef {import('sri4node').TPluginConfig} TPluginConfig
 * @typedef {import('sri4node').TSriRequest} TSriRequest
 * @typedef {import('sri4node').TSriConfig['resources'][0]['customRoutes'][0]} TCustomRoute
 * @typedef {import('sri4node').TNonStreamingCustomRoute} TNonStreamingCustomRoute
 * @typedef {import('sri4node').TStreamingCustomRoute} TStreamingCustomRoute
 * @typedef { import('sri4node').TSriServerInstance['db']} IDatabase
 * @typedef { {
 *  install: (sriConfig: TSriConfig, db: any) => void,
 *  [prop:string]: unknown,
 * } } TSri4NodePluginInstance
 * @typedef { {
 *    s3key: string,
 *    s3region: string,
 *    s3bucket: string,
 *    accessKeyId: string,
 *    s3secret: string,
 *    maxRetries?: number,
 *    maximumFilesizeInMB?: number,
 *    createBucketIfNotExists?: boolean,
 *    handleMultipleUploadsTogether?: boolean,
 *    uploadInSequence?: boolean,
 *    checkFileExistence?: boolean,
 *    security?: { plugin?: any, abilityPrepend: string, abilityAppend: string },
 * } } TSri4NodeAttachmentUtilsConfig
 *
 * @typedef { {
 *    customRouteForUpload: (
 *      runAfterUpload: (tx: IDatabase, sriRequest: TSriRequest, att: TMultiPartSingleBodyForFileUploadsWithFileObj) => void,
 *      getResourceForCopy: (href: string) => string
 *    ) => TCustomRoute,
 *    customRouteForUploadCopy: (
 *      runAfterUpload: (tx: IDatabase, sriRequest: TSriRequest, att: TMultiPartSingleBodyForFileUploadsWithFileObj) => void,
 *      getResourceForCopy: (href: string) => string
 *    ) => TCustomRoute,
 *    customRouteForPreSignedUpload: () => TCustomRoute,
 *    customRouteForDownload: () => TCustomRoute,
 *    customRouteForDelete: (
 *      getFileNameHandler: (tx: IDatabase, sriRequest: TSriRequest, resourceKey: string, attachmentKey: string) => Promise<string>,
 *      afterHandler: (tx: IDatabase, sriRequest: TSriRequest, resourceKey: string, attachmentKey: string) => void
 *    ) => TCustomRoute,
 *    customRouteForGet: (
 *      getAttJson: ( tx:any, sriRequest: TSriRequest, key: string, attachmentKey: string ) => Promise<{
 *        $$meta: {
 *          created: string,
 *          modified: string,
 *          permalink: string,
 *        }
 *        href: string;
 *        key: string;
 *        name: string;
 *        contentType: string;
 *        description: string;
 *      }>
 *    ) => TCustomRoute,
 * } } TSri4NodeAttachmentUtils
 */

/**
 *
 * @param {TSri4NodeAttachmentUtilsConfig} pluginConfig
 * @param {TSri4Node} sri4node
 * @returns { Promise<TSri4NodeAttachmentUtils> }
 */
async function sri4nodeAttachmentUtilsFactory(pluginConfig, sri4node) {
  // /** @type { import('sri4node').TDebugChannel } */
  const logChannel = "sri4node-attachments";

  // default configuration
  const fullPluginConfig = {
    endpoint: "http://localhost:4566/",
    s3key: "",
    s3secret: "",
    s3bucket: "",
    s3region: "eu-west-1",
    security: { plugin: undefined, abilityPrepend: "", abilityAppend: "" },
    maxRetries: 3,
    maximumFilesizeInMB: 10,
    createBucketIfNotExists: true,
    handleMultipleUploadsTogether: false,
    checkFileExistence: true,
    uploadInSequence: true, // ? right?
    ...pluginConfig,
  };

  function debug(s) {
    sri4node.debug("attachments", s);
  }

  function error(s) {
    sri4node.error("attachments", s);
  }

  // function log(s) {
  //   sri4node('attachments', s);
  // }

  /**
   * This method is stateful, as it will cache and return a previously existing client
   * @returns {S3.S3Client} awss3client
   */
  function getAWSS3Client() {
    if (!this.awss3client) {
      // if (fullPluginConfig.s3key && fullPluginConfig.s3secret) {
      this.awss3client = new S3.S3Client({
        endpoint: fullPluginConfig.endpoint, // essential to point to our localstack-on-docker
        apiVersion: "2006-03-01",
        region: fullPluginConfig.s3region,
        credentials: {
          accessKeyId: fullPluginConfig.s3key,
          secretAccessKey: fullPluginConfig.s3secret,
        },
        forcePathStyle: true, // IMPORTANT cfr. https://qubyte.codes/blog/tip-connecting-to-localstack-s3-using-the-javascript-aws-sdk-v3
      });
      // } else {
      //   this.awss3client = new S3.S3Client({
      //     apiVersion: "2006-03-01",
      //     region: fullPluginConfig.s3region,
      //     maxAttempts: fullPluginConfig.maxRetries,
      //   });
      // }
    }
    return this.awss3client;
  }

  /**
   * This method will send a HeadBucketCommand, and wioll return true if it works,
   * and false if any exception occurs.
   *
   * @param {*} bucket
   * @returns
   */
  async function checkBucket(bucket) {
    debug("checking if bucket exists");

    const params = { Bucket: bucket };

    try {
      const awss3 = getAWSS3Client();

      await awss3.send(new S3.HeadBucketCommand(params));
      return true;
    } catch (err) {
      debug(
        `[checkBucket] Checking if S3 bucket '${bucket}' exists failed with the following exception: ${err}`
      );
      return false;
    }
  }

  /**
   * This method will check if the S3 bucket exists.
   * If fullPluginConfig.createBucketIfNotExists it will try to create the bucket if it does not
   * exsist, otherwise only an error will be printed (which is kind of stupid, it should probably
   * throw an exception)
   *
   * @returns {Promise<void>}
   */
  async function checkOrCreateBucket() {
    const exists = await checkBucket(fullPluginConfig.s3bucket);
    if (!exists && !fullPluginConfig.createBucketIfNotExists) {
      error(`S3 Bucket ${fullPluginConfig.s3bucket} does not exist`);
      error(fullPluginConfig);
    }

    if (!exists && fullPluginConfig.createBucketIfNotExists) {
      debug("Creating new bucket");
      try {
        const awss3 = getAWSS3Client();
        const s3cmd = new S3.CreateBucketCommand({
          Bucket: fullPluginConfig.s3bucket,
          CreateBucketConfiguration: {
            LocationConstraint: fullPluginConfig.s3region,
          },
        });
        await awss3.send(s3cmd);
      } catch (ex) {
        error(`[checkOrCreateBucket] bucket creation failed with error: ${ex}`);
        debug(ex);
        throw ex;
      }
    }
  }

  /**
   *
   * @param {string} s3filename
   * @returns {Promise<S3.HeadObjectCommandOutput>}
   */
  async function headFromS3(s3filename) {
    debug(`get HEAD for ${s3filename}`);

    const params = { Bucket: fullPluginConfig.s3bucket, Key: s3filename };

    // debug(params);
    const awss3 = getAWSS3Client();
    return await awss3.send(new S3.HeadObjectCommand(params));
  }

  /**
   * Any error currently is silently discarded,
   * so if this method returns null, it mans there was a problem
   *
   * @param {string} s3filename
   * @returns {Promise<S3.HeadObjectCommandOutput>}
   */
  async function getFileMeta(s3filename) {
    let data = null;
    try {
      const result = await headFromS3(s3filename);
      data = result;
    } catch (err) {
      // silently discarded ?
      debug(
        `[getFileMeta] problem getting meta from S3 for ${s3filename}: ${err}`
      );
    }
    return data;
  }

  /**
   *
   * @param {import('stream').Readable} outstream
   * @param {string} filename
   * @returns {Promise<void>}
   * @rejects {number | Error} if S3.send gives reply with http status code, we return the statuscode; else the error instance
   */
  async function downloadFromS3(outstream, filename) {
    const { s3bucket } = fullPluginConfig;

    const params = {
      Bucket: s3bucket,
      Key: filename,
    };

    try {
      const head = await headFromS3(filename);
      if (head) {
        const awss3 = getAWSS3Client();

        const response = await awss3.send(new S3.GetObjectCommand(params));
        // const stream = awss3.getObject(params).createReadStream();

        // to be able to use transformToWebStream(), nodejs >= 18 is needed!
        //  --> currently use response.Body with incorrect typescript types
        // (see https://stackoverflow.com/a/67373050)
        // const stream = response.Body.transformToWebStream();
        const stream = response.Body;

        return new Promise((resolve, reject) => {
          // Also need to listen for close on outstream, to stop in case the request is aborted
          // at client-side before the end of the input stream (S3 file).
          outstream.on("close", () => {
            debug("[downloadFromS3] stream closed prematurely");
            reject(new Error("499 partial content"));
          });

          // @ts-ignore
          stream.on("error", (err) => {
            const msg = "[downloadFromS3] error while reading streaù";
            error(msg);
            error(err);
            reject(new Error(`500 ${msg}`));
          });
          // @ts-ignore
          stream.on("end", () => {
            debug("[downloadFromS3] Finished download of file.");
            resolve();
          });

          // @ts-ignore
          stream.pipe(outstream);
        });
      } else {
        debug(
          `[downloadFromS3] headFromS3 did not return any result, the file ${filename} does not seem to exist on S3`
        );
        throw new Error("404 Not found");
      }
    } catch (err) {
      error("[downloadFromS3] the download failed:");
      error(err);
      if (err.$metadata?.httpStatusCode) {
        throw err.$metadata.httpStatusCode;
      } else {
        throw err;
      }
    }
  }

  /**
   *
   * @param {string[]} filenames
   * @returns {Promise<void>}
   */
  async function deleteFromS3(filenames) {
    const awss3 = getAWSS3Client();

    // const objects = filenames.map((e) => ({ Key: e }));
    // const params = {
    //   Bucket: fullPluginConfig.s3bucket,
    //   Delete: {
    //     Objects: objects,
    //   },
    // };
    // const reponse = await awss3.send(new S3.DeleteObjectsCommand(params));

    // delete one-by-one because localstack seems to be unable to handle DeleteObjectsCommand with latest aws sdk
    for (const fn of filenames) {
      const response = await awss3.send(
        new S3.DeleteObjectCommand({
          Bucket: fullPluginConfig.s3bucket,
          Key: fn,
        })
      );
      console.log(response);
    }
  }

  /**
   * Function that returns the S3 filename given the object that is sent when using
   * the multipart form data for file uploads.
   *
   * @param {TMultiPartSingleBodyForFileUploadsWithFileObj} multiPartSingleBodyWithFileObj
   * @returns {string}
   */
  function getS3FileNameByMuliPartBody(multiPartSingleBodyWithFileObj) {
    return `${hrefToKey(multiPartSingleBodyWithFileObj.resource.href)}-${
      multiPartSingleBodyWithFileObj.fileObj.filename
    }`; /// get filename from json for upload
  }

  /**
   * Function that returns the S3 filename given the sriRequest object
   * and the attachment filename. (the resource key is needed from sriRequest)
   *
   *
   *
   * @param {TSriRequest} sriRequest
   * @param {string} filename
   * @returns {string}
   */
  function getS3FileNameBySriRequestAndAttachmentFilename(
    sriRequest,
    filename
  ) {
    // get name from the DB(the getFileName fn) for delete
    return `${sriRequest.params.key}-${filename}`;
  }

  /**
   * Function that returns the S3 filename given the attachment href.
   *
   * /myThings/<resourceKey>/attachments/<attachmentName>) will become
   * <resourceKey>-<attachmentName>
   *
   * @param {string} href
   * @returns {string}
   */
  function getS3FileNameByHref(href) {
    // for the copy
    const spl = href.split("/");
    const attInd = spl.indexOf("attachments");
    return `${spl[attInd - 1]}-${spl[attInd + 1]}`;
  }

  /**
   *
   * @param {Array<TMultiPartSingleBodyForFileUploadsWithFileObj>} files
   * @param {TSriRequest} sriRequest
   */
  async function checkExistence(files, sriRequest) {
    // eslint-disable-next-line no-restricted-syntax
    for (const fileWithJson of files) {
      // debug(params);
      const { fileObj } = fileWithJson;
      // eslint-disable-next-line no-await-in-loop
      const head = await getFileMeta(getS3FileNameByMuliPartBody(fileWithJson));
      // debug(head);

      if (
        head &&
        head.Metadata &&
        head.Metadata.attachmentkey !== fileWithJson.attachment.key
      ) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [
            {
              code: "file.already.exists",
              type: "ERROR",
              message: `${fileObj.filename} already exists for this resource. Filename has to be unique per resource. To overwrite provide the existing file key.`,
            },
          ],
        });
      }
    }
  }

  /**
   *
   * @param {string} filename
   * @returns {string}
   */
  function getTmpFilename(filename) {
    return `${uuidv4()}-${filename}.tmp`;
  }

  /**
   *
   * @param {string} destionationFileName
   * @param {string} sourceFileName
   * @param {string} attachmentKey
   * @returns {Promise<S3.CopyObjectCommandOutput>}
   */
  async function copyFile(destionationFileName, sourceFileName, attachmentKey) {
    const awss3 = getAWSS3Client();
    const params = {
      Bucket: fullPluginConfig.s3bucket,
      Key: destionationFileName,
      ACL: "bucket-owner-full-control",
      CopySource: encodeURI(`/${fullPluginConfig.s3bucket}/${sourceFileName}`),
      MetadataDirective: "REPLACE",
      TaggingDirective: "COPY",
      Metadata: { attachmentkey: attachmentKey },
    };

    return await awss3.send(new S3.CopyObjectCommand(params));

    // await new Promise((accept, reject) => {
    //   awss3.copyObject(params, (err, data) => {
    //     if (err) {
    //       // an error occurred
    //       // debug(err, err.stack)
    //       reject(err);
    //     } else {
    //       // debug(data); // successful response
    //       accept(data);
    //     }
    //   });
    // });
  }

  /**
   * Rename a file on S3
   *
   * @param {TMultiPartSingleBodyForFileUploadsWithFileObj} fileWithJson
   * @returns {Promise<void>}
   */
  async function renameFile(fileWithJson) {
    const { fileObj } = fileWithJson;
    const s3filename = getS3FileNameByMuliPartBody(fileWithJson);
    const { tmpFileName } = fileObj;
    debug(`Rename ${tmpFileName} to ${s3filename}`);

    await copyFile(s3filename, tmpFileName, fileWithJson.attachment.key);

    await deleteFromS3([tmpFileName]);
  }

  /**
   *
   * @param {import('stream').Readable} fileStream
   * @param {string} tmpFileName
   * @returns {Promise<S3.PutObjectCommandOutput>}
   */
  async function handleFileUpload(fileStream, tmpFileName) {
    const awss3 = getAWSS3Client();

    debug(`Uploading file ${tmpFileName}`);
    const params = {
      Bucket: fullPluginConfig.s3bucket,
      Key: tmpFileName,
      ACL: "bucket-owner-full-control",
      Body: fileStream,
    }; // , Metadata: { "attachmentkey": fileWithJson.attachment.key }

    return await awss3.send(new S3.PutObjectCommand(params));
  }

  /**
   *
   * @param {IDatabase} tx
   * @param {TSriRequest} sriRequest
   * @param {import('stream').Readable} stream
   * @param {boolean} isRetry
   */
  async function handleFileDownload(tx, sriRequest, stream, isRetry) {
    const { filename } = sriRequest.params;
    const safeFilename = getSafeFilename(filename);
    const remoteFilename = `${sriRequest.params.key}-${
      isRetry ? filename : safeFilename
    }`;
    try {
      await downloadFromS3(stream, remoteFilename);
    } catch (err) {
      if (err === 404) {
        if (isRetry || filename === safeFilename) {
          throw new sriRequest.SriError({
            status: 404,
            errors: [
              {
                code: "download.failed",
                type: "ERROR",
                message: `Unable to download file [${filename}]`,
              },
            ],
          });
        }
        // Retry with the original filename if there's a difference
        await handleFileDownload(tx, sriRequest, stream, true);
      } else {
        throw new sriRequest.SriError({
          status: 500,
          errors: [
            {
              code: "download.failed",
              type: "ERROR",
              message: "unable to download the file",
            },
          ],
        });
      }
    }
  }

  /**
   *
   * @param {TSriRequest} sriRequest
   * @param {string} filename
   * @returns {Promise<void>}
   */
  async function handleFileDelete(sriRequest, filename) {
    const remoteFilename = getS3FileNameBySriRequestAndAttachmentFilename(
      sriRequest,
      filename
    );
    debug(`Deleting file ${remoteFilename}`);
    try {
      await deleteFromS3([remoteFilename]);
    } catch (err) {
      error(`Unable to delete file [${remoteFilename}]`);
      error(err);
      throw new sriRequest.SriError({
        status: 500,
        errors: [
          {
            code: "delete.failed",
            type: "ERROR",
            message: `Unable to delete file [${remoteFilename}]`,
          },
        ],
      });
    }
  }

  /**
   *
   * @returns {Promise<S3PresignedPost.PresignedPost>}
   */
  async function getPreSigned() {
    debug("getting presigned post for s3");

    const awss3 = getAWSS3Client();

    return await S3PresignedPost.createPresignedPost(awss3, {
      Bucket: fullPluginConfig.s3bucket,
      Conditions: [["starts-with", "$key", "tmp"]],
      // some kind of random tmp key?
      Key: `tmp${Math.round(Math.random() * 9999999)}`,
    });

    // return new Promise((accept, reject) => {
    //   awss3.createPresignedPost(params, (err, data) => {
    //     if (err) {
    //       // an error occurred
    //       error(`Presigning post data encountered an error: ${err}`);
    //       reject(err);
    //     } else {
    //       debug(`The post data is: ${JSON.stringify(data)}`);
    //       accept(data);
    //     }
    //   });
    // });
  }

  /**
   * Calls the security server to verify if a specified ability is allowed on the specified attachments.
   * If the request is allowed by security, this function will return true. In case it is not allowed,
   * an SriError will be thrown by the security plugin (could be a 403 or a redirect to a login page).
   * @param {IDatabase} tx
   * @param {TSriRequest} sriRequest
   * @param {string} ability
   * @param {Set<string>} resources
   * @returns
   */
  async function checkSecurityForResources(tx, sriRequest, ability, resources) {
    if (!resources.size) {
      return;
    }

    // allow everything if no security plugin has been configured
    if (fullPluginConfig.security && fullPluginConfig.security.plugin) {
      const security = fullPluginConfig.security.plugin;
      let attAbility = ability;
      if (fullPluginConfig.security.abilityPrepend) {
        attAbility = fullPluginConfig.security.abilityPrepend + attAbility;
      }
      if (fullPluginConfig.security.abilityAppend) {
        attAbility += fullPluginConfig.security.abilityAppend;
      }
      const t = [...resources];
      await security.checkPermissionOnResourceList(
        tx,
        sriRequest,
        attAbility,
        t,
        undefined,
        true
      );
    }
  }

  /**
   * It checks through all the attachments in the bodyJson if they have a fileHref. If they do,
   * it will copy that existing file to the current attachment. If the fileHref is not present,
   * nothing will be done.
   *
   * I think this is both used in customRouteForUpload and customRouteForUploadCopy, because
   * then copies are also supported in the multi-part upload body? But if this is the case,
   * you could wonder why we also need a separate customRouteForUploadCopy?
   *
   * As in so many functions, this function will also return a modified version of the bodyJson.
   * And it can also throw an SriError, both when something is not rught with the data, but also
   * when the security check fails.
   *
   * @param {IDatabase} tx
   * @param {TSriRequest} sriRequest
   * @param {Array<TBodyForFileCopy>} toCopy
   * @param {(href: string) => string} getResourceHrefByAttachmentHref translates the href of the
   *    attachment to the resource href
   * @throws {SriError}
   * @returns {Promise<Array<TBodyForFileCopy>>}
   */
  async function copyAttachments(
    tx,
    sriRequest,
    toCopy,
    getResourceHrefByAttachmentHref
  ) {
    sriRequest.logDebug(logChannel, "copy attachments");
    const resources = new Set(
      toCopy.map((body) => getResourceHrefByAttachmentHref(body.fileHref))
    );

    /** @type { Array<TMultiPartSingleBodyForFileUploadsWithFileObj & TBodyForFileCopy> } */
    const toCopyWithFileObj = toCopy.map((body) => {
      const resourceHref = getResourceHrefByAttachmentHref(body.fileHref);
      resources.add(resourceHref);
      const filename = body.fileHref.split("/attachments/").pop();
      return {
        ...body,
        fileObj: {
          tmpFileName: getTmpFilename(filename),
          filename,
          mimetype: mime.contentType(filename),
        },
      };
    });

    // might throw an SriError!
    await checkSecurityForResources(tx, sriRequest, "read", resources);

    const promises = toCopy.map((body) =>
      getFileMeta(getS3FileNameByHref(body.fileHref))
    );
    const results = await Promise.all(promises);

    // Set meta fields and handle not found files
    const toCopyWithFileObjFiltered = toCopyWithFileObj.filter(
      (tcwfo, index) => {
        const meta = results[index];
        if (meta) {
          const fileObj = tcwfo.fileObj;
          fileObj.hash = meta.ETag;
          fileObj.size = meta.ContentLength;
          return true;
        }

        if (tcwfo.ignoreNotFound) {
          return false;
        }

        throw new sriRequest.SriError({
          status: 409,
          errors: [
            {
              code: "file.to.copy.not.found",
              type: "ERROR",
              message: "One or more of the files to copy can not be found",
            },
          ],
        });
      }
    );

    const copyPromises = toCopyWithFileObjFiltered.map((body) =>
      copyFile(
        body.fileObj.tmpFileName,
        getS3FileNameByHref(body.fileHref),
        body.attachment.key
      )
    );

    await Promise.all(copyPromises);

    // Remove the not found files from the bodyJson
    // return bodyJson.filter(
    //   (bj) => !bj.fileHref || toCopy.some((tc) => tc.fileHref === bj.fileHref)
    // );

    return toCopyWithFileObjFiltered;
  }

  /**
   * Calls checkSecurityForResources, which calls the security server to verify if a specified ability
   * is allowed on the specified attachments.
   * If the request is allowed by security, this function will return true. In case it is not allowed,
   * an SriError will be thrown by the security plugin (could be a 403 or a redirect to a login page).
   * @param {IDatabase} tx
   * @param {TSriRequest} sriRequest
   * @param {Array<TMultiPartSingleBodyForFileUploads>} bodyJson
   * @param {string} ability
   * @returns {Promise<true>}
   */
  async function checkSecurity(tx, sriRequest, bodyJson, ability) {
    const resources = new Set();
    if (bodyJson) {
      bodyJson.forEach((e) => {
        resources.add(e.resource.href);
      });
    } else {
      resources.add(`${sriRequest.sriType}/${sriRequest.params.key}`);
    }

    if (fullPluginConfig.security.plugin) {
      await checkSecurityForResources(tx, sriRequest, ability, resources);
    }
    return true;
  }

  /**
   * Will throw and SriError if the file is not present in the bodyJson.
   *
   * @param {TFileObj} file
   * @param {Array<TMultiPartSingleBodyForFileUploads>} bodyJson
   * @param {TSriRequest} sriRequest
   * @throws {SriError}
   */
  function checkBodyJsonForFile(file, bodyJson, sriRequest) {
    if (!bodyJson.some((e) => e.file === file.filename)) {
      throw new sriRequest.SriError({
        status: 409,
        errors: [
          {
            code: "body.incomplete",
            type: "ERROR",
            message: `${file.filename} needs an accompanying json object in the BODY array.`,
          },
        ],
      });
    }
  }

  /**
   * Given the 'body' part (an array) of the multipart post message,
   * this function will check if each of the files are present in the attachmentsRcvd.
   *
   * If all files are present, the function will return the bodyJson with the fileObj added to each.
   *
   * @param {Array<TMultiPartSingleBodyForFileUploads>} listOfUploadedFiles
   * @param {TSriRequest} sriRequest
   * @param {Array<TFileObj>} attachmentsRcvd
   * @throws {SriError}
   * @returns {Array<TMultiPartSingleBodyForFileUploads & {fileObj: TFileObj}>}
   */
  function checkFileForBodyJson(
    listOfUploadedFiles,
    sriRequest,
    attachmentsRcvd
  ) {
    // validate JSONs for each of the files
    return listOfUploadedFiles.map((att) => {
      if (att.file !== undefined && !att.fileHref) {
        const fileObj = attachmentsRcvd.find(
          (attf) => attf.filename === att.file
        );

        if (fileObj === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [
              {
                code: "missing.file",
                type: "ERROR",
                message: `file ${att.file} was expected but not found`,
              },
            ],
          });
        }
        return { ...att, fileObj };
      }
    });
  }

  /**
   * THIS FUNCTION DOES A FEW CHECKS and throw an SriError if something is wrong.
   * It validate the body part of the multipart post message for uploading files.
   *
   * @param {Array<TMultiPartSingleBodyForFileUploads>} bodyJson
   * @param {TSriRequest} sriRequest
   * @throws {SriError}
   * @returns {void}
   */
  function validateUploadMultipartBody(bodyJson, sriRequest) {
    if (bodyJson.some((e) => !e.attachment)) {
      throw new sriRequest.SriError({
        status: 400,
        errors: [
          {
            code: "missing.json.body.attachment",
            type: "ERROR",
            message: 'each json item needs an "attachment"',
          },
        ],
      });
    }

    if (bodyJson.some((e) => !e.attachment.key)) {
      throw new sriRequest.SriError({
        status: 400,
        errors: [
          {
            code: "missing.json.attachment.key",
            type: "ERROR",
            message: "each attachment json needs a key",
          },
        ],
      });
    }
    bodyJson.forEach((att) => {
      if (!att.resource || !att.resource.href) {
        throw new sriRequest.SriError({
          status: 400,
          errors: [
            {
              code: "missing.json.body.resource",
              type: "ERROR",
              message: "each attachment json needs a resource",
            },
          ],
        });
      }
    });
  }

  /**
   * THIS FUNCTION DOES A FEW CHECKS and throw an SriError if something is wrong.
   * It validate the body of the uploadCopy route.
   *
   * It has the same rules as the upload route, but it also checks if the fileHref is present.
   *
   * @param {Array<TBodyForFileCopy>} bodyJson
   * @param {TSriRequest} sriRequest
   * @throws {SriError}
   * @returns {void}
   */
  function validateUploadForCopyBody(bodyJson, sriRequest) {
    validateUploadMultipartBody(bodyJson, sriRequest);

    // and also check if the fileHref is present
    if (bodyJson.some((e) => !e.fileHref)) {
      throw new sriRequest.SriError({
        status: 400,
        errors: [
          {
            code: "missing.json.fileHref",
            type: "ERROR",
            message: "each json item needs a fileHref",
          },
        ],
      });
    }
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a POST /resource/attachments route.
   *  * This is a multipart post, where the 'body' part is a stringified and properly escaped
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
   * The 'data' part(s) is (are) a file, which is the actual contents of the uploaded file.
   * There must be as many data parts, as there are records in the body part array.
   * The 'data' part(s) must be in the same order as defined in the 'body' part.
   *
   * Here is an example of a multipart post message:
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
   * @param { (tx: IDatabase, sriRequest: TSriRequest, attachments: TMultiPartSingleBodyForFileUploadsWithFileObj) => void} runAfterUpload
   * @param {(href: string) => string} [getResourceForCopy] turns the href of the resource to copy the attachment from into the href of the resource to copy the attachment to
   * @returns {TCustomRoute}
   */
  function customRouteForUpload(runAfterUpload, getResourceForCopy) {
    return {
      routePostfix: "/attachments",
      httpMethods: ["POST"],
      readOnly: false,
      busBoy: true,

      /**
       * @param {IDatabase} tx
       * @param {TSriRequest} sriRequest
       * @param {import('stream').Readable} stream
       */
      streamingHandler: async (tx, sriRequest, stream, _internalUtils) => {
        /** @type {Array<TFileObj>} */
        const attachmentsRcvd = [];
        const fieldsRcvd = {};

        const tmpUploads = [];
        const failed = [];

        /**
         *
         * @param {TFileObj} fileObj
         * @returns
         */
        async function uploadTmpFile(fileObj) {
          sriRequest.logDebug(logChannel, "uploading tmp file");
          await handleFileUpload(fileObj.file, fileObj.tmpFileName);
          sriRequest.logDebug(
            logChannel,
            `upload to s3 done for ${fileObj.tmpFileName}`
          );

          const meta = await getFileMeta(fileObj.tmpFileName);
          fileObj.hash = meta.ETag;
          fileObj.size = meta.ContentLength;

          return fileObj;
        }

        sriRequest.busBoy.on(
          "file",
          async (fieldname, fileStream, { filename, encoding, mimeType }) => {
            const safeFilename = getSafeFilename(filename);

            sriRequest.logDebug(
              logChannel,
              `BUSBOY File [${fieldname}]: filename: ${safeFilename}, encoding: ${encoding}, mimetype: ${mimeType}`
            );

            /** @type {TFileObj} */
            const fileObj = {
              filename: safeFilename,
              originalFilename: filename,
              mimetype: mimeType,
              file: fileStream,
              fields: {},
            };

            fileObj.tmpFileName = getTmpFilename(safeFilename);

            tmpUploads.push(
              uploadTmpFile(fileObj)
                // .then((suc) => { })
                .catch((ex) => {
                  sriRequest.logDebug(logChannel, "uploadTmpFile failed");
                  sriRequest.logDebug(logChannel, ex);
                  failed.push(ex);
                })
            );

            attachmentsRcvd.push(fileObj);
          }
        );

        sriRequest.busBoy.on("field", (fieldname, val, _info) => {
          sriRequest.logDebug(
            logChannel,
            `BUSBOY Field [${fieldname}]: value: ${val}`
          );
          fieldsRcvd[fieldname] = val;
        });

        // wait until busboy is done
        await pEvent(sriRequest.busBoy, "close");
        sriRequest.logDebug(logChannel, "busBoy is done");

        await Promise.all(tmpUploads);
        sriRequest.logDebug(logChannel, "tmp uploads done");

        const bodyString = fieldsRcvd.body;
        let securityError;
        const renames = [];

        if (bodyString === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [
              {
                code: "missing.body",
                type: "ERROR",
                message: "Body is required.",
              },
            ],
          });
        }
        const bodyParsed = JSON.parse(bodyString);
        /** @type {Array<TMultiPartSingleBodyForFileUploads>} */
        const bodyArray = Array.isArray(bodyParsed) ? bodyParsed : [bodyParsed];

        validateUploadMultipartBody(bodyArray, sriRequest);

        /** @type {Array<TMultiPartSingleBodyForFileUploads | TBodyForFileCopy>} */
        const newBodyArray = bodyArray.map((b) => ({
          ...b,
          file: b.file ? getSafeFilename(b.file) : undefined,
          attachment: {
            ...b.attachment,
            name: b.attachment.name
              ? getSafeFilename(b.attachment.name)
              : undefined,
          },
        }));

        attachmentsRcvd.forEach((file) =>
          checkBodyJsonForFile(file, newBodyArray, sriRequest)
        );

        // MODIFYING THE ATTACHMENTSRCVD ARRAY (bad practices again) TODO: fix this code
        attachmentsRcvd.forEach((file) => {
          file.mimetype = mime.contentType(file.filename);
        });

        // if a getResourceForCopy function is provided, copy the attachments that need to be copied
        if (getResourceForCopy) {
          await copyAttachments(
            tx,
            sriRequest,
            newBodyArray.filter((e) => e.fileHref),
            getResourceForCopy
          );
        }

        const newBodyArrayWithFileObj = checkFileForBodyJson(
          newBodyArray,
          sriRequest,
          attachmentsRcvd
        );

        /**
         *
         * @param {TMultiPartSingleBodyForFileUploadsWithFileObj} att
         * @returns
         */
        async function handleTheFile(att) {
          await runAfterUpload(tx, sriRequest, att);
          return att;
        }

        if (fullPluginConfig.checkFileExistence) {
          await checkExistence(
            newBodyArrayWithFileObj.filter((e) => e.fileObj !== undefined),
            sriRequest
          );
        }

        // add uploads to the queue
        if (!fullPluginConfig.handleMultipleUploadsTogether) {
          if (fullPluginConfig.uploadInSequence) {
            // For example Persons Api which uses an sri4node as a proxy for its attachments files
            // should be sequentially uploaded
            for (const file of newBodyArrayWithFileObj) {
              // eslint-disable-next-line no-await-in-loop
              try {
                await handleTheFile(file);
              } catch (ex) {
                sriRequest.logDebug(logChannel, "handlefile failed");
                sriRequest.logDebug(logChannel, JSON.stringify(file, null, 2));
                sriRequest.logDebug(logChannel, ex);
                failed.push(ex);
              }
              debug("handleFile success");
            }
          } else {
            const uploadPromises = newBodyArrayWithFileObj.map((file) =>
              (async () => {
                try {
                  await handleTheFile(file);
                } catch (ex) {
                  sriRequest.logDebug(logChannel, "handlefile failed");
                  sriRequest.logDebug(
                    logChannel,
                    JSON.stringify(file, null, 2)
                  );
                  sriRequest.logDebug(logChannel, ex);
                  failed.push(ex);
                }
                debug("handleFile success");
              })()
            );
            await Promise.all(uploadPromises);
          }
        } else {
          try {
            // TODO: this is not working yet in my opinion, so we should add a test case for this
            // code path and fix the code !!!
            await handleTheFile(newBodyArrayWithFileObj);
            debug("handleFile success");
          } catch (ex) {
            sriRequest.logDebug(logChannel, "handlefile failed");
            sriRequest.logDebug(
              logChannel,
              JSON.stringify(newBodyArrayWithFileObj, null, 2)
            );
            sriRequest.logDebug(logChannel, ex);
            failed.push(ex);
          }
        }

        // }

        // now that we validated the json body resource requirement, we can finally check security
        try {
          await checkSecurity(tx, sriRequest, newBodyArray, "create");
        } catch (err) {
          securityError = err;
        }

        /// all files are now uploaded into their TMP versions.

        if (failed.length > 0 || securityError) {
          /// something failed. delete all tmp files
          /// delete attachments again
          sriRequest.logDebug(
            logChannel,
            "something went wrong during upload/afterupload"
          );
          // let s3client = createS3Client(configuration);

          const filenames = attachmentsRcvd
            .filter((e) => e.tmpFileName)
            .map((e) => e.tmpFileName);

          if (filenames.length) {
            try {
              await deleteFromS3(filenames);
              sriRequest.logDebug(
                logChannel,
                `${filenames.join(" & ")} deleted`
              );
            } catch (err) {
              sriRequest.logDebug(logChannel, "delete rollback failed");
              sriRequest.logDebug(logChannel, err);
            }
          }

          if (securityError) throw securityError;

          throw failed;
          // stream.push(failed);
        } else {
          /// all went well, rename the files to their real names now.
          newBodyArrayWithFileObj
            .filter((e) => e.file !== undefined)
            .forEach((file) => {
              renames.push(renameFile(file));
            });

          await Promise.all(renames);

          const response = [];
          newBodyArrayWithFileObj.forEach((file) => {
            response.push({
              status: 200,
              href: `${file.resource.href}/attachments/${file.attachment.key}`,
            });
          });
          stream.push(response);
        }
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a POST /resource/attachments/copy route.
   *
   * Creates a copy of attachments directly on S3 based on their attachment href to avoid
   * downloading and uploading attachments.
   *
   * [ used by activityplans-api and content-api when an activityplan or content item is copied ]
   *
   * The body of the request should be an array of objects or a single object with
   * the following structure (same as body in multipart upload but with fileHref property):
   * ```javascript
   *  {
   *    fileHref: "/things/1/attachments/profile1.png", // the url of the attachment to copy
   *    file: "profile1.png",
   *    attachment: {
   *      key: attachmentCopyKey1,
   *      description: `this is MY file with key ${attachmentCopyKey1}`,
   *    },
   *    resource: {
   *      href: resourceCopyHref,
   *    },
   *  },
   * ```
   *
   * @param { (tx: IDatabase, sriRequest: TSriRequest, att: TMultiPartSingleBodyForFileUploadsWithFileObj) => void } runAfterUpload
   * @param {(href: string) => string} [getResourceForCopy] turns the href of the resource to copy the attachment from into the href of the resource to copy the attachment to
   * @returns {TCustomRoute}
   */
  function customRouteForUploadCopy(runAfterUpload, getResourceForCopy) {
    return {
      routePostfix: "/attachments/copy",
      httpMethods: ["POST"],
      readOnly: false,

      /**
       *
       * @param {IDatabase} tx
       * @param {TSriRequest} sriRequest
       * @returns {Promise<import("sri4node").TSriResult>}
       */
      handler: async (tx, sriRequest, _customMapping, _internalUtils) => {
        const attachmentsRcvd = [];
        const fieldsRcvd = {};

        const failed = [];

        fieldsRcvd.body = sriRequest.body;

        if (fieldsRcvd.body === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [
              {
                code: "missing.body",
                type: "ERROR",
                message: "Body is required.",
              },
            ],
          });
        }

        /** @type { Array<TBodyForFileCopy> } */
        const bodyJsonArray = Array.isArray(fieldsRcvd.body)
          ? fieldsRcvd.body
          : [fieldsRcvd.body];

        let securityError;

        validateUploadForCopyBody(bodyJsonArray, sriRequest);

        if (!getResourceForCopy) {
          throw new sriRequest.SriError({
            sriRequestID: sriRequest.id,
            status: 500,
            errors: [{ code: "missing.getResourceForCopy", type: "ERROR" }],
          });
        }

        /** @type {Array<TBodyForFileCopy>} */
        const bodyJsonArrayWithFileObj = await copyAttachments(
          tx,
          sriRequest,
          bodyJsonArray,
          getResourceForCopy
        );

        // simply check and throw errors, don't assign to anything!!!
        checkFileForBodyJson(
          bodyJsonArrayWithFileObj,
          sriRequest,
          attachmentsRcvd
        );

        /**
         *
         * @param {TMultiPartSingleBodyForFileUploadsWithFileObj} att
         * @returns
         */
        async function handleTheFile(att) {
          // if (att.file)
          //   await handleFileUpload(att, sriRequest);
          await runAfterUpload(tx, sriRequest, att);
          // throw "damn";
          return att;
        }

        if (fullPluginConfig.checkFileExistence) {
          await checkExistence(
            bodyJsonArrayWithFileObj.filter((e) => e.fileObj !== undefined),
            sriRequest
          );
        }

        // add uploads to the queue
        if (!fullPluginConfig.handleMultipleUploadsTogether) {
          if (fullPluginConfig.uploadInSequence) {
            // For example Persons Api which uses an sri4node as a proxy for its attachments files
            // should be sequentially uploaded
            for (const file of bodyJsonArrayWithFileObj) {
              // eslint-disable-next-line no-await-in-loop
              try {
                await handleTheFile(file);
                debug("handleFile success");
              } catch (ex) {
                sriRequest.logDebug(logChannel, "handlefile failed");
                sriRequest.logDebug(logChannel, ex);
                failed.push(ex);
              }
            }
          } else {
            const uploads = bodyJsonArrayWithFileObj.map((file) =>
              handleTheFile(file)
                .then((_suc) => {
                  debug("handleFile success");
                })
                .catch((ex) => {
                  sriRequest.logDebug(logChannel, "handlefile failed");
                  sriRequest.logDebug(logChannel, ex);
                  failed.push(ex);
                })
            );
            await Promise.all(uploads);
          }
        } else {
          try {
            // TODO FIXME: add a test case for this code path, according to the typing,
            // the next line is not going to work
            await handleTheFile(bodyJsonArrayWithFileObj);
            debug("handleFile success");
          } catch (ex) {
            sriRequest.logDebug(logChannel, "handlefile failed");
            sriRequest.logDebug(logChannel, ex);
            failed.push(ex);
          }
        }

        // now that we validated the json body resource requirement, we can finally check security
        try {
          await checkSecurity(tx, sriRequest, bodyJsonArray, "create");
        } catch (err) {
          securityError = err;
        }

        /// all files are now uploaded into their TMP versions.

        if (failed.length > 0 || securityError) {
          /// something failed. delete all tmp files
          /// delete attachments again
          sriRequest.logDebug(
            logChannel,
            "something went wrong during upload/afterupload"
          );
          // let s3client = createS3Client(configuration);

          const filenames = attachmentsRcvd
            .filter((e) => e.tmpFileName)
            .map((e) => e.tmpFileName);

          if (filenames.length) {
            try {
              await deleteFromS3(filenames);
              sriRequest.logDebug(
                logChannel,
                `${filenames.join(" & ")} deleted`
              );
            } catch (err) {
              sriRequest.logDebug(logChannel, "delete rollback failed");
              sriRequest.logDebug(logChannel, err);
            }
          }

          if (securityError) throw securityError;

          throw failed;
          // stream.push(failed);
        } else {
          /// all went well, rename the files to their real names now.
          const renames = bodyJsonArrayWithFileObj
            .filter((e) => e.file !== undefined)
            .map((file) => renameFile(file));

          await Promise.all(renames);

          return {
            status: 200,
            body: bodyJsonArrayWithFileObj.map((file) => ({
              status: 200,
              href: `${file.resource.href}/attachments/${file.attachment.key}`,
            })),
          };
        }
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a GET
   * /resource/attachments/prsegignedupload route.
   * This is something specific to upload a file directly to S3 or something
   * (without proxying through the api server) by requesting some kind of token first
   * and then using that to be allowed to upload something directly to S3.
   *
   * [ Currently not used ]
   *
   * @returns {TCustomRoute}
   */
  function customRouteForPreSignedUpload() {
    return {
      routePostfix: "/attachments/presigned",
      httpMethods: ["GET"],
      readOnly: true,
      /**
       * @type { TNonStreamingCustomRoute['beforeHandler'] }
       */
      beforeHandler: async (
        _tx,
        _sriRequest,
        _customMapping,
        _internalUtils
      ) => {
        // await checkSecurity(tx, sriRequest, null, 'create');
      },
      /**
       * @type { TNonStreamingCustomRoute['handler'] }
       */
      handler: async (_tx, _sriRequest, _customMapping, _internalUtils) => {
        /// do the presigned request to s3
        const json = await getPreSigned();
        return {
          body: json,
          status: 200,
        };
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a GET
   * /resource/attachments/<filename> route to download an attachment.
   *
   * @returns {TCustomRoute}
   */
  function customRouteForDownload() {
    return {
      routePostfix: "/:key/attachments/:filename([^/]*.[A-Za-z0-9]{1,})",

      httpMethods: ["GET"],
      readOnly: true,
      binaryStream: true,

      /**
       * @type { TStreamingCustomRoute['beforeStreamingHandler'] }
       */
      beforeStreamingHandler: async (
        tx,
        sriRequest,
        _customMapping,
        _internalUtils
      ) => {
        await checkSecurity(tx, sriRequest, null, "read");
        sriRequest.logDebug(logChannel, sriRequest.params.filename);

        let contentType = "application/octet-stream";

        if (mime.lookup(sriRequest.params.filename)) {
          contentType = mime.lookup(sriRequest.params.filename);
        }

        return {
          status: 200,
          headers: [
            // was (deprecated) 'escape' instead of 'encodeURIComponent'
            [
              "Content-Disposition",
              `inline; filename="${encodeURIComponent(
                sriRequest.params.filename
              )}"`,
            ],
            ["Content-Type", contentType],
          ],
        };
      },
      /**
       * @type { TStreamingCustomRoute['streamingHandler'] }
       */
      streamingHandler: async (tx, sriRequest, stream, _internalUtils) => {
        await handleFileDownload(tx, sriRequest, stream, false);
        sriRequest.logDebug(logChannel, "streaming download done");
        return null;
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a DELETE
   * /resource/:key/attachments/:attachmentKey route to delete an attachment.
   *
   * @param {(tx: any, sriRequest: TSriRequest, resourceKey: string, attachmentKey: string) => Promise<string>} getFileNameHandler an (async) function that will return the right filename (can do a search on the database for example)
   * @param {any} afterHandler
   *
   * @returns {TCustomRoute}
   */
  function customRouteForDelete(getFileNameHandler, afterHandler) {
    return {
      routePostfix: "/:key/attachments/:attachmentKey",
      readOnly: false,
      httpMethods: ["DELETE"],
      /**
       * @type { TNonStreamingCustomRoute['beforeHandler'] }
       */
      beforeHandler: async (tx, sriRequest, _customMapping, _internalUtils) => {
        await checkSecurity(tx, sriRequest, null, "delete");
      },
      /**
       * @type { TNonStreamingCustomRoute['handler'] }
       */
      handler: async (tx, sriRequest, _customMapping, _internalUtils) => {
        const filename = await getFileNameHandler(
          tx,
          sriRequest,
          sriRequest.params.key,
          sriRequest.params.attachmentKey
        );
        await handleFileDelete(sriRequest, filename);
        return {
          status: 204,
        };
      },
      afterHandler: async (tx, sriRequest, _customMapping, _internalUtils) => {
        await afterHandler(
          tx,
          sriRequest,
          sriRequest.params.key,
          sriRequest.params.attachmentKey
        );
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a GET
   * /resource/:key/attachments/:attachmentKey route to get an attachment.
   *
   * @param { ( tx:any, sriRequest: TSriRequest, key: string, attachmentKey: string )
   *   => string } getAttJson
   * @returns {TCustomRoute}
   */
  function customRouteForGet(getAttJson) {
    return {
      routePostfix: "/:key/attachments/:attachmentKey",
      httpMethods: ["GET"],
      readOnly: true,
      beforeHandler: async (tx, sriRequest, _customMapping, _internalUtils) => {
        await checkSecurity(tx, sriRequest, null, "read");
      },
      handler: async (tx, sriRequest, _customMapping, _internalUtils) => ({
        body: await getAttJson(
          tx,
          sriRequest,
          sriRequest.params.key,
          sriRequest.params.attachmentKey
        ),
        status: 200,
      }),
    };
  }

  // FIRST CHECK IF THE BUCKET EXISTS, otherwise it makes no sense to return an instance
  // of the utils if we are going to get in trouble later on
  await checkOrCreateBucket();

  // RETURN AN OBJECT CONTAINING UTILITY FUNCTIONS
  return {
    customRouteForUpload,
    customRouteForUploadCopy,
    customRouteForPreSignedUpload,
    customRouteForDownload,
    customRouteForDelete,
    customRouteForGet,
  };
}

module.exports = {
  sri4nodeAttchmentUtilsFactory: sri4nodeAttachmentUtilsFactory,
};
