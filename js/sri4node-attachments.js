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
      maxRetries: 3,
      maximumFilesizeInMB: 10,
      verbose: false
    };
    objectMerge(configuration, config);

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

    function uploadToS3(s3client, fromFilename, toFilename) {
      var deferred = Q.defer();

      var msg, params;
      var s3bucket = configuration.s3bucket; // eslint-disable-line
      var ret = 201;

      existsOnS3(s3client, toFilename).then(function (exists) {
        if (exists) {
          ret = 200;
        }

        params = {
          localFile: fromFilename,
          s3Params: {
            Bucket: s3bucket,
            Key: toFilename
          }
        };

        var uploader = s3client.uploadFile(params);
        uploader.on('error', function (err) {
          msg = 'All attempts to uploads failed!';
          error(msg);
          error(err);
          deferred.reject(msg);
        });
        uploader.on('end', function () {
          debug('Upload of file [' + fromFilename + '] was successful.');
          deferred.resolve(ret);
        });
      });

      return deferred.promise;
    }

    function downloadFromS3(s3client, outstream, filename) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var stream, msg;

      var params = {
        Bucket: s3bucket,
        Key: filename
      };

      existsOnS3(s3client, filename).then(function (exists) {
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

    async function handleFileUpload(file) {
      debug('handling file upload !');

      let body = file.buffer ? file.buffer : file.writer.toBuffer();
      let awss3 = createAWSS3Client();
      let params = { Bucket: configuration.s3bucket, Key: file.s3filename, ACL: "bucket-owner-full-control", Body: body };

      console.log(params);

      await new Promise((accept, reject) => {
        awss3.upload(params, function (err, data) {
          if (err) { // an error occurred
            console.log(err, err.stack)
            reject(err);
          } else {
            console.log(data); // successful response
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

    return {
      // customRouteForUpload: function () {
      //   return {
      //     route: '/:key/:filename',
      //     method: 'PUT',
      //     handler: handleFileUpload
      //   };
      // },

      customRouteForUpload: function (runAfterUpload) {
        return {
          routePostfix: '/:key/attachments',
          httpMethods: ['PUT'],
          busBoy: true,

          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {

          },
          streamingHandler: async(tx, sriRequest, stream) => {
            sriRequest.attachmentsRcvd = [];

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


            // sriRequest.busBoy.on('field', function (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
            //   console.log('Field [' + fieldname + ']: value: ' + val);
            //   if (sriRequest.attachmentsRcvd) {

            //     sriRequest.attachmentsRcvd.fields = sriRequest.attachmentsRcvd.fields ? sriRequest.attachmentsRcvd.fields : {};

            //     sriRequest.attachmentsRcvd.fields[fieldname] = val;
            //   }
            // });


            // wait until busboy is done
            await pEvent(sriRequest.busBoy, 'finish')
            console.log('busBoy is done'); //, sriRequest.attachmentsRcvd)

            let uploads = [];

            const handleTheFile = async function (att) {
              await handleFileUpload(att);
              await runAfterUpload(tx, sriRequest, att);
            }

            sriRequest.attachmentsRcvd.forEach(att => {
              uploads.push(
                handleTheFile(att)
              )
            })

            await Promise.all(uploads);

            stream.push('OK')
          }
        }
      },


      customRouteForDownload: function () {
        return {
          routePostfix: '/:key/attachments/:filename',

          httpMethods: ['GET'],
          binaryStream: true,
          beforeStreamingHandler: async(tx, sriRequest, customMapping) => {
            return {
              status: 200,
              headers: [
                ['Content-Disposition', 'inline; filename=' + sriRequest.params.filename],
                ['Content-Type', mime.contentType(sriRequest.params.filename)]
              ]
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
          routePostfix: '/:key/attachments/:filename',
          httpMethods: ['DELETE'],
          handler: handleFileDelete,
          afterHandler: afterHandler
        };
      }
    };
  }
};
