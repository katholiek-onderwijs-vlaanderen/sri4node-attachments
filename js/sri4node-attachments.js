var Q = require('q');

var common = require('./common.js');
var objectMerge = common.objectMerge;
var warn = common.warn;
var error = common.error;
var debug = common.debug;
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

exports = module.exports = {
  configure: function (config) {
    'use strict';

    // default configuration
    var configuration = {
      s3key: '',
      s3secret: '',
      s3bucket: '',
      s3region: 'eu-west-1',
      security: { plugin: undefined, abilityPrepend: '', abilityAppend: '' },
      maxRetries: 3,
      maximumFilesizeInMB: 10,
      verbose: false,
      createBucketIfNotExists: false,
      handleMultipleUploadsTogether: false,
      checkFileExistence: true
    };
    objectMerge(configuration, config);

    checkOrCreateBucket(configuration);

    async function checkOrCreateBucket(config) {
      let exists = await checkBucket(config.s3bucket);
      if (!exists && !config.createBucketIfNotExists) {
        console.error("S3 Bucket " + config.s3bucket + " does not exist");
        console.error(configuration);
      }

      if (!exists && config.createBucketIfNotExists) {
        console.warn("Creating new bucket");

        let awss3 = createAWSS3Client();
        let params = {
          Bucket: config.s3bucket,
          ACL: 'private',
          CreateBucketConfiguration: {
            LocationConstraint: config.s3region
          },
        };

        try {
          await new Promise((accept, reject) => {
            awss3.createBucket(params, function (err, data) {
              if (err) { // an error occurred
                console.log(err, err.stack)
                reject(err);
              } else {
                //console.log(data); // successful response
                accept(data)
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

      let awss3 = createAWSS3Client();
      let params = { Bucket: bucket };

      try {
        await new Promise((accept, reject) => {
          awss3.headBucket(params, function (err, data) {
            if (err) { // an error occurred
              //console.log(err)
              reject(err);
            } else {
              //console.log(data); // successful response
              accept(data)
            }
          });
        });
        return true;
      } catch (ex) {
        return false;
      }

    }

    function createAWSS3Client() {
      if (configuration.s3key && configuration.s3secret) {
        return new S3({
          apiVersion: '2006-03-01',
          accessKeyId: configuration.s3key,
          secretAccessKey: configuration.s3secret,
          region: configuration.s3region,
          maxRetries: configuration.maxRetries
        })
      }
      // return null;
      return new S3({
        apiVersion: '2006-03-01',
        region: configuration.s3region,
        maxRetries: configuration.maxRetries
      })
    }

    // function createS3Client() {
    //   var s3key = configuration.s3key; // eslint-disable-line
    //   var s3secret = configuration.s3secret; // eslint-disable-line

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

    async function headFromS3(s3filename) {
      debug('get HEAD for ' + s3filename);

      let awss3 = createAWSS3Client();
      let params = { Bucket: configuration.s3bucket, Key: s3filename };

      //console.log(params);
      return new Promise((accept, reject) => {
        awss3.headObject(params, function (err, data) {
          if (err) { // an error occurred

            reject(err);

          } else {
            //console.log(data); // successful response

            accept(data)
          }
        });
      });

    }


    async function getFileMeta(s3filename) {
      let data = null;
      try {
        let result = await headFromS3(s3filename);
        data = result;
      } catch (ex) {

      }
      return data;
    }

    function downloadFromS3(outstream, filename) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var msg;

      let awss3 = createAWSS3Client();
      var params = {
        Bucket: s3bucket,
        Key: filename
      };

      headFromS3(filename).then(function (exists) {
        if (exists) {

          const stream = awss3
            .getObject(params)
            .createReadStream()

          // stream = s3client.downloadStream(params);
          stream.pipe(outstream);
          stream.on('error', function (err) {
            msg = 'All attempts to download failed!';
            error(msg);
            error(err);
            deferred.reject(msg);
          });
          stream.on('end', function () {
            debug('Finished download of file.');
            deferred.resolve(200);
          });
          // Also need to listen for close on outstream, to stop in case the request is aborted
          // at client-side before the end of the input stream (S3 file).
          outstream.on('close', function () {
            debug('Outstream closed.');
            deferred.resolve();
          });

        } else {
          deferred.reject(404);
        }
      }).catch(function (error) {
        deferred.reject(404);
      });

      return deferred.promise;
    }


    async function deleteFromS3(filenames) {

      let awss3 = createAWSS3Client();

      let objects = filenames.map(e => { return { Key: e } });

      var params = {
        Bucket: configuration.s3bucket,
        Delete: {
          Objects: objects
        }
      };


      await new Promise((accept, reject) => {
        awss3.deleteObjects(params, function (err, data) {
          if (err) { // an error occurred
            //console.log(err, err.stack)
            reject(err);
          } else {
            //console.log(data); // successful response
            accept(data);
          }
        });
      });

    }

    async function checkExistence(files, sriRequest) {

      for (let fileWithJson of files) {
        //console.log(params);
        let file = fileWithJson.file;
        let head = await getFileMeta(getS3FileName(sriRequest, fileWithJson));
        //console.log(head);

        if (head && head.Metadata && head.Metadata.attachmentkey != fileWithJson.attachment.key) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'file.already.exists',
              type: 'ERROR',
              message: file.filename + ' already exists for this resource. Filename has to be unique per resource. To overwrite provide the existing file key.'
            }]
          })
        }
      }
    }

    function getTmpFilename(filename) {
      return uuidv4() + '-' + filename + '.tmp';
    }


    async function renameFile(fileWithJson) {
      let file = fileWithJson.file;
      let s3filename = getS3FileName(null, fileWithJson);
      let tmpFileName = file.tmpFileName;
      debug('Rename ' + tmpFileName + ' to ' + s3filename);

      await copyFile(s3filename, tmpFileName, fileWithJson.attachment.key);

      await deleteFromS3([tmpFileName]);

    }

    async function copyFile(destionationFileName, sourceFileName, attachmentKey) {
      let awss3 = createAWSS3Client();
      let params = { Bucket: configuration.s3bucket, Key: destionationFileName, ACL: "bucket-owner-full-control", CopySource: encodeURI("/" + configuration.s3bucket + "/" + sourceFileName), MetadataDirective: "REPLACE", TaggingDirective: "COPY", Metadata: { "attachmentkey": attachmentKey } };

      await new Promise((accept, reject) => {
        awss3.copyObject(params, function (err, data) {
          if (err) { // an error occurred
            //console.log(err, err.stack)
            reject(err);
          } else {
            //console.log(data); // successful response
            accept(data);
          }
        });
      });
    }

    async function handleFileUpload(fileStream, tmpFileName) {

      let awss3 = createAWSS3Client();

      debug('Uploading file ' + tmpFileName);
      let params = { Bucket: configuration.s3bucket, Key: tmpFileName, ACL: "bucket-owner-full-control", Body: fileStream }; //, Metadata: { "attachmentkey": fileWithJson.attachment.key }

      await new Promise((accept, reject) => {
        awss3.upload(params, function (err, data) {
          if (err) { // an error occurred
            //console.log(err, err.stack)
            reject(err);
          } else {
            //console.log(data); // successful response
            accept(data)
          }
        });
      });

    }

    function getS3FileName(sriRequest, file, filename, href) {
      let name;
      if (file) {
        name = file.resource.key + '-' + file.file.filename; ///get filename from json for upload
      } else if (filename) {
        name = sriRequest.params.key + '-' + filename; //get name from the DB(the getFileName fn) for delete
      } else if (href) { //for the copy
        const spl = href.split('/');
        const attInd = spl.indexOf('attachments');
        name = spl[attInd - 1] + '-' + spl[attInd + 1];
      } else {
        name = sriRequest.params.key + '-' + getSafeFilename(sriRequest.params.filename); //get name from params for download.
      }
      return name;
    }

    async function handleFileDownload(tx, sriRequest, stream) {

      // var s3client = createS3Client(configuration);
      var remoteFilename;
      var localFilename;
      var exists;
      var msg;


      // if (s3client) {
      remoteFilename = getS3FileName(sriRequest);
      debug('Download ' + remoteFilename);
      try {
        let status = await downloadFromS3(stream, remoteFilename)

      } catch (err) {

        // File was streamed to client.
        if (err === 404) {
          throw new sriRequest.SriError({
            status: 404
          })
        }

        throw new sriRequest.SriError({
          status: 500,
          errors: [{
            code: 'download.failed',
            type: 'ERROR',
            message: 'unable to download the file'
          }]
        })

      }
      // }
    }

    async function handleFileDelete(tx, sriRequest, filename) {

      // var s3client = createS3Client(configuration);
      var remoteFilename;

      // if (s3client) {
      remoteFilename = getS3FileName(sriRequest, null, filename);
      debug('Deleting file ' + remoteFilename);
      try {
        await deleteFromS3([remoteFilename])
        return { status: 204 };
      } catch (err) {
        error('Unable to delete file [' + remoteFilename + ']');
        error(err);
        throw new sriRequest.SriError({
          status: 500,
          errors: [{
            code: 'delete.failed',
            type: 'ERROR',
            message: 'Unable to delete file [' + remoteFilename + ']'
          }]
        })
      }
      // }
    }



    async function getPreSigned() {
      debug('getting presigned post for s3');

      let awss3 = createAWSS3Client();

      let params = {
        Bucket: configuration.s3bucket,
        Conditions: [['starts-with', '$key', 'tmp']]
      };

      return await new Promise((accept, reject) => {
        awss3.createPresignedPost(params, function (err, data) {
          if (err) { // an error occurred
            //console.log(err, err.stack)
            console.error('Presigning post data encountered an error', err);
            reject(err);
          } else {
            //console.log(data); // successful response
            console.log('The post data is', data);
            accept(data)
          }
        });
      });


    }


    async function copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy) {
      let toCopy = bodyJson.filter(e => e.fileHref);
      if (!toCopy.length)
        return bodyJson;

      sriRequest.logDebug('copy attachments');
      let resources = new Set();

      toCopy.forEach(body => {
        const resourceHref = getResourceForCopy(body.fileHref);
        resources.add(resourceHref);
        const filename = body.fileHref.split('/attachments/').pop();
        body.file = {
          tmpFileName: getTmpFilename(filename),
          filename,
          mimetype: mime.contentType(filename)
        };
      });

      await checkSecurityForResources(tx, sriRequest, 'read', resources);

      let promises = [];

      toCopy.forEach(body => {
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
            message: 'One or more of the files to copy can not be found'
          }]
        });
      });

      toCopy.forEach(body => {
        promises.push(copyFile(body.file.tmpFileName, getS3FileName(undefined, undefined, undefined, body.fileHref), body.attachment.key));
      });

      await Promise.all(promises);

      // Remove the not found files from the bodyJson
      return bodyJson.filter(bj => !bj.fileHref || toCopy.some(tc => tc.fileHref === bj.fileHref));
    }


    async function checkSecurity(tx, sriRequest, bodyJson, ability) {
      let resources = new Set();
      if (bodyJson) {
        bodyJson.forEach(e => { resources.add(e.resource.href) });
      } else {
        resources.add(sriRequest.sriType + '/' + sriRequest.params.key)
      }

      if (configuration.security.plugin) {
        await checkSecurityForResources(tx, sriRequest, ability, resources);
      }
      return true;
    }

    async function checkSecurityForResources(tx, sriRequest, ability, resources) {
      if (!resources.size) {
        return;
      }
      let security = configuration.security.plugin;
      let attAbility = ability;
      if (configuration.security.abilityPrepend)
        attAbility = configuration.security.abilityPrepend + attAbility;
      if (configuration.security.abilityAppend)
        attAbility = attAbility + configuration.security.abilityAppend;
      let t = [...resources];
      await security.checkPermissionOnResourceList(tx, sriRequest, attAbility, t, undefined, true);
    }

    function checkBodyJsonForFile(file, bodyJson, sriRequest) {
      if (!bodyJson.some(e => e.file === file.filename))
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'body.incomplete',
            type: 'ERROR',
            message: file.filename + ' needs an accompanying json object in the BODY array.'
          }]
        })
    }

    function checkFileForBodyJson(bodyJson, sriRequest) {
      //validate JSONs for each of the files
      bodyJson.forEach(att => {
        if (att.file !== undefined && !att.fileHref) {
          att.file = sriRequest.attachmentsRcvd.find(attf => attf.filename === att.file);

          if (att.file === undefined) {
            throw new sriRequest.SriError({
              status: 409,
              errors: [{
                code: 'missing.file',
                type: 'ERROR',
                message: 'file ' + att.file + ' was expected but not found'
              }]
            });
          }
        }
      });
    }

    function validateRequestData(bodyJson, sriRequest) {
      if (bodyJson.some(e => !e.attachment)) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'missing.json.body.attachment',
            type: 'ERROR',
            message: 'each json item needs an "attachment"'
          }]
        });
      }

      if (bodyJson.some(e => !e.attachment.key)) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'missing.json.attachment.key',
            type: 'ERROR',
            message: 'each attachment json needs a key'
          }]
        });
      }

      bodyJson.forEach(att => {
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
          let chuncks = att.resource.href.split("/");
          att.resource.key = chuncks[chuncks.length - 1];
        }
      });
    }

    return {
      customRouteForUpload: function (runAfterUpload, getResourceForCopy) {
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

            let tmpUploads = [];
            let failed = [];

            const uploadTmpFile = async function (fileObj) {
              sriRequest.logDebug('uploading tmp file')
              let response = await handleFileUpload(fileObj.file, fileObj.tmpFileName);
              sriRequest.logDebug("upload to s3 done for " + fileObj.tmpFileName);

              let meta = await getFileMeta(fileObj.tmpFileName);
              fileObj.hash = meta.ETag;
              fileObj.size = meta.ContentLength;

              return fileObj;
            };

            sriRequest.busBoy.on('file',
              async function (fieldname, file, filename, encoding, mimetype) {
                const safeFilename = getSafeFilename(filename);

                sriRequest.logDebug('File [' + fieldname + ']: filename: ' + safeFilename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);

                let fileObj = {
                  filename: safeFilename,
                  originalFilename: filename,
                  mimetype,
                  file,
                  fields: {}
                };

                fileObj.tmpFileName = getTmpFilename(safeFilename);

                tmpUploads.push(
                  uploadTmpFile(fileObj)
                    .then((suc) => { })
                    .catch((ex) => {
                      sriRequest.logDebug("uploadTmpFile failed");
                      sriRequest.logDebug(ex);
                      failed.push(ex);
                    })
                );

                sriRequest.attachmentsRcvd.push(fileObj);
              });


            sriRequest.busBoy.on('field', function (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
              sriRequest.logDebug('Field [' + fieldname + ']: value: ' + val);
              sriRequest.fieldsRcvd[fieldname] = val;
            });


            // wait until busboy is done
            await pEvent(sriRequest.busBoy, 'finish');
            sriRequest.logDebug('busBoy is done'); //, sriRequest.attachmentsRcvd)

            await Promise.all(tmpUploads);
            sriRequest.logDebug("tmp uploads done");

            let bodyJson = sriRequest.fieldsRcvd.body;
            let securityError;
            let renames = [];

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
              if (!Array.isArray(bodyJson))
                bodyJson = [bodyJson];
            }

            validateRequestData(bodyJson, sriRequest);

            // Filename: replace special characters with underscore
            bodyJson.forEach(b => {
              if (b.file) {
                b.file = getSafeFilename(b.file);
              }
              if (b.attachment.name) {
                b.attachment.name = getSafeFilename(b.attachment.name);
              }
            });

            sriRequest.attachmentsRcvd.forEach(file => checkBodyJsonForFile(file, bodyJson, sriRequest));

            sriRequest.attachmentsRcvd.forEach(file => file.mimetype = mime.contentType(file.filename));

            if (getResourceForCopy) {
              bodyJson = await copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy);
            }

            checkFileForBodyJson(bodyJson, sriRequest);

            const handleTheFile = async function (att) {
              // if (att.file)
              //   await handleFileUpload(att, sriRequest);
              await runAfterUpload(tx, sriRequest, att);
              //throw "damn";
              return att;
            };

            if (config.checkFileExistence) {
              await checkExistence(bodyJson.filter(e => e.file !== undefined), sriRequest);
            }

            //add uploads to the queue
            if (!config.handleMultipleUploadsTogether) {
              if (config.uploadInSequence) {
                // For example Persons Api which uses an sri4node as a proxy for its attachments files should be sequentially uploaded
                for (let file of bodyJson) {
                  await handleTheFile(file)
                    .then((suc) => {
                      debug("handleFile success");
                    })
                    .catch((ex) => {
                      sriRequest.logDebug("handlefile failed");
                      sriRequest.logDebug(ex);
                      failed.push(ex);
                    });
                }
              } else {
                let uploads = [];

                bodyJson.forEach(file => {
                  uploads.push(
                    handleTheFile(file)
                      .then((suc) => {
                        debug("handleFile success");
                      })
                      .catch((ex) => {
                        sriRequest.logDebug("handlefile failed");
                        sriRequest.logDebug(ex);
                        failed.push(ex);
                      })
                  );
                });
                await Promise.all(uploads);
              }
            } else {
              await handleTheFile(bodyJson)
                .then((suc) => {
                  debug("handleFile success");
                })
                .catch((ex) => {
                  sriRequest.logDebug("handlefile failed");
                  sriRequest.logDebug(ex);
                  failed.push(ex);
                });
            }

            // }

            ///now that we validated the json body resource requirement, we can finally check security.....
            try {
              await checkSecurity(tx, sriRequest, bodyJson, 'create');
            } catch (error) {
              securityError = error;
            }

            ///all files are now uploaded into their TMP versions.

            if (failed.length > 0 || securityError) { ///something failed. delete all tmp files
              ///delete attachments again
              sriRequest.logDebug("something went wrong during upload/afterupload");
              // let s3client = createS3Client(configuration);

              let filenames = sriRequest.attachmentsRcvd.filter(e => e.tmpFileName).map(e => e.tmpFileName);

              if (filenames.length) {
                try {
                  await deleteFromS3(filenames);
                  sriRequest.logDebug(filenames.join(" & ") + " deleted");
                } catch (err) {
                  sriRequest.logDebug("delete rollback failed");
                  sriRequest.logDebug(err);
                }
              }

              if (securityError) throw securityError;

              throw failed;
              //stream.push(failed);
            } else {
              /// all went well, rename the files to their real names now.
              bodyJson.filter(e => e.file !== undefined).forEach(file => {
                renames.push(
                  renameFile(file)
                );

              });

              await Promise.all(renames);

              let response = [];
              bodyJson.forEach(file => {
                response.push({ status: 200, href: file.resource.href + "/attachments/" + file.attachment.key });
              });
              stream.push(response);
              // stream.push('OK');
            }
          }
        }
      },

      customRouteForUploadCopy: function (runAfterUpload, getResourceForCopy) {
        return {
          routePostfix: '/attachments/copy',
          httpMethods: ['POST'],
          readOnly: false,

          handler: async (tx, sriRequest) => {
            sriRequest.attachmentsRcvd = [];
            sriRequest.fieldsRcvd = {};

            let failed = [];

            sriRequest.fieldsRcvd.body = sriRequest.body;

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
              if (!Array.isArray(bodyJson))
                bodyJson = [bodyJson];
            }

            let securityError;
            let renames = [];

            validateRequestData(bodyJson, sriRequest);

            if (getResourceForCopy) {
              bodyJson = await copyAttachments(tx, sriRequest, bodyJson, getResourceForCopy);
            }

            checkFileForBodyJson(bodyJson, sriRequest);

            const handleTheFile = async function (att) {
              // if (att.file)
              //   await handleFileUpload(att, sriRequest);
              await runAfterUpload(tx, sriRequest, att);
              //throw "damn";
              return att;
            };

            if (config.checkFileExistence) {
              await checkExistence(bodyJson.filter(e => e.file !== undefined), sriRequest);
            }

            //add uploads to the queue
            if (!config.handleMultipleUploadsTogether) {
              if (config.uploadInSequence) {
                // For example Persons Api which uses an sri4node as a proxy for its attachments files should be sequentially uploaded
                for (let file of bodyJson) {
                  await handleTheFile(file)
                    .then((suc) => {
                      debug("handleFile success");
                    })
                    .catch((ex) => {
                      sriRequest.logDebug("handlefile failed");
                      sriRequest.logDebug(ex);
                      failed.push(ex);
                    });
                }
              } else {
                let uploads = [];

                bodyJson.forEach(file => {
                  uploads.push(
                    handleTheFile(file)
                      .then((suc) => {
                        debug("handleFile success");
                      })
                      .catch((ex) => {
                        sriRequest.logDebug("handlefile failed");
                        sriRequest.logDebug(ex);
                        failed.push(ex);
                      })
                  );
                });
                await Promise.all(uploads);
              }
            } else {
              await handleTheFile(bodyJson)
                .then((suc) => {
                  debug("handleFile success");
                })
                .catch((ex) => {
                  sriRequest.logDebug("handlefile failed");
                  sriRequest.logDebug(ex);
                  failed.push(ex);
                });
            }

            // }

            ///now that we validated the json body resource requirement, we can finally check security.....
            try {
              await checkSecurity(tx, sriRequest, bodyJson, 'create');
            } catch (error) {
              securityError = error;
            }

            ///all files are now uploaded into their TMP versions.

            if (failed.length > 0 || securityError) { ///something failed. delete all tmp files
              ///delete attachments again
              sriRequest.logDebug("something went wrong during upload/afterupload");
              // let s3client = createS3Client(configuration);

              let filenames = sriRequest.attachmentsRcvd.filter(e => e.tmpFileName).map(e => e.tmpFileName);

              if (filenames.length) {
                try {
                  await deleteFromS3(filenames);
                  sriRequest.logDebug(filenames.join(" & ") + " deleted");
                } catch (err) {
                  sriRequest.logDebug("delete rollback failed");
                  sriRequest.logDebug(err);
                }
              }

              if (securityError) throw securityError;

              throw failed;
              //stream.push(failed);
            } else {
              /// all went well, rename the files to their real names now.
              bodyJson.filter(e => e.file !== undefined).forEach(file => {
                renames.push(
                  renameFile(file)
                );

              });

              await Promise.all(renames);

              let response = [];
              bodyJson.forEach(file => {
                response.push({ status: 200, href: file.resource.href + "/attachments/" + file.attachment.key });
              });
              return response;
            }
          }
        }
      },

      customRouteForPreSignedUpload: function () {
        return {
          routePostfix: '/attachments/presigned',
          httpMethods: ['GET'],
          readOnly: true,
          beforeHandler: async (tx, sriRequest) => {
            // await checkSecurity(tx, sriRequest, null, 'create');
          },
          handler: async (tx, sriRequest) => {
            ///dp the presigned request to s3
            let json = await getPreSigned();
            return {
              body: json,
              status: 200
            }
          }
        };
      },


      customRouteForDownload: function () {
        return {
          routePostfix: '/:key/attachments/:filename([^/]*\.[A-Za-z0-9]{1,})',

          httpMethods: ['GET'],
          readOnly: true,
          binaryStream: true,
          beforeStreamingHandler: async (tx, sriRequest, customMapping) => {
            await checkSecurity(tx, sriRequest, null, 'read');
            sriRequest.logDebug(sriRequest.params.filename);

            let contentType = 'application/octet-stream';

            if (mime.lookup(sriRequest.params.filename))
              contentType = mime.lookup(sriRequest.params.filename);

            let headers = [
              ['Content-Disposition', 'inline; filename="' + escape(sriRequest.params.filename) + '"'],
              ['Content-Type', contentType]
            ];

            return {
              status: 200,
              headers: headers
            }
          },
          streamingHandler: async (tx, sriRequest, stream) => {

            await handleFileDownload(tx, sriRequest, stream);
            sriRequest.logDebug('streaming download done');
          }
        };
      },

      customRouteForDelete: function (getFileNameHandler, afterHandler) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          readOnly: false,
          httpMethods: ['DELETE'],
          beforeHandler: async (tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'delete');
          },
          handler: async (tx, sriRequest) => {
            let filename = await getFileNameHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey);
            await handleFileDelete(tx, sriRequest, filename);
            return {
              status: 204
            }
          },
          afterHandler: async (tx, sriRequest) => {
            await afterHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey)
          }
        };
      },

      customRouteForGet: function (getAttJson) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          httpMethods: ['GET'],
          readOnly: true,
          beforeHandler: async (tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'read');
          },
          handler: async (tx, sriRequest) => {
            return {
              body: await getAttJson(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey),
              status: 200
            }
          }
        };
      },

    };
  }
};
