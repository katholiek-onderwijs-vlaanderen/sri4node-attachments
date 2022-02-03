const Q = require('q');

const common = require('./common.js');

const {warn} = common;
const {error} = common;
const {debug} = common;
// const streams = require('memory-streams');
const pEvent = require('p-event');
const S3 = require('aws-sdk/clients/s3');
const mime = require('mime-types');

module.exports = {
  configure(config) {

    // default configuration
    const configuration = {
      s3key: '',
      s3secret: '',
      s3bucket: '',
      s3region: 'eu-west-1',
      security: {plugin: undefined, abilityPrepend: '', abilityAppend: ''},
      maxRetries: 3,
      maximumFilesizeInMB: 10,
      verbose: false,
      createBucketIfNotExists: false,
      handleMultipleUploadsTogether: false,
      checkFileExistence: true,
      ...config,
    };

    checkOrCreateBucket(configuration);

    async function checkOrCreateBucket(config) {
      const exists = await checkBucket(config.s3bucket);
      if (!exists && !config.createBucketIfNotExists) {
        console.error(`S3 Bucket ${config.s3bucket} does not exist`);
        console.error(configuration);
      }

      if (!exists && config.createBucketIfNotExists) {
        console.warn('Creating new bucket');

        const awss3 = createAWSS3Client();
        const params = {
          Bucket: config.s3bucket,
          ACL: 'private',
          CreateBucketConfiguration: {
            LocationConstraint: config.s3region
          }
        };

        try {
          await new Promise((accept, reject) => {
            awss3.createBucket(params, (err, data) => {
              if (err) { // an error occurred
                console.log(err, err.stack);
                reject(err);
              } else {
                // console.log(data); // successful response
                accept(data);
              }
            });
          });
        } catch (ex) {
          console.error('bucket creation failed');
          console.log(ex);
        }
      }
    }

    async function checkBucket(bucket) {
      debug('checking if bucket exists');

      const awss3 = createAWSS3Client();
      const params = {Bucket: bucket};

      try {
        await new Promise((accept, reject) => {
          awss3.headBucket(params, (err, data) => {
            if (err) { // an error occurred
              // console.log(err)
              reject(err);
            } else {
              // console.log(data); // successful response
              accept(data);
            }
          });
        });
        return true;
      } catch (ex) {
        return false;
      }
    }

    function createAWSS3Client() {
      if (!this.awss3client) {
        if (configuration.s3key && configuration.s3secret) {
          this.awss3client = new S3({
            apiVersion: '2006-03-01',
            accessKeyId: configuration.s3key,
            secretAccessKey: configuration.s3secret,
            region: configuration.s3region,
            maxRetries: configuration.maxRetries
          });
        } else {
          this.awss3client = new S3({
            apiVersion: '2006-03-01',
            region: configuration.s3region,
            maxRetries: configuration.maxRetries
          });
        }
      }

      return this.awss3client;
    }

    // function createS3Client() {
    //   const s3key = configuration.s3key; // eslint-disable-line
    //   const s3secret = configuration.s3secret; // eslint-disable-line

    //   if (s3key && s3secret) {
    //     return s3.createClient({
    //       maxAsyncS3: 20,
    //       s3RetryCount: configuration.maxRetries,
    //       s3RetryDelay: 1000,
    //       multipartUploadThreshold: (configuration.maximumFilesizeInMB + 1) * 1024 * 1024,
    //       multipartUploadSize: configuration.maximumFilesizeInMB * 1024 * 1024, // this is the default (15 MB)
    //       s3Options: {
    //         accessKeyId: s3key,
    //         secretAccessKey: s3secret,
    //         region: configuration.s3region
    //       }
    //     });
    //   }

    //   return null;
    // }

    /*async*/ function headFromS3(s3filename) {
      debug(`get HEAD for ${s3filename}`);

      const awss3 = createAWSS3Client();
      const params = {Bucket: configuration.s3bucket, Key: s3filename};

      // console.log(params);
      return new Promise((resolve, reject) => {
        awss3.headObject(params, (err, data) => {
          if (err) { // an error occurred
            reject(err);
          } else {
            // console.log(data); // successful response
            resolve(data);
          }
        });
      });
    }

    async function getFileMeta(s3filename) {
      let data = null;
      try {
        const result = await headFromS3(s3filename);
        data = result;
      } catch (ex) {
        console.warn('[getFileMeta] Error while trying to get S3 file meta data', ex);
      }
      return data;
    }

    /* async */ function downloadFromS3(outstream, filename) {
      const {s3bucket} = configuration;
      // const msg;

      const params = {
        Bucket: s3bucket,
        Key: filename
      };

      return new Promise(async (resolve, reject) => {
        try {
          const head = await headFromS3(filename);
          if (head) {
            const awss3 = createAWSS3Client();
            const stream = awss3
              .getObject(params)
              .createReadStream();
  
            // stream = s3client.downloadStream(params);
            stream.pipe(outstream);
            stream.on('error', (err) => {
              msg = 'All attempts to download failed!';
              error(msg);
              error(err);
              reject(msg);
            });
            stream.on('end', () => {
              debug('Finished download of file.');
              resolve(200);
            });
            // Also need to listen for close on outstream, to stop in case the request is aborted
            // at client-side before the end of the input stream (S3 file).
            outstream.on('close', () => {
              debug('Outstream closed.');
              resolve(499); // partial content
            });
          } else {
            reject(404);
          }
        } catch (error) {
          error('[downloadFromS3] the download failed', error);
          reject(500);
        }  
      })

    }

    async function deleteFromS3(filenames) {

      const awss3 = createAWSS3Client();

      const objects = filenames.map((e) => ({Key: e}));

      const params = {
        Bucket: configuration.s3bucket,
        Delete: {
          Objects: objects
        }
      };

      await new Promise((accept, reject) => {
        awss3.deleteObjects(params, (err, data) => {
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

    async function checkExistence(files, sriRequest) {
      for (const fileWithJson of files) {
        // console.log(params);
        const {file} = fileWithJson;
        const head = await getFileMeta(getS3FileName(sriRequest, fileWithJson));
        // console.log(head);

        if (head && head.Metadata && head.Metadata.attachmentkey != fileWithJson.attachment.key) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'file.already.exists',
              type: 'ERROR',
              message: `${file.filename} already exists for this resource. Filename has to be unique per resource. To overwrite provide the existing file key.`
            }]
          });
        }
      }
    }

    function getTmpFilename(filename) {
      return `${new Date().getTime()}-${filename}.tmp`;
    }

    async function renameFile(fileWithJson) {
      const {file} = fileWithJson;
      const s3filename = getS3FileName(null, fileWithJson);
      const {tmpFileName} = file;
      debug(`Rename ${tmpFileName} to ${s3filename}`);

      await copyFile(s3filename, tmpFileName, fileWithJson.attachment.key);

      await deleteFromS3([tmpFileName]);

    }

    async function copyFile(destionationFileName, sourceFileName, attachmentKey) {
      const awss3 = createAWSS3Client();
      const params = {
        Bucket: configuration.s3bucket, Key: destionationFileName, ACL: 'bucket-owner-full-control', CopySource: encodeURI(`/${configuration.s3bucket}/${sourceFileName}`), MetadataDirective: 'REPLACE', TaggingDirective: 'COPY', Metadata: {attachmentkey: attachmentKey}
      };

      await new Promise((accept, reject) => {
        awss3.copyObject(params, (err, data) => {
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

    async function handleFileUpload(fileStream, tmpFileName) {

      const awss3 = createAWSS3Client();

      debug(`Uploading file ${tmpFileName}`);
      const params = {
        Bucket: configuration.s3bucket, Key: tmpFileName, ACL: 'bucket-owner-full-control', Body: fileStream
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
      } else {
        name = `${sriRequest.params.key}-${sriRequest.params.filename}`; // get name from params for download.
      }
      return name;
    }

    async function handleFileDownload(tx, sriRequest, stream) {

      // const s3client = createS3Client(configuration);
      const remoteFilename = getS3FileName(sriRequest);
      debug(`Download ${remoteFilename}`);
      try {
        const status = await downloadFromS3(stream, remoteFilename);
      } catch (err) {
        // File was streamed to client.
        if (err === 404) {
          throw new sriRequest.SriError({
            status: 404
          });
        }

        throw new sriRequest.SriError({
          status: 500,
          errors: [{
            code: 'download.failed',
            type: 'ERROR',
            message: 'unable to download the file'
          }]
        });
      }
      // }
    }

    async function handleFileDelete(tx, sriRequest, filename) {

      // const s3client = createS3Client(configuration);
      const remoteFilename = getS3FileName(sriRequest, null, filename);
      debug(`Deleting file ${remoteFilename}`);
      try {
        await deleteFromS3([remoteFilename]);
        return {status: 204};
      } catch (err) {
        error(`Unable to delete file [${remoteFilename}]`);
        error(err);
        throw new sriRequest.SriError({
          status: 500,
          errors: [{
            code: 'delete.failed',
            type: 'ERROR',
            message: `Unable to delete file [${remoteFilename}]`
          }]
        });
      }
      // }
    }

    async function getPreSigned() {
      debug('getting presigned post for s3');

      const awss3 = createAWSS3Client();

      const params = {
        Bucket: configuration.s3bucket,
        Conditions: [['starts-with', '$key', 'tmp']]
      };

      return await new Promise((accept, reject) => {
        awss3.createPresignedPost(params, (err, data) => {
          if (err) { // an error occurred
            // console.log(err, err.stack)
            console.error('Presigning post data encountered an error', err);
            reject(err);
          } else {
            // console.log(data); // successful response
            console.log('The post data is', data);
            accept(data);
          }
        });
      });

    }

    async function copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy) {
      const toCopy = bodyJson.filter((e) => e.fileHref);
      if (toCopy.length) {
        sriRequest.logDebug('copy attachments');
        const resources = new Set();

        toCopy.forEach((body) => {
          const resourceHref = getResourceForCopy(body.fileHref);
          resources.add(resourceHref);
          const filename = body.fileHref.split('/attachments/').pop();
          body.file = {tmpFileName: getTmpFilename(filename), filename, mimetype: mime.contentType(filename)};
        });

        await checkSecurityForResources(tx, sriRequest, 'read', resources);

        const promises = [];

        toCopy.forEach((body) => {
          promises.push(getFileMeta(getS3FileName(undefined, undefined, undefined, body.fileHref)));
        });

        const results = await Promise.all(promises);

        if (results.some((e) => e == null)) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'file.to.copy.not.found',
              type: 'ERROR',
              message: 'One or more of the files to copy can not be found'
            }]
          });
        }

        toCopy.forEach((body) => {
          promises.push(copyFile(body.file.tmpFileName, getS3FileName(undefined, undefined, undefined, body.fileHref), body.attachment.key));
        });

        await Promise.all(promises);

      }

    }

    async function checkSecurity(tx, sriRequest, bodyJson, ability) {
      const resources = new Set();
      if (bodyJson) {
        bodyJson.forEach((e) => { resources.add(e.resource.href); });
      } else {
        resources.add(`${sriRequest.sriType}/${sriRequest.params.key}`);
      }

      if (configuration.security.plugin) {
        await checkSecurityForResources(tx, sriRequest, ability, resources);
      }
      return true;
    }

    async function checkSecurityForResources(tx, sriRequest, ability, resources) {
      const security = configuration.security.plugin;
      let attAbility = ability;
      if (configuration.security.abilityPrepend) { attAbility = configuration.security.abilityPrepend + attAbility; }
      if (configuration.security.abilityAppend) { attAbility = attAbility + configuration.security.abilityAppend; }
      const t = [...resources];
      await security.checkPermissionOnResourceList(tx, sriRequest, attAbility, t, undefined, true);
    }

    function checkBodyJson(file, bodyJson, sriRequest) {
      if (!bodyJson.some((e) => e.file === file.filename)) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'body.incomplete',
            type: 'ERROR',
            message: `${file.filename} needs an accompanying json object in the BODY array.`
          }]
        });
      }
    }

    return {
      customRouteForUpload(runAfterUpload, getResourceForCopy) {
        return {
          routePostfix: '/attachments',
          httpMethods: ['POST'],
          readOnly: false,
          busBoy: true,

          beforeStreamingHandler: async (tx, sriRequest, customMapping) => {

          },
          streamingHandler: async (tx, sriRequest, stream) => {
            sriRequest.attachmentsRcvd = [];
            sriRequest.fieldsRcvd = {};

            const tmpUploads = [];
            const failed = [];

            const uploadTmpFile = async function (fileObj) {
              sriRequest.logDebug('uploading tmp file');
              const response = await handleFileUpload(fileObj.file, fileObj.tmpFileName);
              sriRequest.logDebug(`upload to s3 done for ${fileObj.tmpFileName}`);

              const meta = await getFileMeta(fileObj.tmpFileName);
              fileObj.hash = meta.ETag;
              fileObj.size = meta.ContentLength;

              return fileObj;
            };

            sriRequest.busBoy.on('file',
              async (fieldname, file, filename, encoding, mimetype) => {

                sriRequest.logDebug(`File [${fieldname}]: filename: ${filename}, encoding: ${encoding}, mimetype: ${mimetype}`);

                const fileObj = ({
                  filename, mimetype, file, fields: {}
                });

                fileObj.tmpFileName = getTmpFilename(filename);

                tmpUploads.push(
                  uploadTmpFile(fileObj)
                    .then((suc) => { })
                    .catch((ex) => {
                      sriRequest.logDebug('uploadTmpFile failed');
                      sriRequest.logDebug(ex);
                      failed.push(ex);
                    })
                );

                sriRequest.attachmentsRcvd.push(fileObj);
              });

            sriRequest.busBoy.on('field', (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) => {
              sriRequest.logDebug(`Field [${fieldname}]: value: ${val}`);
              sriRequest.fieldsRcvd[fieldname] = val;
            });

            // wait until busboy is done
            await pEvent(sriRequest.busBoy, 'finish');
            sriRequest.logDebug('busBoy is done'); // , sriRequest.attachmentsRcvd)

            await Promise.all(tmpUploads);
            sriRequest.logDebug('tmp uploads done');

            let bodyJson = sriRequest.fieldsRcvd.body;

            if (bodyJson === undefined) {
              throw new sriRequest.SriError({
                status: 409,
                errors: [{
                  code: 'missing.body',
                  type: 'ERROR',
                  message: 'Body is required.'
                }]
              });
            } else {
              bodyJson = JSON.parse(bodyJson);
              if (!Array.isArray(bodyJson)) { bodyJson = [bodyJson]; }
            }

            let securityError;
            const renames = [];

            // if (!securityError) {

            if (bodyJson.some((e) => !e.attachment)) {
              throw new sriRequest.SriError({
                status: 409,
                errors: [{
                  code: 'missing.json.body.attachment',
                  type: 'ERROR',
                  message: 'each json item needs an "attachment"'
                }]
              });
            }

            if (bodyJson.some((e) => !e.attachment.key)) {
              throw new sriRequest.SriError({
                status: 409,
                errors: [{
                  code: 'missing.json.attachment.key',
                  type: 'ERROR',
                  message: 'each attachment json needs a key'
                }]
              });
            }

            sriRequest.attachmentsRcvd.forEach((file) => checkBodyJson(file, bodyJson, sriRequest));

            sriRequest.attachmentsRcvd.forEach((file) => file.mimetype = mime.contentType(file.filename));

            bodyJson.forEach((att) => {
              if (!att.resource || !att.resource.href) {
                throw new sriRequest.SriError({
                  status: 409,
                  errors: [{
                    code: 'missing.json.body.resource',
                    type: 'ERROR',
                    message: 'each attachment json needs a resource'
                  }]
                });
              } else {
                const chuncks = att.resource.href.split('/');
                att.resource.key = chuncks[chuncks.length - 1];
              }
            });

            if (getResourceForCopy) {

              await copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy);

            }

            const handleTheFile = async function (att) {
              // if (att.file)
              //   await handleFileUpload(att, sriRequest);
              await runAfterUpload(tx, sriRequest, att);
              // throw "damn";
              return att;
            };

            // validate JSONs for each of the files
            bodyJson.forEach((att) => {
              if (att.file !== undefined && !att.fileHref) {
                // sriRequest.logDebug(att.file);
                att.file = sriRequest.attachmentsRcvd.find((attf) => attf.filename === att.file);

                if (att.file === undefined) {
                  throw new sriRequest.SriError({
                    status: 409,
                    errors: [{
                      code: 'missing.file',
                      type: 'ERROR',
                      message: `file ${att.file} was expected but not found`
                    }]
                  });
                }
                // else {
                //   att.file.s3filename = getS3FileName(sriRequest, att);
                // }
              }

            });

            if (config.checkFileExistence) {
              await checkExistence(bodyJson.filter((e) => e.file !== undefined), sriRequest);
            }

            // add uploads to the queue
            if (!config.handleMultipleUploadsTogether) {
              if (config.uploadInSequence) {
                // For example Persons Api which uses an sri4node as a proxy for its attachments files should be sequentially uploaded
                for (const file of bodyJson) {
                  try {
                    await handleTheFile(file);
                    debug('handleFile success');
                  } catch (ex) {
                    sriRequest.logDebug('handlefile failed');
                    sriRequest.logDebug(ex);
                    failed.push(ex);
                  }
                }
              } else {
                const uploads = [];

                bodyJson.forEach((file) => {
                  uploads.push(
                    handleTheFile(file)
                      .then((suc) => {
                        debug('handleFile success');
                      })
                      .catch((ex) => {
                        sriRequest.logDebug('handlefile failed');
                        sriRequest.logDebug(ex);
                        failed.push(ex);
                      })
                  );
                });
                await Promise.all(uploads);
              }
            } else {
              try {
                await handleTheFile(bodyJson);
                debug('handleFile success');
              } catch (ex) {
                sriRequest.logDebug('handlefile failed');
                sriRequest.logDebug(ex);
                failed.push(ex);
              }
            }

            // }

            /// now that we validated the json body resource requirement, we can finally check security.....
            try {
              await checkSecurity(tx, sriRequest, bodyJson, 'create');
            } catch (error) {
              securityError = error;
            }

            /// all files are now uploaded into their TMP versions.

            if (failed.length > 0 || securityError) { /// something failed. delete all tmp files
              /// delete attachments again
              sriRequest.logDebug('something went wrong during upload/afterupload');
              // let s3client = createS3Client(configuration);

              const filenames = sriRequest.attachmentsRcvd.filter((e) => e.tmpFileName).map((e) => e.tmpFileName);

              if (filenames.length) {
                try {
                  await deleteFromS3(filenames);
                  sriRequest.logDebug(`${filenames.join(' & ')} deleted`);
                } catch (err) {
                  sriRequest.logDebug('delete rollback failed');
                  sriRequest.logDebug(err);
                }
              }

              if (securityError) { throw securityError; }

              throw failed;
              // stream.push(failed);
            } else {
              /// all went well, rename the files to their real names now.
              bodyJson.filter((e) => e.file !== undefined).forEach((file) => {
                renames.push(
                  renameFile(file)
                );

              });

              await Promise.all(renames);

              const response = [];
              bodyJson.forEach((file) => {
                response.push({status: 200, href: `${file.resource.href}/attachments/${file.attachment.key}`});
              });
              stream.push(response);
              // stream.push('OK');
            }
          }
        };
      },

      customRouteForPreSignedUpload() {
        return {
          routePostfix: '/attachments/presigned',
          httpMethods: ['GET'],
          readOnly: true,
          beforeHandler: async (tx, sriRequest) => {
            // await checkSecurity(tx, sriRequest, null, 'create');
          },
          handler: async (tx, sriRequest) => {
            /// dp the presigned request to s3
            const json = await getPreSigned();
            return {
              body: json,
              status: 200
            };
          }
        };
      },

      customRouteForDownload() {
        return {
          routePostfix: '/:key/attachments/:filename([^/]*\.[A-Za-z0-9]{1,})',

          httpMethods: ['GET'],
          readOnly: true,
          binaryStream: true,
          beforeStreamingHandler: async (tx, sriRequest, customMapping) => {
            await checkSecurity(tx, sriRequest, null, 'read');
            sriRequest.logDebug('general', `[customRouteForDownload] trying to stream '${sriRequest.params.filename}' to the client`);

            let contentType = 'application/octet-stream';

            if (mime.lookup(sriRequest.params.filename)) { contentType = mime.lookup(sriRequest.params.filename); }

            const headers = [
              ['Content-Disposition', `inline; filename="${escape(sriRequest.params.filename)}"`],
              ['Content-Type', contentType]
            ];

            return {
              status: 200,
              headers
            };
          },
          streamingHandler: async (tx, sriRequest, stream) => {
            await handleFileDownload(tx, sriRequest, stream);
            sriRequest.logDebug('streaming download done');
          }
        };
      },

      customRouteForDelete(getFileNameHandler, afterHandler) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          readOnly: false,
          httpMethods: ['DELETE'],
          beforeHandler: async (tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'delete');
          },
          handler: async (tx, sriRequest) => {
            const filename = await getFileNameHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey);
            await handleFileDelete(tx, sriRequest, filename);
            return {
              status: 204
            };
          },
          afterHandler: async (tx, sriRequest) => {
            await afterHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey);
          }
        };
      },

      customRouteForGet(getAttJson) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          httpMethods: ['GET'],
          readOnly: true,
          beforeHandler: async (tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'read');
          },
          handler: async (tx, sriRequest) => ({
            body: await getAttJson(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey),
            status: 200
          })
        };
      }

    };
  }
};

exports = module.exports;
