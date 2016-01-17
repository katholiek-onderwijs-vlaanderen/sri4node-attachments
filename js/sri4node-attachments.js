var s3 = require('s3');
var Q = require('q');
var qfs = require('q-io/fs');
var fs = require('fs');
var multer = require('multer');
var multerAutoReap = require('multer-autoreap');
multerAutoReap.options.reapOnError = true;
var common = require('./common.js');
var objectMerge = common.objectMerge;
var warn = common.warn;
var error = common.error;
var debug = common.debug;

exports = module.exports = {
  configure: function (config) {
    'use strict';

    var diskstorage;
    var upload;

    // default configuration
    var configuration = {
      s3key: '',
      s3secret: '',
      s3bucket: '',
      s3region: 'eu-west-1',
      maximumFilesizeInMB: 10,
      tempFolder: process.env.TMP ? process.env.TMP : '/tmp', // eslint-disable-line
      folder: '/tmp',
      verbose: false
    };
    objectMerge(configuration, config);

    // Use disk storage, limit to 5 files of max X Mb each.
    // Avoids DoS attacks, or other service unavailability.
    // Files are streamed from network -> temporary disk files.
    // This requires virtually no memory on the server.
    diskstorage = multer.diskStorage({
      destination: configuration.tempFolder
    });

    upload = multer({
      storage: diskstorage,
      limits: {
        fieldNameSize: 256,
        fieldSize: 1024,
        fields: 5,
        fileSize: configuration.maximumFilesizeInMB * 1024 * 1024,
        files: 5,
        parts: 10,
        headerPairs: 100
      }
    });

    function createS3Client() {
      var s3key = configuration.s3key; // eslint-disable-line
      var s3secret = configuration.s3secret; // eslint-disable-line

      if (s3key && s3secret) {
        return s3.createClient({
          maxAsyncS3: 20,
          s3RetryCount: 3,
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

    function downloadFromS3(s3client, response, filename) {
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
          stream.pipe(response);
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
          deferred.resolve(404);
        }
      });

      return deferred.promise;
    }

    function deleteFromS3(s3client, response, filename) {
      var deferred = Q.defer();

      var s3bucket = configuration.s3bucket;
      var msg;
      var deleter;

      var params = {
        Bucket: s3bucket,
        Delete: {
          Objects: [
            {
              Key: filename
            }
          ]
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

    function handleFileUpload(req, res) {
      var deferred = Q.defer();

      var path = configuration.folder;
      var s3client = createS3Client();
      var i;
      var fromFilename;
      var toFilename;
      var promises = [];
      var statusCode;

      debug('handling file upload !');
      debug(req.files);

      if (s3client) {
        statusCode = 200;
        for (i = 0; i < req.files.length; i++) {
          fromFilename = req.files[i].path;
          toFilename = req.params.key + '-' + req.params.filename;
          promises.push(uploadToS3(s3client, fromFilename, toFilename));
        }
        Q.all(promises).then(function (results) {
          for (i = 0; i < results.length; i++) {
            // Maximum status code goes to the client.
            if (results[i] && results[i] > statusCode) {
              statusCode = results[i];
            }
          }
          // Acknowledge to the client that the files were stored.
          res.sendStatus(statusCode);
          deferred.resolve();
        }).catch(function (err) {
          error('Unable to upload all files...');
          error(err);
          // Notify the client that a problem occured.
          res.sendStatus(500);
          deferred.resolve();
        });
      } else {
        if (path === '/tmp') {
          warn('Storing files in /tmp. Only for testing purposes. DO NOT USE IN PRODUCTION !');
        }
        statusCode = 200;
        for (i = 0; i < req.files.length; i++) {
          fromFilename = req.files[i].path;
          toFilename = path + '/' + req.params.key + '-' + req.params.filename;
          try {
            fs.lstatSync(toFilename);
          } catch (err) {
            if (err.code === 'ENOENT') {
              // At least one of the files did not exist -> return 201.
              statusCode = 201;
            } else {
              error(err);
            }
          }
          promises.push(qfs.copy(fromFilename, toFilename));
        }
        Q.all(promises).then(function () {
          // Acknowledge to the client that the files were stored.
          res.sendStatus(statusCode);
          deferred.resolve();
        }).catch(function (err) {
          error('Unable to upload all files...');
          error(err);
          // Notify the client that a problem occured.
          res.sendStatus(500);
          deferred.resolve();
        });
      }

      return deferred.promise;
    }

    function handleFileDownload(req, res) {
      var deferred = Q.defer();

      var path = configuration.folder;
      var s3client = createS3Client(configuration);
      var remoteFilename;
      var localFilename;
      var exists;
      var msg;

      debug('handling file download !');
      if (s3client) {
        remoteFilename = req.params.key + '-' + req.params.filename;
        downloadFromS3(s3client, res, remoteFilename).then(function (status) {
          // File was streamed to client.
          if (status === 404) {
            res.sendStatus(404);
          }
          deferred.resolve();
        }).catch(function (err) {
          msg = 'Unable to download a file.';
          error(msg);
          error(err);
          res.sendStatus(500);
          deferred.resolve();
        });
      } else {
        if (path === '/tmp') {
          warn('Storing files in /tmp. Only for testing purposes. DO NOT USE IN PRODUCTION !');
        }
        localFilename = path + '/' + req.params.key + '-' + req.params.filename;
        try {
          fs.lstatSync(localFilename);
          exists = true;
        } catch (err) {
          if (err.code === 'ENOENT') {
            exists = false;
          } else {
            error('Unable to determine if file exists...');
            error(err);
            res.sendStatus(500);
            deferred.resolve();
            return deferred.resolve();
          }
        }
        if (exists) {
          // TODO : Store meta-information like content-type in a second file on disk.
          res.setHeader('content-type', 'image/png');
          fs.createReadStream(localFilename).pipe(res).on('end', function () {
            deferred.resolve();
          }).on('error', function () {
            debug('Streaming file to client failed.');
            res.sendStatus(500);
            deferred.resolve();
          });
        } else {
          // If no such file exist, send 404 to the client.
          res.sendStatus(404);
          deferred.resolve();
        }
      }

      return deferred.promise;
    }

    function handleFileDelete(req, res) {
      var deferred = Q.defer();

      var path = configuration.folder;
      var s3client = createS3Client(configuration);
      var remoteFilename;
      var localFilename;
      var exists;

      debug('handling file delete !');
      if (s3client) {
        remoteFilename = req.params.key + '-' + req.params.filename;
        deleteFromS3(s3client, res, remoteFilename).then(function () {
          res.sendStatus(200);
          deferred.resolve();
        }).catch(function (err) {
          error('Unable to delete file [' + remoteFilename + ']');
          error(err);
          res.sendStatus(500);
          deferred.resolve();
        });
      } else {
        if (path === '/tmp') {
          warn('Storing files in /tmp. Only for testing purposes. DO NOT USE IN PRODUCTION !');
        }
        localFilename = path + '/' + req.params.key + '-' + req.params.filename;
        try {
          fs.lstatSync(localFilename);
          exists = true;
        } catch (err) {
          if (err.code === 'ENOENT') {
            exists = false;
          } else {
            error('Unable to determine if file exists...');
            error(err);
            res.sendStatus(500);
            deferred.resolve();
            return deferred.promise;
          }
        }
        if (exists) {
          fs.unlinkSync(localFilename);
          debug('File was deleted !');
        }
        res.sendStatus(200);
        deferred.resolve();
      }

      return deferred.promise;
    }

    return {
      customRouteForUpload: function (type, extraMiddleware) {
        var allMiddleware = [
          multerAutoReap,
          upload.any()
        ];
        if (extraMiddleware) {
          allMiddleware = allMiddleware.concat(extraMiddleware);
        }

        return {
          route: type + '/:key/:filename',
          method: 'PUT',
          middleware: allMiddleware,
          handler: handleFileUpload
        };
      },

      customRouteForDownload: function (type, extraMiddleware) {
        return {
          route: type + '/:key/:filename',
          method: 'GET',
          middleware: extraMiddleware,
          handler: handleFileDownload
        };
      },

      customRouteForDelete: function (type, extraMiddleware) {
        return {
          route: type + '/:key/:filename',
          method: 'DELETE',
          middleware: extraMiddleware,
          handler: handleFileDelete
        };
      }
    };
  }
};
