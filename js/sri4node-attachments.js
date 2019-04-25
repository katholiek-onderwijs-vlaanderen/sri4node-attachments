var s3 = require('s3');
var Q = require('q');

var common = require('./common.js');
var objectMerge = common.objectMerge;
var warn = common.warn;
var error = common.error;
var debug = common.debug;
const streams = require('memory-streams');
const pEvent = require('p-event');
const S3 = require('aws-sdk/clients/s3');
const mime = require('mime-types');
const tmp = require('tmp-promise');
const fs = require('fs');

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
      createBucketIfNotExists: false
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
      return null;
    }



    function createS3Client() {
      var s3key = configuration.s3key; // eslint-disable-line
      var s3secret = configuration.s3secret; // eslint-disable-line

      if (s3key && s3secret) {
        return s3.createClient({
          maxAsyncS3: 20,
          s3RetryCount: configuration.maxRetries,
          s3RetryDelay: 1000,
          multipartUploadThreshold: (configuration.maximumFilesizeInMB + 1) * 1024 * 1024,
          multipartUploadSize: configuration.maximumFilesizeInMB * 1024 * 1024, // this is the default (15 MB)
          s3Options: {
            accessKeyId: s3key,
            secretAccessKey: s3secret,
            region: configuration.s3region
          }
        });
      }

      return null;
    }

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

    function downloadFromS3(s3client, outstream, filename) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var stream, msg;

      var params = {
        Bucket: s3bucket,
        Key: filename
      };

      headFromS3(filename).then(function (exists) {
        if (exists) {
          stream = s3client.downloadStream(params);
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
        } else {
          deferred.reject(404);
        }
      }).catch(function (error) {
        deferred.reject(404);
      });

      return deferred.promise;
    }


    function deleteFromS3(s3client, filenames) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var msg;
      var deleter;

      let objects = filenames.map(e => { return { Key: e } });

      var params = {
        Bucket: s3bucket,
        Delete: {
          Objects: objects
        }
      };
      deleter = s3client.deleteObjects(params);
      deleter.on('error', function (err) {
        msg = 'All attempts to delete failed!';
        error(msg);
        error(err);
        deferred.reject();
      });
      deleter.on('end', function () {
        deferred.resolve();
      });

      return deferred.promise;
    }

    async function checkExistance(files, sriRequest) {

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
      return filename + '.tmp';
    }


    async function renameFile(fileWithJson) {
      let file = fileWithJson.file;
      let s3filename = getS3FileName(null, fileWithJson);
      let tmpFileName = getTmpFilename(s3filename);
      debug('Rename ' + tmpFileName + ' to ' + s3filename);
      let awss3 = createAWSS3Client();
      let params = { Bucket: configuration.s3bucket, Key: s3filename, ACL: "bucket-owner-full-control", CopySource: encodeURI("/" + configuration.s3bucket + "/" + tmpFileName), MetadataDirective: "COPY", TaggingDirective: "COPY" }; //Metadata: { "attachmentkey": fileWithJson.key },

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

      await deleteFromS3(createS3Client(configuration), [tmpFileName]);

    }

    async function handleFileUpload(fileWithJson, sriRequest) {

      let file = fileWithJson.file;
      
      
      let body = await new Promise((resolve, reject) => {
        fs.readFile(file.tmpFile.path, (err, data) => {
          if (err) throw err;
          resolve(data);
        });
      });

      let awss3 = createAWSS3Client();

      let tmpFileName = getTmpFilename(getS3FileName(sriRequest, fileWithJson));
      debug('Uploading file ' + tmpFileName);
      let params = { Bucket: configuration.s3bucket, Key: tmpFileName, ACL: "bucket-owner-full-control", Body: body, Metadata: { "attachmentkey": fileWithJson.attachment.key } };

      await new Promise((accept, reject) => {
        awss3.upload(params, function (err, data) {
          if (err) { // an error occurred
            //console.log(err, err.stack)
            reject(err);
          } else {
            //console.log(data); // successful response
            file.tmpFile.cleanup();
            accept(data)
          }
        });
      });


    }

    function getS3FileName(sriRequest, file, filename) {
      let name;
      if (file) {
        name = file.resource.key + '-' + file.file.filename; ///get filename from json for upload
      } else if (filename) {
        name = sriRequest.params.key + '-' + filename; //get name from the DB(the getFileName fn) for delete
      } else {
        name = sriRequest.params.key + '-' + sriRequest.params.filename; //get name from params for download.
      }
      return name;
    }

    async function handleFileDownload(tx, sriRequest, stream) {

      var s3client = createS3Client(configuration);
      var remoteFilename;
      var localFilename;
      var exists;
      var msg;


      if (s3client) {
        remoteFilename = getS3FileName(sriRequest);
        debug('Download ' + remoteFilename);
        try {
          let status = await downloadFromS3(s3client, stream, remoteFilename)

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
      }
    }

    async function handleFileDelete(tx, sriRequest, filename) {

      var s3client = createS3Client(configuration);
      var remoteFilename;



      if (s3client) {
        remoteFilename = getS3FileName(sriRequest, null, filename);
        debug('Deleting file ' + remoteFilename);
        try {
          await deleteFromS3(s3client, [remoteFilename])
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
      }
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


    async function checkSecurity(tx, sriRequest, bodyJson, ability) {
      let resources = new Set();
      if (bodyJson) {
        bodyJson.forEach(e => { resources.add(e.resource.href) });
      } else {
        resources.add(sriRequest.sriType + '/' + sriRequest.params.key)
      }

      if (configuration.security.plugin) {
        let security = configuration.security.plugin;
        let attAbility = ability;
        if (configuration.security.abilityPrepend)
          attAbility = configuration.security.abilityPrepend + attAbility;
        if (configuration.security.abilityAppend)
          attAbility = attAbility + configuration.security.abilityAppend;
        let t = [...resources];
        await security.checkPermissionOnResourceList(tx, sriRequest, attAbility, t);
      }
      return true;
    }

    function checkBodyJson(file, bodyJson, sriRequest) {
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

    return {
      customRouteForUpload: function (runAfterUpload) {
        return {
          routePostfix: '/attachments',
          httpMethods: ['POST'],
          busBoy: true,

          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {

          },
          streamingHandler: async(tx, sriRequest, stream) => {
            sriRequest.attachmentsRcvd = [];
            sriRequest.fieldsRcvd = {};


            sriRequest.busBoy.on('file',
              async function (fieldname, file, filename, encoding, mimetype) {

                console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);

                let fileObj = ({ filename, mimetype, file, fields: {} });

                fileObj.tmpFile = await tmp.file();
                fileObj.writer = fs.createWriteStream(null, { fd: fileObj.tmpFile.fd });


                file.on('data', async function (data) {
                  //console.log('File [' + fieldname + '] got ' + data.length + ' bytes');
                  //write to buffer
                  fileObj.writer.write(data);
                });
                sriRequest.attachmentsRcvd.push(fileObj);
              });


            sriRequest.busBoy.on('field', function (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
              console.log('Field [' + fieldname + ']: value: ' + val);
              sriRequest.fieldsRcvd[fieldname] = val;
            });


            // wait until busboy is done
            await pEvent(sriRequest.busBoy, 'finish');
            console.log('busBoy is done'); //, sriRequest.attachmentsRcvd)

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
              if (!Array.isArray(bodyJson))
                bodyJson = [bodyJson];
            }

            ///now that we validated the json body resource requirement, we can finally check security.....
            await checkSecurity(tx, sriRequest, bodyJson, 'create');


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

            sriRequest.attachmentsRcvd.forEach(file => checkBodyJson(file, bodyJson, sriRequest));

            sriRequest.attachmentsRcvd.forEach(file => file.mimetype = mime.contentType(file.filename));
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

            let uploads = [];
            let renames = [];
            let failed = [];

            const handleTheFile = async function (att) {
              if (att.file)
                await handleFileUpload(att, sriRequest);
              await runAfterUpload(tx, sriRequest, att);
              // throw "damn";
              return att;
            };

            //validate JSONs for each of the files
            bodyJson.forEach(att => {
              if (att.file !== undefined) {
                // console.log(att.file);
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
                // else {
                //   att.file.s3filename = getS3FileName(sriRequest, att);
                // }
              }

            });

            await checkExistance(bodyJson.filter(e => e.file !== undefined), sriRequest);

            ///add uploads to the queue
            bodyJson.forEach(file => {
              uploads.push(
                handleTheFile(file)
                .then((suc) => {
                  debug("handleFile success");
                })
                .catch((ex) => {
                  console.log("handlefile failed");
                  console.log(ex);
                  failed.push(ex);
                })
              );

            });


            await Promise.all(uploads);

            ///all files are now uploaded into their TMP versions.

            if (failed.length > 0) {
              ///delete attachments again
              console.log("something went wrong during upload/afterupload");
              let s3client = createS3Client(configuration);

              let filenames = sriRequest.attachmentsRcvd.filter(e => e.s3filename).map(e => getTmpFilename(e.s3filename));

              if (filenames.length) {
                try {
                  await deleteFromS3(s3client, filenames);
                  console.log(filenames.join(" & ") + " deleted");
                } catch (err) {
                  console.log("delete rollback failed");
                  console.log(err);
                }
              }

              stream.push(failed);
            } else {
              /// all went well, rename the files to their real names now.
              bodyJson.filter(e => e.file !== undefined).forEach(file => {
                renames.push(
                  renameFile(file)
                );

              });

              await Promise.all(renames);

              stream.push('OK');
            }
          }
        }
      },

      customRouteForPreSignedUpload: function () {
        return {
          routePostfix: '/attachments/presigned',
          httpMethods: ['GET'],
          beforeHandler: async(tx, sriRequest) => {
            // await checkSecurity(tx, sriRequest, null, 'create');
          },
          handler: async(tx, sriRequest) => {
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
          binaryStream: true,
          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {
            await checkSecurity(tx, sriRequest, null, 'read');
            console.log(sriRequest.params.filename);

            let contentType = 'application/octet-stream';

            if (mime.contentType(sriRequest.params.filename))
              contentType = mime.contentType(sriRequest.params.filename);

            let headers = [
              ['Content-Disposition', 'inline; filename=' + sriRequest.params.filename],
              ['Content-Type', contentType]
            ];

            return {
              status: 200,
              headers: headers
            }
          },
          streamingHandler: async(tx, sriRequest, stream) => {

            await handleFileDownload(tx, sriRequest, stream);
            console.log('streaming download done');
          }
        };
      },

      customRouteForDelete: function (getFileNameHandler, afterHandler) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          httpMethods: ['DELETE'],
          beforeHandler: async(tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'delete');
          },
          handler: async(tx, sriRequest) => {
            let filename = await getFileNameHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey);
            await handleFileDelete(tx, sriRequest, filename);
            return {
              status: 204
            }
          },
          afterHandler: async(tx, sriRequest) => {
            await afterHandler(tx, sriRequest, sriRequest.params.key, sriRequest.params.attachmentKey)
          }
        };
      },

      customRouteForGet: function (getAttJson) {
        return {
          routePostfix: '/:key/attachments/:attachmentKey',
          httpMethods: ['GET'],
          beforeHandler: async(tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, null, 'read');
          },
          handler: async(tx, sriRequest) => {
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
