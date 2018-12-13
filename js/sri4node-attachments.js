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

    // Determine if a file already exists using HEAD.
    // Returns a Q promise.
    function existsOnS3(s3client, filename) {
      var deferred = Q.defer();
      var lister;
      var i, current;
      var params = {
        s3Params: {
          Bucket: configuration.s3bucket,
          Prefix: filename
        }
      };
      var status = false;

      lister = s3client.listObjects(params);
      lister.on('error', function (err) {
        error('Unable to list in bucket [' + configuration.s3bucket + '] files with prefix [' + filename + ']');
        error(err);
        deferred.reject();
      });
      lister.on('data', function (data) {
        for (i = 0; i < data.Contents.length; i++) {
          current = data.Contents[i];
          if (current.Key === filename) {
            debug('FOUND file in bucket -> already exists');
            status = true;
          }
        }
      });
      lister.on('end', function () {
        deferred.resolve(status);
      });

      return deferred.promise;
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


    function deleteFromS3(s3client, filename) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var msg;
      var deleter;

      var params = {
        Bucket: s3bucket,
        Delete: {
          Objects: [{
            Key: filename
          }]
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



    async function handleFileUpload(fileWithJson, sriRequest) {
      debug('handling file upload !');
      let file = fileWithJson.file;
      let body = file.buffer ? file.buffer : file.writer.toBuffer();
      let awss3 = createAWSS3Client();
      let params = { Bucket: configuration.s3bucket, Key: file.s3filename, ACL: "bucket-owner-full-control", Body: body, Metadata: { "attachmentkey": fileWithJson.key } };

      //console.log(params);
      let head = await getFileMeta(file.s3filename);
      //console.log(head);

      if (head && head.Metadata && head.Metadata.attachmentkey != fileWithJson.key) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'file.already.exists',
            type: 'ERROR',
            message: file.filename + ' already exists for this resource. Filename has to be unique per resource. To overwrite provide the existing file key.'
          }]
        })
      }

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

    async function handleFileDownload(tx, sriRequest, stream) {

      var s3client = createS3Client(configuration);
      var remoteFilename;
      var localFilename;
      var exists;
      var msg;

      debug('handling file download !');
      if (s3client) {
        remoteFilename = sriRequest.params.key + '-' + sriRequest.params.filename;
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

    async function handleFileDelete(tx, sriRequest) {

      var s3client = createS3Client(configuration);
      var remoteFilename;


      debug('handling file delete !');
      if (s3client) {
        remoteFilename = sriRequest.params.key + '-' + sriRequest.params.filename;
        try {
          await deleteFromS3(s3client, remoteFilename)
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

    async function checkSecurity(tx, sriRequest, ability) {
      if (configuration.security.plugin) {
        let security = configuration.security.plugin;
        let attAbility = ability;
        if (configuration.security.abilityPrepend)
          attAbility = configuration.security.abilityPrepend + attAbility;
        if (configuration.security.abilityAppend)
          attAbility = attAbility + configuration.security.abilityAppend;
        let permaResource = [sriRequest.sriType + '/' + sriRequest.params.key];
        return await security.checkPermissionOnResourceList(tx, sriRequest, attAbility, permaResource);
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
          routePostfix: '/:key/attachments',
          httpMethods: ['PUT'],
          busBoy: true,

          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {
            await checkSecurity(tx, sriRequest, 'create');
          },
          streamingHandler: async(tx, sriRequest, stream) => {
            sriRequest.attachmentsRcvd = [];
            sriRequest.fieldsRcvd = {};


            sriRequest.busBoy.on('file',
              async function (fieldname, file, filename, encoding, mimetype) {

                console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);

                let fileObj = ({ filename, mimetype, file, fields: {} });
                fileObj.s3filename = sriRequest.params.key + '-' + filename;
                fileObj.writer = new streams.WritableStream();

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
            await pEvent(sriRequest.busBoy, 'finish')
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
              })
            } else {
              bodyJson = JSON.parse(bodyJson);
              if (!Array.isArray(bodyJson))
                bodyJson = [bodyJson];
            }

            if (bodyJson.some(e => !e.key)) {
              throw new sriRequest.SriError({
                status: 409,
                errors: [{
                  code: 'missing.body.key',
                  type: 'ERROR',
                  message: 'each attachment body needs a key'
                }]
              })
            }

            sriRequest.attachmentsRcvd.forEach(file => checkBodyJson(file, bodyJson, sriRequest));

            sriRequest.attachmentsRcvd.forEach(file => file.mimetype = mime.contentType(file.filename));

            let uploads = [];

            const handleTheFile = async function (att) {
              if (att.file)
                await handleFileUpload(att, sriRequest);
              await runAfterUpload(tx, sriRequest, att);
            }


            bodyJson.forEach(file => {
              if (file.file !== undefined) {
                file.file = sriRequest.attachmentsRcvd.find(att => att.filename === file.file);

                if (file.file === undefined) {
                  throw new sriRequest.SriError({
                    status: 409,
                    errors: [{
                      code: 'missing.file',
                      type: 'ERROR',
                      message: 'file ' + file.file + ' was expected but not found'
                    }]
                  })
                }
              }

              uploads.push(
                handleTheFile(file)
              )

            })


            await Promise.all(uploads);

            stream.push('OK')
          }
        }
      },


      customRouteForDownload: function () {
        return {
          routePostfix: '/:key/attachments/:filename([^/]*\.[A-Za-z]{1,})',

          httpMethods: ['GET'],
          binaryStream: true,
          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {
            await checkSecurity(tx, sriRequest, 'read');
            console.log(sriRequest.params.filename);

            let contentType = 'application/octet-stream'

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

      customRouteForDelete: function (afterHandler) {
        return {
          routePostfix: '/:key/attachments/:filename([^/]*\.[A-Za-z]{1,})',
          httpMethods: ['DELETE'],
          beforeHandler: async(tx, sriRequest) => {
            await checkSecurity(tx, sriRequest, 'delete');
          },
          handler: handleFileDelete,
          afterHandler: afterHandler
        };
      }
    };
  }
};
