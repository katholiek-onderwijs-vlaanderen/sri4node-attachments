// const streams = require('memory-streams');
const pEvent = require('p-event');
const S3 = require('aws-sdk/clients/s3');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');

/**
 * Cleans up a filename before uploading it to S3.
 * First it is decoded in case it contains any encoded characters (eg %21 -> !).
 * Then any special characters are replaced according to these guidelines: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
 * @param {String} filename
 */
function getSafeFilename(filename) {
  try {
    const decodedFilename = decodeURIComponent(filename);
    return decodedFilename.replace(/[^a-zA-Z0-9\-!_.*'()]/g, '_');
  } catch (error) {
    if (error instanceof URIError) {
      // Decoding probably failed because of the percent character, try again
      return getSafeFilename(filename.replace('%', '_'));
    }
    throw error;
  }
}

/**
 * @typedef {import('sri4node')} TSri4Node
 * @typedef {import('sri4node').TSriConfig} TSriConfig
 * @typedef {import('sri4node').TPluginConfig} TPluginConfig
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
 *    security?: { plugin?: unknown, abilityPrepend: string, abilityAppend: string },
 * } } TSri4NodeAttachmentUtilsConfig
 *
 */

/**
 *
 * @param {TSri4NodeAttachmentUtilsConfig} pluginConfig
 * @param {TSri4Node} sri4node
 * @returns { Promise<{
 *  unknown
 * }> }
 */
async function sri4nodeAttchmentUtilsFactory(pluginConfig, sri4node) {
  // default configuration
  const fullPluginConfig = {
    s3key: '',
    s3secret: '',
    s3bucket: '',
    s3region: 'eu-west-1',
    security: { plugin: undefined, abilityPrepend: '', abilityAppend: '' },
    maxRetries: 3,
    maximumFilesizeInMB: 10,
    createBucketIfNotExists: false,
    handleMultipleUploadsTogether: false,
    checkFileExistence: true,
    uploadInSequence: true, // ? right?
    ...pluginConfig,
  };

  function debug(s) {
    sri4node.debug('attachments', s);
  }

  function error(s) {
    sri4node.error('attachments', s);
  }

  // function log(s) {
  //   sri4node('attachments', s);
  // }

  /**
   * This method is stateful, as it will cache and return a previously existing client
   * @returns {any} awss3client
   */
  function getAWSS3Client() {
    if (!this.awss3client) {
      if (fullPluginConfig.s3key && fullPluginConfig.s3secret) {
        this.awss3client = new S3({
          apiVersion: '2006-03-01',
          accessKeyId: fullPluginConfig.s3key,
          secretAccessKey: fullPluginConfig.s3secret,
          region: fullPluginConfig.s3region,
          maxRetries: fullPluginConfig.maxRetries,
        });
      } else {
        this.awss3client = new S3({
          apiVersion: '2006-03-01',
          region: fullPluginConfig.s3region,
          maxRetries: fullPluginConfig.maxRetries,
        });
      }
    }
  }

  async function checkBucket(bucket) {
    debug('checking if bucket exists');

    const params = { Bucket: bucket };

    try {
      await new Promise((accept, reject) => {
        const awss3 = getAWSS3Client();
        awss3.headBucket(params, (err, data) => {
          if (err) { // an error occurred
            // debug(err)
            reject(err);
          } else {
            // debug(data); // successful response
            accept(data);
          }
        });
      });
      return true;
    } catch (ex) {
      return false;
    }
  }

  async function checkOrCreateBucket() {
    const exists = await checkBucket(fullPluginConfig.s3bucket);
    if (!exists && !fullPluginConfig.createBucketIfNotExists) {
      error(`S3 Bucket ${fullPluginConfig.s3bucket} does not exist`);
      error(fullPluginConfig);
    }

    if (!exists && fullPluginConfig.createBucketIfNotExists) {
      debug('Creating new bucket');

      const params = {
        Bucket: fullPluginConfig.s3bucket,
        ACL: 'private',
        CreateBucketConfiguration: {
          LocationConstraint: fullPluginConfig.s3region,
        },
      };

      try {
        await new Promise((accept, reject) => {
          const awss3 = getAWSS3Client();
          awss3.createBucket(params, (err, data) => {
            if (err) { // an error occurred
              debug(`${err}: ${err.stack}`);
              reject(err);
            } else {
              // debug(data); // successful response
              accept(data);
            }
          });
        });
      } catch (ex) {
        error('bucket creation failed');
        debug(ex);
      }
    }
  }

  async function headFromS3(s3filename) {
    debug(`get HEAD for ${s3filename}`);

    const params = { Bucket: fullPluginConfig.s3bucket, Key: s3filename };

    // debug(params);
    return new Promise((accept, reject) => {
      const awss3 = getAWSS3Client();
      awss3.headObject(params, (err, data) => {
        if (err) { // an error occurred
          reject(err);
        } else {
          // debug(data); // successful response

          accept(data);
        }
      });
    });
  }

  /**
   * Any error currently is silently discarded,
   * so if thois method returns null, it mans there was a problem
   */
  async function getFileMeta(s3filename) {
    let data = null;
    try {
      const result = await headFromS3(s3filename);
      data = result;
    } catch (err) {
      // silently discarded ?
      debug(`[getFileMeta] problem getting meta from S3 for ${s3filename}: ${err}`);
    }
    return data;
  }

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
        const stream = awss3
          .getObject(params)
          .createReadStream();

        // stream = s3client.downloadStream(params);
        stream.pipe(outstream);
        stream.on('error', (err) => {
          const msg = '[downloadFromS3] error while reading streaù';
          error(msg);
          error(err);
          throw new Error(`500 ${msg}`);
        });
        stream.on('end', () => {
          debug('[downloadFromS3] Finished download of file.');
          return 200;
        });
        // Also need to listen for close on outstream, to stop in case the request is aborted
        // at client-side before the end of the input stream (S3 file).
        outstream.on('close', () => {
          debug('[downloadFromS3] stream closed prematurely');
          throw new Error('499 partial content');
        });
      } else {
        debug(`[downloadFromS3] headFromS3 did not return any result, the file ${filename} does not seem to exist on S3`);
        throw new Error('404 Not found');
      }
    } catch (err) {
      err('[downloadFromS3] the download failed', err);
      throw new Error('500 internal server error');
    }
  }

  async function deleteFromS3(filenames) {
    const objects = filenames.map((e) => ({ Key: e }));

    const params = {
      Bucket: fullPluginConfig.s3bucket,
      Delete: {
        Objects: objects,
      },
    };

    await new Promise((accept, reject) => {
      const awss3 = getAWSS3Client();
      awss3.deleteObjects(params, (err, data) => {
        if (err) { // an error occurred
          // debug(err, err.stack)
          reject(err);
        } else {
          // debug(data); // successful response
          accept(data);
        }
      });
    });
  }

  function getS3FileName(sriRequest, file, filename, href) {
    let name;
    if (file) {
      name = `${file.resource.key}-${file.file.filename}`; /// get filename from json for upload
    } else if (filename) {
      name = `${sriRequest.params.key}-${filename}`; // get name from the DB(the getFileName fn) for delete
    } else if (href) { // for the copy
      const spl = href.split('/');
      const attInd = spl.indexOf('attachments');
      name = `${spl[attInd - 1]}-${spl[attInd + 1]}`;
    }
    return name;
  }

  async function checkExistence(files, sriRequest) {
    for (const fileWithJson of files) {
      // debug(params);
      const { file } = fileWithJson;
      const head = await getFileMeta(getS3FileName(sriRequest, fileWithJson));
      // debug(head);

      if (head && head.Metadata && head.Metadata.attachmentkey !== fileWithJson.attachment.key) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'file.already.exists',
            type: 'ERROR',
            message: `${file.filename} already exists for this resource. Filename has to be unique per resource. To overwrite provide the existing file key.`,
          }],
        });
      }
    }
  }

  function getTmpFilename(filename) {
    return `${uuidv4()}-${filename}.tmp`;
  }

  async function copyFile(destionationFileName, sourceFileName, attachmentKey) {
    const params = {
      Bucket: fullPluginConfig.s3bucket,
      Key: destionationFileName,
      ACL: 'bucket-owner-full-control',
      CopySource: encodeURI(`/${fullPluginConfig.s3bucket}/${sourceFileName}`),
      MetadataDirective: 'REPLACE',
      TaggingDirective: 'COPY',
      Metadata: { attachmentkey: attachmentKey },
    };

    await new Promise((accept, reject) => {
      const awss3 = getAWSS3Client();
      awss3.copyObject(params, (err, data) => {
        if (err) { // an error occurred
          // debug(err, err.stack)
          reject(err);
        } else {
          // debug(data); // successful response
          accept(data);
        }
      });
    });
  }

  async function renameFile(fileWithJson) {
    const { file } = fileWithJson;
    const s3filename = getS3FileName(null, fileWithJson);
    const { tmpFileName } = file;
    debug(`Rename ${tmpFileName} to ${s3filename}`);

    await copyFile(s3filename, tmpFileName, fileWithJson.attachment.key);

    await deleteFromS3([tmpFileName]);
  }

  async function handleFileUpload(fileStream, tmpFileName) {
    const awss3 = getAWSS3Client();

    debug(`Uploading file ${tmpFileName}`);
    const params = {
      Bucket: fullPluginConfig.s3bucket, Key: tmpFileName, ACL: 'bucket-owner-full-control', Body: fileStream,
    }; // , Metadata: { "attachmentkey": fileWithJson.attachment.key }

    await new Promise((accept, reject) => {
      awss3.upload(params, (err, data) => {
        if (err) { // an error occurred
          // console.log(err, err.stack)
          reject(err);
        } else {
          // console.log(data); // successful response
          accept(data);
        }
      });
    });
  }

  async function handleFileDownload(tx, sriRequest, stream, isRetry) {
    const { filename } = sriRequest.params;
    const safeFilename = getSafeFilename(filename);
    const remoteFilename = `${sriRequest.params.key}-${isRetry ? filename : safeFilename}`;
    try {
      await downloadFromS3(stream, remoteFilename);
    } catch (err) {
      if (err === 404) {
        if (isRetry || filename === safeFilename) {
          throw new sriRequest.SriError({
            status: 404,
          });
        }
        // Retry with the original filename if there's a difference
        await handleFileDownload(tx, sriRequest, stream, true);
      } else {
        throw new sriRequest.SriError({
          status: 500,
          errors: [{
            code: 'download.failed',
            type: 'ERROR',
            message: 'unable to download the file',
          }],
        });
      }
    }
  }

  async function handleFileDelete(tx, sriRequest, filename) {
    const remoteFilename = getS3FileName(sriRequest, null, filename);
    debug(`Deleting file ${remoteFilename}`);
    try {
      await deleteFromS3([remoteFilename]);
      return { status: 204 };
    } catch (err) {
      error(`Unable to delete file [${remoteFilename}]`);
      error(err);
      throw new sriRequest.SriError({
        status: 500,
        errors: [{
          code: 'delete.failed',
          type: 'ERROR',
          message: `Unable to delete file [${remoteFilename}]`,
        }],
      });
    }
  }

  async function getPreSigned() {
    debug('getting presigned post for s3');

    const awss3 = getAWSS3Client();

    const params = {
      Bucket: fullPluginConfig.s3bucket,
      Conditions: [['starts-with', '$key', 'tmp']],
    };

    return new Promise((accept, reject) => {
      awss3.createPresignedPost(params, (err, data) => {
        if (err) { // an error occurred
          error(`Presigning post data encountered an error: ${err}`);
          reject(err);
        } else {
          debug(`The post data is: ${JSON.stringify(data)}`);
          accept(data);
        }
      });

    // return new Promise((accept, reject) => {
    //   awss3.createPresignedPost(params, (err, data) => {
    //     if (err) { // an error occurred
    //       // debug(err, err.stack)
    //       error('Presigning post data encountered an error', err);
    //       reject(err);
    //     } else {
    //       // debug(data); // successful response
    //       debug('The post data is', data);
    //       accept(data);
    //     }
    //   });
    });
  }

  async function checkSecurityForResources(tx, sriRequest, ability, resources) {
    if (!resources.size) {
      return;
    }

    // allow everything if no security plugin has been configured
    if (fullPluginConfig.security) {
      const security = fullPluginConfig.security.plugin;
      let attAbility = ability;
      if (fullPluginConfig.security.abilityPrepend) {
        attAbility = fullPluginConfig.security.abilityPrepend + attAbility;
      }
      if (fullPluginConfig.security.abilityAppend) {
        attAbility += fullPluginConfig.security.abilityAppend;
      }
      const t = [...resources];
      await security.checkPermissionOnResourceList(tx, sriRequest, attAbility, t, undefined, true);
    }
  }

  async function copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy) {
    let toCopy = bodyJson.filter((e) => e.fileHref);
    if (!toCopy.length) { return bodyJson; }

    sriRequest.logDebug('copy attachments');
    const resources = new Set();

    toCopy.forEach((body) => {
      const resourceHref = getResourceForCopy(body.fileHref);
      resources.add(resourceHref);
      const filename = body.fileHref.split('/attachments/').pop();
      body.file = {
        tmpFileName: getTmpFilename(filename),
        filename,
        mimetype: mime.contentType(filename),
      };
    });

    await checkSecurityForResources(tx, sriRequest, 'read', resources);

    const promises = [];

    toCopy.forEach((body) => {
      promises.push(getFileMeta(getS3FileName(undefined, undefined, undefined, body.fileHref)));
    });

    const results = await Promise.all(promises);

    // Set meta fields and handle not found files
    toCopy = toCopy.filter((tc, index) => {
      const meta = results[index];
      if (meta) {
        const fileObj = tc.file;
        fileObj.hash = meta.ETag;
        fileObj.size = meta.ContentLength;
        return true;
      }

      if (tc.ignoreNotFound) {
        return false;
      }

      throw new sriRequest.SriError({
        status: 409,
        errors: [{
          code: 'file.to.copy.not.found',
          type: 'ERROR',
          message: 'One or more of the files to copy can not be found',
        }],
      });
    });

    toCopy.forEach((body) => {
      promises.push(
        copyFile(
          body.file.tmpFileName,
          getS3FileName(undefined, undefined, undefined, body.fileHref),
          body.attachment.key,
        ),
      );
    });

    await Promise.all(promises);

    // Remove the not found files from the bodyJson
    return bodyJson.filter(
      (bj) => !bj.fileHref || toCopy.some((tc) => tc.fileHref === bj.fileHref),
    );
  }

  async function checkSecurity(tx, sriRequest, bodyJson, ability) {
    const resources = new Set();
    if (bodyJson) {
      bodyJson.forEach((e) => { resources.add(e.resource.href); });
    } else {
      resources.add(`${sriRequest.sriType}/${sriRequest.params.key}`);
    }

    if (fullPluginConfig.security.plugin) {
      await checkSecurityForResources(tx, sriRequest, ability, resources);
    }
    return true;
  }

  function checkBodyJsonForFile(file, bodyJson, sriRequest) {
    if (!bodyJson.some((e) => e.file === file.filename)) {
      throw new sriRequest.SriError({
        status: 409,
        errors: [{
          code: 'body.incomplete',
          type: 'ERROR',
          message: `${file.filename} needs an accompanying json object in the BODY array.`,
        }],
      });
    }
  }

  /**
   * BEWARE: THIS FUNCTION MODIFIES the bodyJson parameter !!!
   *
   * @param {*} bodyJson
   * @param {*} sriRequest
   * @param {*} attachmentsRcvd
   */
  function checkFileForBodyJson(bodyJson, sriRequest, attachmentsRcvd) {
    // validate JSONs for each of the files
    bodyJson.forEach((att) => {
      if (att.file !== undefined && !att.fileHref) {
        att.file = attachmentsRcvd.find((attf) => attf.filename === att.file);

        if (att.file === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'missing.file',
              type: 'ERROR',
              message: `file ${att.file} was expected but not found`,
            }],
          });
        }
      }
    });
  }

  function validateRequestData(bodyJson, sriRequest) {
    if (bodyJson.some((e) => !e.attachment)) {
      throw new sriRequest.SriError({
        status: 409,
        errors: [{
          code: 'missing.json.body.attachment',
          type: 'ERROR',
          message: 'each json item needs an "attachment"',
        }],
      });
    }

    if (bodyJson.some((e) => !e.attachment.key)) {
      throw new sriRequest.SriError({
        status: 409,
        errors: [{
          code: 'missing.json.attachment.key',
          type: 'ERROR',
          message: 'each attachment json needs a key',
        }],
      });
    }

    bodyJson.forEach((att) => {
      if (!att.resource || !att.resource.href) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'missing.json.body.resource',
            type: 'ERROR',
            message: 'each attachment json needs a resource',
          }],
        });
      } else {
        const chuncks = att.resource.href.split('/');
        att.resource.key = chuncks[chuncks.length - 1];
      }
    });
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a POST /resource/attachments route.
   *
   * @param {*} runAfterUpload
   * @param {*} getResourceForCopy
   * @returns
   */
  function customRouteForUpload(runAfterUpload, getResourceForCopy) {
    return {
      routePostfix: '/attachments',
      httpMethods: ['POST'],
      readOnly: false,
      busBoy: true,

      beforeStreamingHandler: async (_tx, _sriRequest, _customMapping) => {

      },
      streamingHandler: async (tx, sriRequest, stream) => {
        const attachmentsRcvd = [];
        const fieldsRcvd = {};

        const tmpUploads = [];
        const failed = [];

        async function uploadTmpFile(fileObj) {
          sriRequest.logDebug('uploading tmp file');
          await handleFileUpload(fileObj.file, fileObj.tmpFileName);
          sriRequest.logDebug(`upload to s3 done for ${fileObj.tmpFileName}`);

          const meta = await getFileMeta(fileObj.tmpFileName);
          fileObj.hash = meta.ETag;
          fileObj.size = meta.ContentLength;

          return fileObj;
        };

        sriRequest.busBoy.on(
          'file',
          async (fieldname, file, filename, encoding, mimetype) => {
            const safeFilename = getSafeFilename(filename);

            sriRequest.logDebug(`File [${fieldname}]: filename: ${safeFilename}, encoding: ${encoding}, mimetype: ${mimetype}`);

            const fileObj = {
              filename: safeFilename,
              originalFilename: filename,
              mimetype,
              file,
              fields: {},
            };

            fileObj.tmpFileName = getTmpFilename(safeFilename);

            tmpUploads.push(
              uploadTmpFile(fileObj)
                // .then((suc) => { })
                .catch((ex) => {
                  sriRequest.logDebug('uploadTmpFile failed');
                  sriRequest.logDebug(ex);
                  failed.push(ex);
                }),
            );

            attachmentsRcvd.push(fileObj);
          },
        );

        sriRequest.busBoy.on('field', (fieldname, val, _fieldnameTruncated, _valTruncated, _encoding, _mimetype) => {
          sriRequest.logDebug(`Field [${fieldname}]: value: ${val}`);
          fieldsRcvd[fieldname] = val;
        });

        // wait until busboy is done
        await pEvent(sriRequest.busBoy, 'finish');
        sriRequest.logDebug('busBoy is done'); // , attachmentsRcvd)

        await Promise.all(tmpUploads);
        sriRequest.logDebug('tmp uploads done');

        const bodyString = fieldsRcvd.body;
        let securityError;
        const renames = [];

        if (bodyString === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'missing.body',
              type: 'ERROR',
              message: 'Body is required.',
            }],
          });
        }
        const bodyParsed = JSON.parse(bodyString);
        const bodyArray = Array.isArray(bodyParsed) ? [bodyParsed] : bodyParsed;

        validateRequestData(bodyArray, sriRequest);

        // Filename: replace special characters with underscore
        // bodyArray.forEach((b) => {
        //   if (b.file) {
        //     b.file = getSafeFilename(b.file);
        //   }
        //   if (b.attachment.name) {
        //     b.attachment.name = getSafeFilename(b.attachment.name);
        //   }
        // });

        const newBodyArray = bodyArray.map((b) => {
          const newB = { ...b };
          if (newB.file) {
            newB.file = getSafeFilename(b.file);
          }
          if (newB.attachment.name) {
            newB.attachment.name = getSafeFilename(b.attachment.name);
          }
          return newB;
        });

        attachmentsRcvd
          .forEach((file) => checkBodyJsonForFile(file, newBodyArray, sriRequest));

        attachmentsRcvd
          .forEach((file) => { file.mimetype = mime.contentType(file.filename); });

        if (getResourceForCopy) {
          bodyParsed = await copyAttachments(tx, sriRequest, newBodyArray, getResourceForCopy);
        }

        checkFileForBodyJson(newBodyArray, sriRequest, attachmentsRcvd);

        async function handleTheFile(att) {
          // if (att.file)
          //   await handleFileUpload(att, sriRequest);
          await runAfterUpload(tx, sriRequest, att);
          // throw "damn";
          return att;
        };

        if (fullPluginConfig.checkFileExistence) {
          await checkExistence(newBodyArray.filter((e) => e.file !== undefined), sriRequest);
        }

        // add uploads to the queue
        if (!fullPluginConfig.handleMultipleUploadsTogether) {
          if (fullPluginConfig.uploadInSequence) {
            // For example Persons Api which uses an sri4node as a proxy for its attachments files should be sequentially uploaded
            for (const file of newBodyArray) {
              await handleTheFile(file)
                .then((_suc) => {
                  debug('handleFile success');
                })
                .catch((ex) => {
                  sriRequest.logDebug('handlefile failed');
                  sriRequest.logDebug(ex);
                  failed.push(ex);
                });
            }
          } else {
            const uploads = [];

            newBodyArray.forEach((file) => {
              uploads.push(
                handleTheFile(file)
                  .then((_suc) => {
                    debug('handleFile success');
                  })
                  .catch((ex) => {
                    sriRequest.logDebug('handlefile failed');
                    sriRequest.logDebug(ex);
                    failed.push(ex);
                  }),
              );
            });
            await Promise.all(uploads);
          }
        } else {
          await handleTheFile(newBodyArray)
            .then((_suc) => {
              debug('handleFile success');
            })
            .catch((ex) => {
              sriRequest.logDebug('handlefile failed');
              sriRequest.logDebug(ex);
              failed.push(ex);
            });
        }

        // }

        // now that we validated the json body resource requirement, we can finally check security
        try {
          await checkSecurity(tx, sriRequest, newBodyArray, 'create');
        } catch (err) {
          securityError = err;
        }

        /// all files are now uploaded into their TMP versions.

        if (failed.length > 0 || securityError) { /// something failed. delete all tmp files
          /// delete attachments again
          sriRequest.logDebug('something went wrong during upload/afterupload');
          // let s3client = createS3Client(configuration);

          const filenames = attachmentsRcvd.filter((e) => e.tmpFileName).map((e) => e.tmpFileName);

          if (filenames.length) {
            try {
              await deleteFromS3(filenames);
              sriRequest.logDebug(`${filenames.join(' & ')} deleted`);
            } catch (err) {
              sriRequest.logDebug('delete rollback failed');
              sriRequest.logDebug(err);
            }
          }

          if (securityError) throw securityError;

          throw failed;
          // stream.push(failed);
        } else {
          /// all went well, rename the files to their real names now.
          newBodyArray.filter((e) => e.file !== undefined).forEach((file) => {
            renames.push(
              renameFile(file),
            );
          });

          await Promise.all(renames);

          const response = [];
          newBodyArray.forEach((file) => {
            response.push({ status: 200, href: `${file.resource.href}/attachments/${file.attachment.key}` });
          });
          stream.push(response);
          // stream.push('OK');
        }
      },
    };
  }

  /**
   * A function that will generate a json object that can be used in
   * sriConfig.resources.*.customRoutes in order to add a POST /resource/attachments/copy route.
   *
   * @param {*} runAfterUpload
   * @param {*} getResourceForCopy
   * @returns
   */
  function customRouteForUploadCopy(runAfterUpload, getResourceForCopy) {
    return {
      routePostfix: '/attachments/copy',
      httpMethods: ['POST'],
      readOnly: false,

      handler: async (tx, sriRequest) => {
        const attachmentsRcvd = [];
        const fieldsRcvd = {};

        const failed = [];

        fieldsRcvd.body = sriRequest.body;

        let bodyJson = fieldsRcvd.body;

        if (bodyJson === undefined) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'missing.body',
              type: 'ERROR',
              message: 'Body is required.',
            }],
          });
        } else if (!Array.isArray(bodyJson)) bodyJson = [bodyJson];

        let securityError;
        const renames = [];

        validateRequestData(bodyJson, sriRequest);

        if (getResourceForCopy) {
          bodyJson = await copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy);
        }

        checkFileForBodyJson(bodyJson, sriRequest, attachmentsRcvd);

        async function handleTheFile(att) {
          // if (att.file)
          //   await handleFileUpload(att, sriRequest);
          await runAfterUpload(tx, sriRequest, att);
          // throw "damn";
          return att;
        };

        if (fullPluginConfig.checkFileExistence) {
          await checkExistence(bodyJson.filter((e) => e.file !== undefined), sriRequest);
        }

        // add uploads to the queue
        if (!fullPluginConfig.handleMultipleUploadsTogether) {
          if (fullPluginConfig.uploadInSequence) {
            // For example Persons Api which uses an sri4node as a proxy for its attachments files should be sequentially uploaded
            for (const file of bodyJson) {
              await handleTheFile(file)
                .then((_suc) => {
                  debug('handleFile success');
                })
                .catch((ex) => {
                  sriRequest.logDebug('handlefile failed');
                  sriRequest.logDebug(ex);
                  failed.push(ex);
                });
            }
          } else {
            const uploads = [];

            bodyJson.forEach((file) => {
              uploads.push(
                handleTheFile(file)
                  .then((_suc) => {
                    debug('handleFile success');
                  })
                  .catch((ex) => {
                    sriRequest.logDebug('handlefile failed');
                    sriRequest.logDebug(ex);
                    failed.push(ex);
                  }),
              );
            });
            await Promise.all(uploads);
          }
        } else {
          await handleTheFile(bodyJson)
            .then((_suc) => {
              debug('handleFile success');
            })
            .catch((ex) => {
              sriRequest.logDebug('handlefile failed');
              sriRequest.logDebug(ex);
              failed.push(ex);
            });
        }

        // }

        // now that we validated the json body resource requirement, we can finally check security
        try {
          await checkSecurity(tx, sriRequest, bodyJson, 'create');
        } catch (err) {
          securityError = err;
        }

        /// all files are now uploaded into their TMP versions.

        if (failed.length > 0 || securityError) { /// something failed. delete all tmp files
          /// delete attachments again
          sriRequest.logDebug('something went wrong during upload/afterupload');
          // let s3client = createS3Client(configuration);

          const filenames = attachmentsRcvd.filter((e) => e.tmpFileName).map((e) => e.tmpFileName);

          if (filenames.length) {
            try {
              await deleteFromS3(filenames);
              sriRequest.logDebug(`${filenames.join(' & ')} deleted`);
            } catch (err) {
              sriRequest.logDebug('delete rollback failed');
              sriRequest.logDebug(err);
            }
          }

          if (securityError) throw securityError;

          throw failed;
          // stream.push(failed);
        } else {
          /// all went well, rename the files to their real names now.
          bodyJson.filter((e) => e.file !== undefined).forEach((file) => {
            renames.push(
              renameFile(file),
            );
          });

          await Promise.all(renames);

          const response = [];
          bodyJson.forEach((file) => {
            response.push({ status: 200, href: `${file.resource.href}/attachments/${file.attachment.key}` });
          });
          return response;
        }
      },
    };
  }

  function customRouteForPreSignedUpload() {
    return {
      routePostfix: '/attachments/presigned',
      httpMethods: ['GET'],
      readOnly: true,
      beforeHandler: async (_tx, _sriRequest) => {
        // await checkSecurity(tx, sriRequest, null, 'create');
      },
      handler: async (_tx, _sriRequest) => {
        /// dp the presigned request to s3
        const json = await getPreSigned();
        return {
          body: json,
          status: 200,
        };
      },
    };
  }

  function customRouteForDownload() {
    return {
      routePostfix: '/:key/attachments/:filename([^/]*\.[A-Za-z0-9]{1,})',

      httpMethods: ['GET'],
      readOnly: true,
      binaryStream: true,
      beforeStreamingHandler: async (tx, sriRequest, _customMapping) => {
        await checkSecurity(tx, sriRequest, null, 'read');
        sriRequest.logDebug(sriRequest.params.filename);

        let contentType = 'application/octet-stream';

        if (mime.lookup(sriRequest.params.filename)) {
          contentType = mime.lookup(sriRequest.params.filename);
        }

        const headers = [
          ['Content-Disposition', `inline; filename="${escape(sriRequest.params.filename)}"`],
          ['Content-Type', contentType],
        ];

        return {
          status: 200,
          headers,
        };
      },
      streamingHandler: async (tx, sriRequest, stream) => {
        await handleFileDownload(tx, sriRequest, stream);
        sriRequest.logDebug('streaming download done');
      },
    };
  }

  function customRouteForDelete(getFileNameHandler, afterHandler) {
    return {
      routePostfix: '/:key/attachments/:attachmentKey',
      readOnly: false,
      httpMethods: ['DELETE'],
      beforeHandler: async (tx, sriRequest) => {
        await checkSecurity(tx, sriRequest, null, 'delete');
      },
      handler: async (tx, sriRequest) => {
        const filename = await getFileNameHandler(
          tx,
          sriRequest,
          sriRequest.params.key,
          sriRequest.params.attachmentKey,
        );
        await handleFileDelete(tx, sriRequest, filename);
        return {
          status: 204,
        };
      },
      afterHandler: async (tx, sriRequest) => {
        await afterHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey);
      },
    };
  }

  function customRouteForGet(getAttJson) {
    return {
      routePostfix: '/:key/attachments/:attachmentKey',
      httpMethods: ['GET'],
      readOnly: true,
      beforeHandler: async (tx, sriRequest) => {
        await checkSecurity(tx, sriRequest, null, 'read');
      },
      handler: async (tx, sriRequest) => ({
        body: await getAttJson(
          tx,
          sriRequest,
          sriRequest.params.key,
          sriRequest.params.attachmentKey,
        ),
        status: 200,
      }),
    };
  }

  // FIRST CHECK IF THE BUCKET EXISTS, otherwise it makes no sense to return an instance
  // of the utils if we are going to get in trouble later on
  await checkOrCreateBucket();

  // RETURN THE SRI4NODE PLUGIN INSTANCE
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
  sri4nodeAttchmentUtilsFactory,
};
